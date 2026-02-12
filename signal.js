// ===== Signal Processing Module =====
// CHROM algorithm, FFT, Butterworth filter, peak detection

/**
 * CHROM (Chrominance-based) rPPG algorithm
 * More robust than single green channel against motion/lighting changes
 */
function chromAlgorithm(rSignal, gSignal, bSignal) {
    const n = rSignal.length;
    if (n < 30) return gSignal.slice();

    const result = [];
    const winSize = Math.min(45, Math.floor(n / 2));

    for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - winSize);
        const end = Math.min(n, i + winSize);
        let mR = 0, mG = 0, mB = 0, cnt = 0;
        for (let j = start; j < end; j++) { mR += rSignal[j]; mG += gSignal[j]; mB += bSignal[j]; cnt++; }
        mR /= cnt; mG /= cnt; mB /= cnt;

        const rn = mR > 0 ? rSignal[i] / mR : 0;
        const gn = mG > 0 ? gSignal[i] / mG : 0;
        const bn = mB > 0 ? bSignal[i] / mB : 0;

        const x = 3 * rn - 2 * gn;
        const y = 1.5 * rn + gn - 1.5 * bn;

        const stdX = localStd(rSignal, i, winSize);
        const stdY = localStd(gSignal, i, winSize);
        const alpha = stdY > 0 ? stdX / stdY : 1;

        result.push(x - alpha * y);
    }
    return result;
}

function localStd(signal, center, winSize) {
    const start = Math.max(0, center - winSize);
    const end = Math.min(signal.length, center + winSize);
    let sum = 0, sq = 0, cnt = 0;
    for (let i = start; i < end; i++) { sum += signal[i]; sq += signal[i] * signal[i]; cnt++; }
    const mean = sum / cnt;
    return Math.sqrt(Math.max(0, sq / cnt - mean * mean));
}

/**
 * FFT-based heart rate estimation
 */
function fftHeartRate(signal, fps) {
    const n = nextPow2(signal.length);
    const re = new Float64Array(n);
    const im = new Float64Array(n);

    // Apply Hanning window
    for (let i = 0; i < signal.length; i++) {
        const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (signal.length - 1)));
        re[i] = signal[i] * w;
    }

    fft(re, im, n);

    // Find peak in HR range (40-200 BPM = 0.67-3.33 Hz)
    const minBin = Math.floor(0.67 * n / fps);
    const maxBin = Math.ceil(3.33 * n / fps);

    let maxMag = 0, peakBin = minBin;
    for (let i = minBin; i <= Math.min(maxBin, n / 2); i++) {
        const mag = re[i] * re[i] + im[i] * im[i];
        if (mag > maxMag) { maxMag = mag; peakBin = i; }
    }

    // Parabolic interpolation for sub-bin precision
    const k = peakBin;
    if (k > 0 && k < n / 2) {
        const mag = (i) => re[i] * re[i] + im[i] * im[i];
        const a = mag(k - 1), b = mag(k), c = mag(k + 1);
        const delta = (a - c) / (2 * (a - 2 * b + c));
        const refinedBin = k + (isFinite(delta) ? delta : 0);
        return (refinedBin * fps / n) * 60;
    }
    return (peakBin * fps / n) * 60;
}

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

// Cooley-Tukey in-place FFT
function fft(re, im, n) {
    // Bit-reversal
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        while (j & bit) { j ^= bit; bit >>= 1; }
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]];[im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len;
        const wRe = Math.cos(ang), wIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let curRe = 1, curIm = 0;
            for (let j = 0; j < len / 2; j++) {
                const tRe = curRe * re[i + j + len / 2] - curIm * im[i + j + len / 2];
                const tIm = curRe * im[i + j + len / 2] + curIm * re[i + j + len / 2];
                re[i + j + len / 2] = re[i + j] - tRe;
                im[i + j + len / 2] = im[i + j] - tIm;
                re[i + j] += tRe;
                im[i + j] += tIm;
                const newCurRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = newCurRe;
            }
        }
    }
}

/**
 * 2nd order Butterworth bandpass filter
 * Passband: 0.75 Hz - 3.5 Hz (45-210 BPM)
 */
function butterworthBandpass(signal, fps) {
    const fLow = 0.75, fHigh = 3.5;
    const wLow = Math.tan(Math.PI * fLow / fps);
    const wHigh = Math.tan(Math.PI * fHigh / fps);
    const bw = wHigh - wLow;
    const w0 = Math.sqrt(wLow * wHigh);
    const w0sq = w0 * w0;

    const Q = w0 / bw;
    const norm = 1 + bw / Q + w0sq;
    const a0 = bw / Q / norm;
    const a1 = 0;
    const a2 = -a0;
    const b1 = 2 * (w0sq - 1) / norm;
    const b2 = (1 - bw / Q + w0sq) / norm;

    const out = new Float64Array(signal.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < signal.length; i++) {
        const x0 = signal[i];
        out[i] = a0 * x0 + a1 * x1 + a2 * x2 - b1 * y1 - b2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = out[i];
    }
    return Array.from(out);
}

/**
 * Advanced peak detection with adaptive threshold
 */
function findPeaksAdaptive(signal, fps) {
    const peaks = [];
    const minDist = Math.floor(fps * 0.35); // min 0.35s between beats
    const windowSize = Math.floor(fps * 2);

    for (let i = 2; i < signal.length - 2; i++) {
        if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1] &&
            signal[i] > signal[i - 2] && signal[i] > signal[i + 2]) {
            // Adaptive threshold: must be above local mean + 0.3*std
            const start = Math.max(0, i - windowSize);
            const end = Math.min(signal.length, i + windowSize);
            let sum = 0, cnt = 0;
            for (let j = start; j < end; j++) { sum += signal[j]; cnt++; }
            const mean = sum / cnt;
            let variance = 0;
            for (let j = start; j < end; j++) variance += (signal[j] - mean) ** 2;
            const std = Math.sqrt(variance / cnt);

            if (signal[i] > mean + 0.3 * std) {
                if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDist) {
                    peaks.push(i);
                }
            }
        }
    }
    return peaks;
}

/**
 * Detrend signal using moving average subtraction
 */
function detrendSignal(signal, windowSize) {
    const result = [];
    for (let i = 0; i < signal.length; i++) {
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(signal.length, i + Math.floor(windowSize / 2));
        let sum = 0;
        for (let j = start; j < end; j++) sum += signal[j];
        result.push(signal[i] - sum / (end - start));
    }
    return result;
}

/**
 * Estimate FPS from timestamps
 */
function estimateFPS(timestamps) {
    if (timestamps.length < 2) return 30;
    return timestamps.length / ((timestamps[timestamps.length - 1] - timestamps[0]) / 1000);
}

// ===== ACCURACY IMPROVEMENTS =====

/**
 * POS (Plane-Orthogonal-to-Skin) algorithm
 * Wang et al. 2017 — state-of-the-art rPPG method
 * Better than CHROM at handling skin tone variations and illumination changes
 */
function posAlgorithm(rSignal, gSignal, bSignal, fps) {
    const n = rSignal.length;
    if (n < 30) return gSignal.slice();

    const winLen = Math.round(fps * 1.6); // ~1.6 second window
    const result = new Float64Array(n);

    for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - Math.floor(winLen / 2));
        const end = Math.min(n, i + Math.floor(winLen / 2));
        const cnt = end - start;

        // Temporal normalization
        let mR = 0, mG = 0, mB = 0;
        for (let j = start; j < end; j++) { mR += rSignal[j]; mG += gSignal[j]; mB += bSignal[j]; }
        mR /= cnt; mG /= cnt; mB /= cnt;

        if (mR === 0 || mG === 0 || mB === 0) { result[i] = 0; continue; }

        const rn = rSignal[i] / mR;
        const gn = gSignal[i] / mG;
        const bn = bSignal[i] / mB;

        // POS projection
        const S1 = gn - bn;
        const S2 = gn + bn - 2 * rn;

        // Compute std of S1 and S2 in window for alpha
        let sumS1 = 0, sumS2 = 0, sqS1 = 0, sqS2 = 0;
        for (let j = start; j < end; j++) {
            const r = rSignal[j] / mR, g = gSignal[j] / mG, b = bSignal[j] / mB;
            const s1 = g - b, s2 = g + b - 2 * r;
            sumS1 += s1; sumS2 += s2; sqS1 += s1 * s1; sqS2 += s2 * s2;
        }
        const stdS1 = Math.sqrt(Math.max(0, sqS1 / cnt - (sumS1 / cnt) ** 2));
        const stdS2 = Math.sqrt(Math.max(0, sqS2 / cnt - (sumS2 / cnt) ** 2));
        const alpha = stdS2 > 0 ? stdS1 / stdS2 : 1;

        result[i] = S1 + alpha * S2;
    }
    return Array.from(result);
}

/**
 * Overlapping window FFT (Welch's method)
 * Uses 75% overlap for higher frequency resolution and more stable estimates
 * Averages multiple periodograms to reduce noise in spectrum
 */
function welchFFTHeartRate(signal, fps) {
    const segLen = Math.min(nextPow2(signal.length), signal.length);
    const overlap = Math.floor(segLen * 0.75);
    const step = segLen - overlap;
    const nSegs = Math.floor((signal.length - segLen) / step) + 1;

    if (nSegs < 1) return fftHeartRate(signal, fps);

    const n = nextPow2(segLen);
    const avgSpectrum = new Float64Array(n / 2 + 1);

    for (let s = 0; s < nSegs; s++) {
        const offset = s * step;
        const re = new Float64Array(n);
        const im = new Float64Array(n);

        // Apply Hanning window to segment
        for (let i = 0; i < segLen && (offset + i) < signal.length; i++) {
            const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (segLen - 1)));
            re[i] = signal[offset + i] * w;
        }

        fft(re, im, n);

        // Accumulate power spectrum
        for (let i = 0; i <= n / 2; i++) {
            avgSpectrum[i] += (re[i] * re[i] + im[i] * im[i]) / nSegs;
        }
    }

    // Find peak in HR range (42-200 BPM = 0.7-3.33 Hz)
    const minBin = Math.max(1, Math.floor(0.7 * n / fps));
    const maxBin = Math.min(Math.ceil(3.33 * n / fps), n / 2);

    let maxMag = 0, peakBin = minBin;
    for (let i = minBin; i <= maxBin; i++) {
        if (avgSpectrum[i] > maxMag) { maxMag = avgSpectrum[i]; peakBin = i; }
    }

    // Parabolic interpolation
    if (peakBin > minBin && peakBin < maxBin) {
        const a = avgSpectrum[peakBin - 1], b = avgSpectrum[peakBin], c = avgSpectrum[peakBin + 1];
        const denom = 2 * (a - 2 * b + c);
        if (denom !== 0) {
            const delta = (a - c) / denom;
            if (isFinite(delta) && Math.abs(delta) < 1) {
                return ((peakBin + delta) * fps / n) * 60;
            }
        }
    }
    return (peakBin * fps / n) * 60;
}

/**
 * Signal quality assessment with SNR calculation
 * Returns a quality score 0-100 and whether the signal is usable
 */
function assessSignalQuality(signal, fps) {
    if (signal.length < 60) return { score: 0, usable: false, snr: 0 };

    const n = nextPow2(signal.length);
    const re = new Float64Array(n);
    const im = new Float64Array(n);

    for (let i = 0; i < signal.length; i++) {
        const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (signal.length - 1)));
        re[i] = signal[i] * w;
    }
    fft(re, im, n);

    // HR band: 0.7-3.33 Hz
    const hrMin = Math.max(1, Math.floor(0.7 * n / fps));
    const hrMax = Math.min(Math.ceil(3.33 * n / fps), n / 2);

    let signalPower = 0, totalPower = 0, peakPower = 0;
    for (let i = 1; i <= n / 2; i++) {
        const p = re[i] * re[i] + im[i] * im[i];
        totalPower += p;
        if (i >= hrMin && i <= hrMax) {
            signalPower += p;
            if (p > peakPower) peakPower = p;
        }
    }

    const noisePower = totalPower - signalPower;
    const snr = noisePower > 0 ? 10 * Math.log10(signalPower / noisePower) : 0;

    // Peak-to-average ratio (sharper peak = cleaner signal)
    const avgHRPower = signalPower / (hrMax - hrMin + 1);
    const par = avgHRPower > 0 ? peakPower / avgHRPower : 0;

    // Combined quality score
    let score = 0;
    if (snr > 0) score += Math.min(40, snr * 8);        // SNR contribution
    if (par > 2) score += Math.min(35, (par - 2) * 7);  // Peak sharpness
    // Stationarity check (signal std shouldn't vary too much)
    const half = Math.floor(signal.length / 2);
    const std1 = arrayStd(signal.slice(0, half));
    const std2 = arrayStd(signal.slice(half));
    const stationarity = std1 > 0 ? Math.min(std1, std2) / Math.max(std1, std2) : 0;
    score += stationarity * 25;

    score = Math.min(99, Math.max(0, Math.round(score)));
    return { score, usable: score > 25, snr: Math.round(snr * 10) / 10 };
}

function arrayStd(arr) {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

/**
 * IQR-based outlier rejection for HR values
 * Removes values outside 1.5*IQR from median
 */
function rejectOutliersIQR(values) {
    if (values.length < 4) return values.slice();

    const sorted = values.slice().sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;

    return values.filter(v => v >= lower && v <= upper);
}

/**
 * Motion artifact detection
 * Detects large frame-to-frame changes that indicate head movement
 * Returns true if motion is detected (signal should be discarded)
 */
function detectMotionArtifact(rSignal, gSignal, bSignal, windowSize) {
    if (rSignal.length < windowSize + 1) return false;

    const start = rSignal.length - windowSize;
    let maxDelta = 0;

    for (let i = start + 1; i < rSignal.length; i++) {
        const dR = Math.abs(rSignal[i] - rSignal[i - 1]);
        const dG = Math.abs(gSignal[i] - gSignal[i - 1]);
        const dB = Math.abs(bSignal[i] - bSignal[i - 1]);
        const delta = dR + dG + dB;
        if (delta > maxDelta) maxDelta = delta;
    }

    // Mean RGB level for normalization
    let meanLevel = 0;
    for (let i = start; i < rSignal.length; i++) {
        meanLevel += rSignal[i] + gSignal[i] + bSignal[i];
    }
    meanLevel /= (windowSize * 3);

    // If max frame-to-frame change exceeds 8% of mean level, it's motion
    return meanLevel > 0 && (maxDelta / meanLevel) > 0.08;
}

/**
 * Ambient light compensation
 * Removes slow brightness variations by high-pass filtering the luminance
 */
function compensateAmbientLight(rSignal, gSignal, bSignal) {
    const n = rSignal.length;
    if (n < 10) return { r: rSignal.slice(), g: gSignal.slice(), b: bSignal.slice() };

    // Compute luminance
    const lum = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        lum[i] = 0.299 * rSignal[i] + 0.587 * gSignal[i] + 0.114 * bSignal[i];
    }

    // Smooth luminance (moving average, ~2 second window at 30fps)
    const winSize = 60;
    const smoothLum = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const s = Math.max(0, i - Math.floor(winSize / 2));
        const e = Math.min(n, i + Math.floor(winSize / 2));
        let sum = 0;
        for (let j = s; j < e; j++) sum += lum[j];
        smoothLum[i] = sum / (e - s);
    }

    // Normalize each channel by smoothed luminance ratio
    const rOut = [], gOut = [], bOut = [];
    for (let i = 0; i < n; i++) {
        const ratio = smoothLum[i] > 0 ? lum[0] / smoothLum[i] : 1; // normalize to initial brightness
        rOut.push(rSignal[i] * ratio);
        gOut.push(gSignal[i] * ratio);
        bOut.push(bSignal[i] * ratio);
    }

    return { r: rOut, g: gOut, b: bOut };
}

/**
 * Combined best-estimate HR using both POS and CHROM, weighted by quality
 */
function fusedHeartRate(rSignal, gSignal, bSignal, fps) {
    const compensated = compensateAmbientLight(rSignal, gSignal, bSignal);
    const r = compensated.r, g = compensated.g, b = compensated.b;

    const posSig = posAlgorithm(r, g, b, fps);
    const chromSig = chromAlgorithm(r, g, b);

    const posFiltered = butterworthBandpass(posSig, fps);
    const chromFiltered = butterworthBandpass(chromSig, fps);

    const posQuality = assessSignalQuality(posFiltered, fps);
    const chromQuality = assessSignalQuality(chromFiltered, fps);

    const posHR = welchFFTHeartRate(posFiltered, fps);
    const chromHR = welchFFTHeartRate(chromFiltered, fps);

    // Weight by quality score
    const totalQ = posQuality.score + chromQuality.score;
    let bestHR, bestFiltered, bestQuality;

    if (totalQ === 0) {
        bestHR = posHR;
        bestFiltered = posFiltered;
        bestQuality = posQuality;
    } else {
        bestHR = (posHR * posQuality.score + chromHR * chromQuality.score) / totalQ;
        bestFiltered = posQuality.score >= chromQuality.score ? posFiltered : chromFiltered;
        bestQuality = posQuality.score >= chromQuality.score ? posQuality : chromQuality;
    }

    return { hr: bestHR, filtered: bestFiltered, quality: bestQuality };
}
