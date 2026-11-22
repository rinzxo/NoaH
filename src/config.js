const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function sanitizeNumbers(nums) {
    if (!nums) return [];
    return String(nums).split(',').map(n => {
        let cleaned = n.trim().replace(/[^0-9]/g, '');
        if (cleaned.startsWith('08')) cleaned = '628' + cleaned.slice(2);
        if (cleaned.startsWith('8')) cleaned = '628' + cleaned.slice(1);
        return cleaned;
    }).filter(Boolean);
}

const ownerNumbers = sanitizeNumbers(process.env.OWNER_NUMBER || '');

module.exports = {
    ownerNumbers,
    ownerNumber: ownerNumbers[0] || '',
    botName: process.env.BOT_NAME || 'Private Asisten',
    sessionDir: path.join(__dirname, '..', 'sessions'),
    dataPath: path.join(__dirname, '..', 'data', 'reminders.json'),
    authMode: (process.env.AUTH_MODE || 'qr').toLowerCase(),
    pairingNumber: sanitizeNumbers(process.env.PAIRING_NUMBER || process.env.OWNER_NUMBER || '')[0] || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        fromNumber: process.env.TWILIO_PHONE_NUMBER || ''
    }
};
