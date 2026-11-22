const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function sanitizeNumber(num) {
    if (!num) return '';
    let cleaned = String(num).replace(/[^0-9]/g, '');
    if (cleaned.startsWith('08')) cleaned = '628' + cleaned.slice(2);
    if (cleaned.startsWith('8')) cleaned = '628' + cleaned.slice(1);
    return cleaned;
}

module.exports = {
    ownerNumber: sanitizeNumber(process.env.OWNER_NUMBER || ''),
    botName: process.env.BOT_NAME || 'Private Asisten',
    sessionDir: path.join(__dirname, '..', 'sessions'),
    dataPath: path.join(__dirname, '..', 'data', 'reminders.json'),
    authMode: (process.env.AUTH_MODE || 'qr').toLowerCase(), // 'qr' or 'pairing'
    pairingNumber: sanitizeNumber(process.env.PAIRING_NUMBER || process.env.OWNER_NUMBER || ''),
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        fromNumber: process.env.TWILIO_PHONE_NUMBER || ''
    }
};
