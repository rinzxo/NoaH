const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function sanitizeNumber(num) {
    if (!num) return '';
    let cleaned = String(num).replace(/[^0-9]/g, '');
    if (cleaned.startsWith('08')) cleaned = '628' + cleaned.slice(2);
    if (cleaned.startsWith('8')) cleaned = '628' + cleaned.slice(1);
    return cleaned;
}

const ownerNumber = sanitizeNumber(process.env.OWNER_NUMBER || '6285282695970');
const botNumber = sanitizeNumber(process.env.BOT_NUMBER || '6281219363321');

module.exports = {
    botName: process.env.BOT_NAME || 'NoaH',
    ownerName: process.env.OWNER_NAME || 'Laksmana',
    ownerNumber,
    botNumber,
    botSessionDir: path.join(__dirname, '..', 'sessions', 'bot'),
    ownerSessionDir: path.join(__dirname, '..', 'sessions', 'owner'),
    dataPath: path.join(__dirname, '..', 'data', 'reminders.json'),
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        fromNumber: process.env.TWILIO_PHONE_NUMBER || ''
    }
};
