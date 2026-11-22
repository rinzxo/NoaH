const fs = require('fs');
const path = require('path');
const config = require('./config');

const dataDir = path.dirname(config.dataPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function loadReminders() {
    try {
        if (!fs.existsSync(config.dataPath)) {
            fs.writeFileSync(config.dataPath, JSON.stringify([], null, 2));
            return [];
        }
        const data = fs.readFileSync(config.dataPath, 'utf-8');
        return JSON.parse(data || '[]');
    } catch (e) {
        console.error('[Reminder] Error reading file:', e.message);
        return [];
    }
}

function saveReminders(reminders) {
    try {
        fs.writeFileSync(config.dataPath, JSON.stringify(reminders, null, 2));
    } catch (e) {
        console.error('[Reminder] Error saving file:', e.message);
    }
}

function parseRelativeTime(input) {
    if (!input) return null;
    const trimmed = input.trim().toLowerCase();
    const now = new Date();

    // 10m / 10 menit
    const minuteMatch = trimmed.match(/^(\d+)\s*(m|menit|mins?|minutes?)$/);
    if (minuteMatch) {
        return new Date(now.getTime() + parseInt(minuteMatch[1], 10) * 60 * 1000);
    }

    // 2 jam / 2h
    const hourMatch = trimmed.match(/^(\d+)\s*(h|jam|hours?)$/);
    if (hourMatch) {
        return new Date(now.getTime() + parseInt(hourMatch[1], 10) * 60 * 60 * 1000);
    }

    // 1 hari / 1d
    const dayMatch = trimmed.match(/^(\d+)\s*(d|hari|days?)$/);
    if (dayMatch) {
        return new Date(now.getTime() + parseInt(dayMatch[1], 10) * 24 * 60 * 60 * 1000);
    }

    // Waktu spesifik: 14:30 atau 09.15
    const timeMatch = trimmed.match(/^(\d{1,2})[:.](\d{2})$/);
    if (timeMatch) {
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const target = new Date(now);
        target.setHours(hours, minutes, 0, 0);
        // Jika jam sudah lewat hari ini, jadwalkan untuk besok
        if (target.getTime() <= now.getTime()) {
            target.setDate(target.getDate() + 1);
        }
        return target;
    }

    // Format ISO string / standard Date parse
    const parsed = new Date(input);
    if (!isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) {
        return parsed;
    }

    return null;
}

function addReminder(text, targetDate, targetJid, options = {}) {
    const reminders = loadReminders();
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    const item = {
        id,
        text,
        targetTime: targetDate.getTime(),
        targetTimeString: targetDate.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        targetJid,
        voiceNote: options.voiceNote !== false,
        call: options.call === true,
        fired: false,
        createdAt: Date.now()
    };

    reminders.push(item);
    saveReminders(reminders);
    return item;
}

function listReminders(targetJid) {
    const reminders = loadReminders();
    const now = Date.now();
    return reminders.filter(r => (!targetJid || r.targetJid === targetJid) && !r.fired && r.targetTime > now);
}

function cancelReminder(id, targetJid) {
    const reminders = loadReminders();
    const index = reminders.findIndex(r => r.id === id && (!targetJid || r.targetJid === targetJid));
    if (index === -1) return false;
    reminders.splice(index, 1);
    saveReminders(reminders);
    return true;
}

function getDueReminders() {
    const reminders = loadReminders();
    const now = Date.now();
    return reminders.filter(r => !r.fired && r.targetTime <= now);
}

function markFired(id) {
    const reminders = loadReminders();
    const item = reminders.find(r => r.id === id);
    if (item) {
        item.fired = true;
        saveReminders(reminders);
    }
}

module.exports = {
    parseRelativeTime,
    addReminder,
    listReminders,
    cancelReminder,
    getDueReminders,
    markFired
};
