// ===== rPPG Pro — 純前端歷史記錄模組 (localStorage) =====

function getCurrentUser() {
    return localStorage.getItem('rppg_current_user') || 'default';
}

function setCurrentUser(userId) {
    localStorage.setItem('rppg_current_user', userId);
}

// ===== Sessions (localStorage) =====
function _getSessionsStore() {
    try {
        return JSON.parse(localStorage.getItem('rppg_sessions') || '[]');
    } catch { return []; }
}

function _saveSessionsStore(sessions) {
    localStorage.setItem('rppg_sessions', JSON.stringify(sessions));
}

async function saveSession(sessionData) {
    try {
        const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '_' + Math.random().toString(36).slice(2, 8);
        const session = {
            id,
            user_id: getCurrentUser(),
            timestamp: sessionData.timestamp || new Date().toISOString(),
            duration: sessionData.duration || 0,
            avg_hr: sessionData.avgHR || null,
            max_hr: sessionData.maxHR || null,
            min_hr: sessionData.minHR || null,
            avg_hrv: sessionData.avgHRV || null,
            avg_spo2: sessionData.avgSpO2 || null,
            avg_breath: sessionData.avgBreath || null,
            quality_score: sessionData.qualityScore || 0,
            constitution: sessionData.constitution || '',
            constitution_emoji: sessionData.constitutionEmoji || '',
            emotion: sessionData.emotion || '',
            harmonics: sessionData.harmonics || null
        };
        const sessions = _getSessionsStore();
        sessions.unshift(session); // newest first
        // Keep max 500 sessions to avoid localStorage overflow
        if (sessions.length > 500) sessions.length = 500;
        _saveSessionsStore(sessions);
        console.log('✅ Session saved:', id);
        return { id, status: 'saved' };
    } catch (e) {
        console.warn('Save failed:', e);
        return null;
    }
}

async function getSessions(limit = 100) {
    const userId = getCurrentUser();
    const sessions = _getSessionsStore()
        .filter(s => s.user_id === userId)
        .slice(0, limit);
    return sessions;
}

async function deleteSession(id) {
    const sessions = _getSessionsStore().filter(s => s.id !== id);
    _saveSessionsStore(sessions);
    return { status: 'deleted' };
}

async function clearAllSessions() {
    const userId = getCurrentUser();
    const sessions = _getSessionsStore().filter(s => s.user_id !== userId);
    _saveSessionsStore(sessions);
    return { status: 'cleared' };
}

// ===== Users (localStorage) =====
function _getUsersStore() {
    try {
        const users = JSON.parse(localStorage.getItem('rppg_users') || '[]');
        // Ensure default user exists
        if (!users.find(u => u.username === 'default')) {
            users.unshift({ id: 0, username: 'default', display_name: '訪客' });
            localStorage.setItem('rppg_users', JSON.stringify(users));
        }
        return users;
    } catch { return [{ id: 0, username: 'default', display_name: '訪客' }]; }
}

async function getUsers() {
    return _getUsersStore();
}

async function createUser(username, displayName) {
    const users = _getUsersStore();
    const existing = users.find(u => u.username === username);
    if (existing) return existing;
    const newUser = {
        id: Date.now(),
        username,
        display_name: displayName || username
    };
    users.push(newUser);
    localStorage.setItem('rppg_users', JSON.stringify(users));
    return newUser;
}

// ===== Export CSV =====
function exportSessionsCSV() {
    const sessions = _getSessionsStore().filter(s => s.user_id === getCurrentUser());
    if (!sessions.length) { alert('沒有記錄可匯出'); return; }
    const headers = ['日期', '時長(秒)', '平均心率', '最高心率', '最低心率', 'HRV', 'SpO2', '呼吸率', '品質', '體質', '情緒'];
    const rows = sessions.map(s => [
        s.timestamp, s.duration, s.avg_hr, s.max_hr, s.min_hr,
        s.avg_hrv, s.avg_spo2, s.avg_breath, s.quality_score,
        s.constitution, s.emotion
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rppg_${getCurrentUser()}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}
