const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');

let genAI = null;
let model = null;

if (config.geminiApiKey) {
    try {
        genAI = new GoogleGenerativeAI(config.geminiApiKey);
        model = genAI.getGenerativeModel({ model: config.geminiModel });
    } catch (e) {
        console.warn('[AI] Inisialisasi Gemini gagal:', e.message);
    }
}

/**
 * Parsing teks bebas dari pengguna menggunakan AI untuk mendeteksi permintaan pengingat
 */
async function parseNaturalLanguageReminder(userMessage) {
    if (!model) return null;

    const now = new Date();
    const nowJakarta = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    const prompt = `
Kamu adalah asisten pengingat cerdas. Waktu saat ini di Jakarta: ${nowJakarta} (ISO: ${now.toISOString()}).
Pengguna mengirim pesan: "${userMessage}"

Tentukan apakah pengguna meminta untuk diingatkan/dibuatkan reminder.
Kembalikan HANYA format JSON valid tanpa markdown atau backticks:
{
  "isReminder": boolean,
  "reminderText": "teks apa yang harus diingatkan",
  "targetTimeISO": "YYYY-MM-DDTHH:mm:ss+07:00 (waktu pengingat harus dibunyikan dalam zona waktu Jakarta)",
  "callPhone": boolean (true jika user minta ditelepon/nelpon, false jika cukup chat/voice note),
  "replyMessage": "jawaban singkat ramah asisten jika bukan reminder"
}
Jika bukan permintaan pengingat, set isReminder: false.
`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        const cleanJson = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);
        return parsed;
    } catch (err) {
        console.warn('[AI] Gagal parse dengan AI:', err.message);
        return null;
    }
}

/**
 * Chat asisten umum dengan AI
 */
async function chatAssistant(userMessage) {
    if (!model) return 'Halo! Saya asisten privat Anda. Untuk membuat pengingat gunakan format:\n*!ingat <waktu> <pesan>*\nContoh:\n- *!ingat 15m Matikan kompor*\n- *!ingat 14:30 Meeting tim*\n- *!list* untuk cek jadwal.';

    try {
        const prompt = `Kamu adalah asisten pribadi privat WhatsApp yang ramah, sopan, ringkas, dan sigap membantu. Pengguna berkata: "${userMessage}". Balas dengan singkat dan jelas.`;
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (err) {
        return 'Maaf, asisten AI sedang tidak dapat merespons saat ini.';
    }
}

module.exports = {
    parseNaturalLanguageReminder,
    chatAssistant
};
