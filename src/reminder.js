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

    // 1. Relatif menit: 10m / 10 menit
    const minuteMatch = trimmed.match(/^(\d+)\s*(m|menit|mins?|minutes?)$/i);
    if (minuteMatch) {
        return new Date(now.getTime() + parseInt(minuteMatch[1], 10) * 60 * 1000);
    }

    // 2. Relatif jam: 2 jam / 2h
    const hourMatch = trimmed.match(/^(\d+)\s*(h|jam|hours?)$/i);
    if (hourMatch) {
        return new Date(now.getTime() + parseInt(hourMatch[1], 10) * 60 * 60 * 1000);
    }

    // 3. Relatif hari: 1 hari / 1d
    const dayMatch = trimmed.match(/^(\d+)\s*(d|hari|days?)$/i);
    if (dayMatch) {
        return new Date(now.getTime() + parseInt(dayMatch[1], 10) * 24 * 60 * 60 * 1000);
    }

    // 4. Waktu spesifik dalam WIB (Asia/Jakarta, UTC+7)
    // Mendukung: "20:00", "08.30", "jam 8 malam", "8 malam", "setengah 9 malam", "jam 2 siang", dll.
    let hours = -1;
    let minutes = 0;

    const setHourMatch = trimmed.match(/^setengah\s+(\d{1,2})\s*(pagi|siang|sore|malam)?$/i);
    const indHourMatch = trimmed.match(/^(?:jam\s+)?(\d{1,2})(?::(\d{2})|\.(\d{2}))?\s*(pagi|siang|sore|malam)?$/i);

    if (setHourMatch) {
        let h = parseInt(setHourMatch[1], 10);
        const period = (setHourMatch[2] || '').toLowerCase();
        if ((period === 'malam' || period === 'sore') && h < 12) h += 12;
        if (period === 'siang' && h < 12 && h <= 3) h += 12;
        h = h - 1; // setengah 8 = 07:30
        hours = h;
        minutes = 30;
    } else if (indHourMatch) {
        let h = parseInt(indHourMatch[1], 10);
        let m = parseInt(indHourMatch[2] || indHourMatch[3] || '0', 10);
        const period = (indHourMatch[4] || '').toLowerCase();
        if ((period === 'malam' || period === 'sore') && h < 12) h += 12;
        if (period === 'siang' && h < 12 && (h === 1 || h === 2 || h === 3)) h += 12;
        hours = h;
        minutes = m;
    }

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        // Dapatkan tanggal hari ini di zona waktu Asia/Jakarta (WIB)
        const jakartaStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
        const jakartaDate = new Date(jakartaStr);

        const targetYear = jakartaDate.getFullYear();
        const targetMonth = jakartaDate.getMonth();
        const targetDay = jakartaDate.getDate();

        // Hitung milidetik UTC untuk jam WIB (WIB = UTC+7)
        let targetUtcMs = Date.UTC(targetYear, targetMonth, targetDay, hours - 7, minutes, 0, 0);

        // Jika jam tersebut sudah lewat hari ini di Jakarta, jadwalkan untuk besok
        if (targetUtcMs <= now.getTime()) {
            targetUtcMs += 24 * 60 * 60 * 1000;
        }

        return new Date(targetUtcMs);
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
