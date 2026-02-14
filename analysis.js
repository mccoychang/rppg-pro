// ===== Analysis Module =====
// HRV metrics, SpO2, breathing rate, emotion analysis

/**
 * Calculate comprehensive HRV metrics from R-R intervals
 */
function calculateHRVMetrics(rrIntervals) {
    if (rrIntervals.length < 3) return null;

    const n = rrIntervals.length;
    const mean = rrIntervals.reduce((a, b) => a + b) / n;

    // SDNN
    const variance = rrIntervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
    const sdnn = Math.sqrt(variance);

    // RMSSD
    let sumSqDiff = 0;
    for (let i = 1; i < n; i++) sumSqDiff += (rrIntervals[i] - rrIntervals[i - 1]) ** 2;
    const rmssd = Math.sqrt(sumSqDiff / (n - 1));

    // pNN50
    let nn50 = 0;
    for (let i = 1; i < n; i++) {
        if (Math.abs(rrIntervals[i] - rrIntervals[i - 1]) > 50) nn50++;
    }
    const pnn50 = (nn50 / (n - 1)) * 100;

    // LF/HF (simplified via time-domain proxy)
    // True LF/HF requires frequency domain of RR tachogram
    // We use SDNN/RMSSD as a proxy (higher = more sympathetic)
    const lfHfProxy = rmssd > 0 ? sdnn / rmssd : 1;

    return { sdnn: Math.round(sdnn), rmssd: Math.round(rmssd), pnn50: Math.round(pnn50 * 10) / 10, lfHfRatio: Math.round(lfHfProxy * 100) / 100, meanRR: Math.round(mean) };
}

/**
 * Estimate SpO2 from red and blue channel ratio
 * This is a rough approximation - not medical grade
 */
function estimateSpO2(redSignal, blueSignal) {
    if (redSignal.length < 60) return null;

    const recent = 60;
    const rSlice = redSignal.slice(-recent);
    const bSlice = blueSignal.slice(-recent);

    const rMean = rSlice.reduce((a, b) => a + b) / recent;
    const bMean = bSlice.reduce((a, b) => a + b) / recent;

    let rAC = 0, bAC = 0;
    for (let i = 0; i < recent; i++) {
        rAC += (rSlice[i] - rMean) ** 2;
        bAC += (bSlice[i] - bMean) ** 2;
    }
    rAC = Math.sqrt(rAC / recent);
    bAC = Math.sqrt(bAC / recent);

    const rDC = rMean || 1;
    const bDC = bMean || 1;

    const ratio = (rAC / rDC) / (bAC / bDC || 1);

    // Empirical calibration (Beer-Lambert linear model)
    let spo2 = 110 - 25 * ratio;
    spo2 = Math.max(85, Math.min(100, spo2));

    return Math.round(spo2);
}

/**
 * Estimate breathing rate from PPG signal (low frequency component)
 * Breathing modulates PPG amplitude at 0.15-0.5 Hz (9-30 breaths/min)
 */
function estimateBreathingRate(signal, fps) {
    if (signal.length < 90) return null;

    // Low-pass filter to extract respiratory component
    const n = nextPow2(signal.length);
    const re = new Float64Array(n);
    const im = new Float64Array(n);

    for (let i = 0; i < signal.length; i++) {
        const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (signal.length - 1)));
        re[i] = signal[i] * w;
    }
    fft(re, im, n);

    // Find peak in respiratory range (0.15-0.5 Hz)
    const minBin = Math.floor(0.15 * n / fps);
    const maxBin = Math.ceil(0.5 * n / fps);

    let maxMag = 0, peakBin = minBin;
    for (let i = Math.max(1, minBin); i <= Math.min(maxBin, n / 2); i++) {
        const mag = re[i] * re[i] + im[i] * im[i];
        if (mag > maxMag) { maxMag = mag; peakBin = i; }
    }

    const breathHz = peakBin * fps / n;
    const breathsPerMin = breathHz * 60;

    return (breathsPerMin >= 8 && breathsPerMin <= 35) ? Math.round(breathsPerMin) : null;
}

/**
 * Analyze emotional/stress state based on HRV metrics
 */
function analyzeEmotionalState(hrvMetrics, hr) {
    if (!hrvMetrics) return { state: '--', emoji: '❓', color: '#8e8e93' };

    const { sdnn, rmssd, pnn50, lfHfRatio } = hrvMetrics;

    // Scoring system
    let stressScore = 0;

    // Low HRV = high stress
    if (sdnn < 20) stressScore += 3;
    else if (sdnn < 40) stressScore += 2;
    else if (sdnn < 60) stressScore += 1;

    if (rmssd < 15) stressScore += 2;
    else if (rmssd < 30) stressScore += 1;

    if (pnn50 < 3) stressScore += 1;

    // High HR = more stress
    if (hr > 100) stressScore += 2;
    else if (hr > 85) stressScore += 1;

    // High LF/HF = sympathetic dominance
    if (lfHfRatio > 2.5) stressScore += 2;
    else if (lfHfRatio > 1.5) stressScore += 1;

    if (stressScore >= 7) return { state: '高度緊張', emoji: '😰', color: '#ff2d55', level: 'high' };
    if (stressScore >= 5) return { state: '緊張', emoji: '😟', color: '#ff9f0a', level: 'medium-high' };
    if (stressScore >= 3) return { state: '一般', emoji: '😐', color: '#ffd60a', level: 'medium' };
    if (stressScore >= 1) return { state: '放鬆', emoji: '😌', color: '#30d158', level: 'low' };
    return { state: '非常放鬆', emoji: '😊', color: '#5ac8fa', level: 'very-low' };
}

/**
 * 王唯工脈診儀 — Pulse Harmonic Analysis
 * Decomposes PPG signal into harmonics mapped to TCM meridians
 * Based on Wang Wei-Gong's resonance theory of blood circulation
 *
 * C0 = fundamental (heart rate), C1-C10 = harmonics mapped to organs
 */
function pulseHarmonicAnalysis(signal, fps, strict) {
    if (signal.length < 90) return null;

    const n = nextPow2(signal.length);
    const re = new Float64Array(n);
    const im = new Float64Array(n);

    // Apply Hanning window
    for (let i = 0; i < signal.length; i++) {
        const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (signal.length - 1)));
        re[i] = signal[i] * w;
    }
    fft(re, im, n);

    // Find fundamental frequency (C0 = heart rate, ~1-1.7 Hz)
    const hrMinBin = Math.max(1, Math.floor(0.8 * n / fps));
    const hrMaxBin = Math.min(Math.ceil(2.5 * n / fps), n / 2);

    let maxMag = 0, fundBin = hrMinBin;
    for (let i = hrMinBin; i <= hrMaxBin; i++) {
        const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
        if (mag > maxMag) { maxMag = mag; fundBin = i; }
    }

    const fundFreq = fundBin * fps / n;

    // Meridian mapping (王唯工 theory)
    const meridians = [
        { name: '心', organ: '心臟', color: '#ff2d55', emoji: '❤️' },       // C0 fundamental
        { name: '肝', organ: '肝經', color: '#30d158', emoji: '🟢' },       // C1
        { name: '腎', organ: '腎經', color: '#5856d6', emoji: '🔵' },       // C2
        { name: '脾', organ: '脾經', color: '#ff9f0a', emoji: '🟡' },       // C3
        { name: '肺', organ: '肺經', color: '#aeaeb2', emoji: '⚪' },       // C4
        { name: '胃', organ: '胃經', color: '#ffd60a', emoji: '🟠' },       // C5
        { name: '膽', organ: '膽經', color: '#34c759', emoji: '🫒' },       // C6
        { name: '膀胱', organ: '膀胱經', color: '#007aff', emoji: '💧' },   // C7
        { name: '大腸', organ: '大腸經', color: '#af52de', emoji: '🟣' },   // C8
        { name: '三焦', organ: '三焦經', color: '#ff6482', emoji: '🔺' },   // C9
        { name: '小腸', organ: '小腸經', color: '#ac8e68', emoji: '🟤' },   // C10
    ];

    // Extract amplitude at each harmonic
    const harmonics = [];
    let totalEnergy = 0;

    for (let h = 0; h <= 10; h++) {
        const targetBin = Math.round(fundBin * (h === 0 ? 1 : (h + 1)));
        // Search in neighborhood of ±2 bins for actual peak
        const searchStart = Math.max(1, targetBin - 2);
        const searchEnd = Math.min(n / 2, targetBin + 2);

        let peakMag = 0;
        for (let i = searchStart; i <= searchEnd; i++) {
            const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
            if (mag > peakMag) peakMag = mag;
        }

        harmonics.push({
            ...meridians[h],
            harmonic: h,
            amplitude: peakMag,
            frequency: (h === 0 ? fundFreq : fundFreq * (h + 1)),
        });
        totalEnergy += peakMag;
    }

    // Calculate percentages and health status
    if (totalEnergy === 0) return null;

    // Expected ranges: strict mode uses narrower, research-ideal ranges
    // Normal mode uses wider, more forgiving ranges
    const expectedRanges = strict ? [
        { min: 30, max: 45 },  // C0 心: strict ideal ~32-42%
        { min: 15, max: 25 },  // C1 肝: strict ~16-23%
        { min: 10, max: 18 },  // C2 腎: strict ~11-16%
        { min: 6, max: 12 },   // C3 脾: strict ~7-11%
        { min: 3, max: 8 },    // C4 肺: strict ~4-7%
        { min: 2, max: 6 },    // C5 胃: strict ~2.5-5%
        { min: 1, max: 5 },    // C6 膽: strict ~1.5-4%
        { min: 0.5, max: 4 },  // C7 膀胱: strict ~0.8-3%
        { min: 0.3, max: 3 },  // C8 大腸: strict ~0.5-2.5%
        { min: 0.2, max: 2 },  // C9 三焦: strict ~0.3-1.5%
        { min: 0.1, max: 2 },  // C10 小腸: strict ~0.2-1.5%
    ] : [
        { min: 25, max: 55 },  // C0 心: dominant, ~30-50% of total energy
        { min: 12, max: 28 },  // C1 肝: second largest, ~15-25%
        { min: 7, max: 20 },   // C2 腎: ~10-18%
        { min: 4, max: 14 },   // C3 脾: ~6-12%
        { min: 2, max: 10 },   // C4 肺: ~3-8%
        { min: 1, max: 8 },    // C5 胃: ~2-6%
        { min: 0.5, max: 6 },  // C6 膽: ~1-5%
        { min: 0.3, max: 5 },  // C7 膀胱: ~0.5-4%
        { min: 0.2, max: 4 },  // C8 大腸: ~0.3-3%
        { min: 0.1, max: 3 },  // C9 三焦: ~0.2-2%
        { min: 0.1, max: 3 },  // C10 小腸: ~0.1-2%
    ];

    // Threshold multipliers: strict mode is more sensitive
    const overMult = strict ? 1.1 : 1.3;    // 偏亢 threshold (above max)
    const weakMult = strict ? 0.8 : 0.5;    // 偏弱/不足 boundary
    const defMult = strict ? 0.8 : 0.6;     // constitution deficiency threshold

    harmonics.forEach((h, i) => {
        h.percentage = (h.amplitude / totalEnergy) * 100;
        h.normalized = h.amplitude / harmonics[0].amplitude;

        // Health assessment based on expected range for each harmonic
        const range = expectedRanges[i];
        if (h.percentage > range.max * overMult) {
            h.status = '偏亢'; h.statusColor = '#ff9f0a';   // significantly above range
        } else if (h.percentage >= range.min && h.percentage <= range.max) {
            h.status = '正常'; h.statusColor = '#30d158';   // within expected range
        } else if (h.percentage >= range.min * weakMult && h.percentage < range.min) {
            h.status = '偏弱'; h.statusColor = '#ff9f0a';   // below range but not critical
        } else if (h.percentage < range.min * weakMult) {
            h.status = '不足'; h.statusColor = '#ff2d55';   // significantly below range
        } else {
            h.status = '偏高'; h.statusColor = '#ffd60a';   // slightly above range
        }

        // Store the expected range for display
        h.expectedRange = `${range.min}-${range.max}%`;
    });

    // Constitution assessment based on published clinical findings
    const c0 = harmonics[0], c1 = harmonics[1], c2 = harmonics[2];
    const c3 = harmonics[3], c4 = harmonics[4];

    // Check if harmonics follow healthy decreasing pattern: C1 > C2 > C3 > C4
    const healthyOrder = c1.percentage > c2.percentage &&
        c2.percentage > c3.percentage &&
        c3.percentage > c4.percentage;

    let constitution = '';
    let constitutionEmoji = '⚖️';

    // Disease pattern detection from research:
    // Strict mode: more sensitive detection (lower thresholds)
    const cExcessMult = strict ? 1.05 : 1.2;  // liver excess threshold

    if (c0.percentage < expectedRanges[0].min && c3.percentage < expectedRanges[3].min) {
        constitution = '心脾兩虛（注意心血管）';
        constitutionEmoji = '⚠️';
    }
    else if (c1.percentage > expectedRanges[1].max * cExcessMult) {
        constitution = '肝氣偏旺';
        constitutionEmoji = '🌿';
    }
    else if (c2.percentage < expectedRanges[2].min * defMult) {
        constitution = '腎氣不足';
        constitutionEmoji = '💧';
    }
    else if (c3.percentage < expectedRanges[3].min * defMult) {
        constitution = '脾氣虛弱';
        constitutionEmoji = '🍂';
    }
    else if (c4.percentage < expectedRanges[4].min * defMult) {
        constitution = '肺氣不足';
        constitutionEmoji = '🌬️';
    }
    // Healthy pattern: strict requires ALL harmonics in normal range
    else if (healthyOrder && c0.percentage >= expectedRanges[0].min &&
        (!strict || harmonics.every(h => h.status === '正常'))) {
        constitution = '氣血平衡';
        constitutionEmoji = '☯️';
    }
    else {
        constitution = '略有偏差';
        constitutionEmoji = '📊';
    }

    return {
        harmonics,
        fundFreq: Math.round(fundFreq * 100) / 100,
        constitution,
        constitutionEmoji,
        totalEnergy,
        healthyOrder,
        strict: !!strict,
        note: strict
            ? '⚠️ 嚴格模式：標準收窄，僅供深度參考，非臨床診斷'
            : '⚠️ rPPG 訊號僅供參考，臨床診斷請使用專業脈診儀'
    };
}
