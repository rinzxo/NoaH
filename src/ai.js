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
 * Memproses pesan alami pengguna layaknya asisten pribadi sungguhan tanpa perlu command.
 * Mengembalikan objek aksi: CREATE_REMINDER, LIST_REMINDERS, CANCEL_REMINDER, atau CHAT.
 */
async function processAssistantMessage(userMessage, activeReminders = []) {
    if (!model) return null;

    const now = new Date();
    const nowJakarta = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    const remindersContext = activeReminders.map(r => ({
        id: r.id,
        text: r.text,
        waktu: r.targetTimeString,
        call: r.call
    }));

    const prompt = `
Kamu adalah ${config.botName || 'Noah'}, asisten pribadi privat yang sangat cerdas, ramah, dan sigap di WhatsApp.
Zona waktu saat ini: Asia/Jakarta.
Waktu sekarang: ${nowJakarta} (ISO: ${now.toISOString()}).

Daftar pengingat aktif pengguna saat ini:
${JSON.stringify(remindersContext, null, 2)}

Pesan dari pengguna: "${userMessage}"

Tugasmu:
Pahami maksud pengguna dan tentukan aksinya. Kembalikan HANYA format JSON valid tanpa tanda kutip markdown (\`\`\`json):
{
  "action": "CREATE_REMINDER" | "LIST_REMINDERS" | "CANCEL_REMINDER" | "CHAT",
  "reminder": {
    "text": "hal yang diingatkan (ringkas & jelas)",
    "targetTimeISO": "YYYY-MM-DDTHH:mm:ss+07:00 (hitung waktu yang tepat sesuai permintaan waktu relatif/absolut pengguna)",
    "call": boolean (true jika user minta ditelepon/nelpon, false jika cukup chat/voice note)
  },
  "cancelId": "ID pengingat jika user ingin membatalkan, atau null",
  "reply": "Balasan personal yang ramah, sopan, dan profesional layaknya sekretaris pribadi hebat."
}

Petunjuk:
1. Jika pengguna meminta diingatkan (misal: "ingetin 10 menit lagi", "besok jam 8 meeting", "nanti sore telpon gw"):
   - Set action: "CREATE_REMINDER"
   - Hitung targetTimeISO dengan akurat dari waktu saat ini.
   - Di field "reply", konfirmasikan dengan ramah bahwa pengingat telah dicatat beserta jam berbunyinya.
2. Jika pengguna menanyakan jadwal/pengingat (misal: "ada jadwal apa aja", "list pengingat", "apa agenda hari ini"):
   - Set action: "LIST_REMINDERS"
   - Di field "reply", sebutkan daftar pengingat yang aktif secara natural. Jika kosong, beri tahu dengan santun.
3. Jika pengguna ingin membatalkan/menghapus pengingat:
   - Set action: "CANCEL_REMINDER"
   - Cari ID yang cocok dari daftar di atas ke field "cancelId".
4. Selain itu (obrolan umum, brainstorming, tanya kabar, konsultasi):
   - Set action: "CHAT"
   - Jawab secara cerdas, ringkas, dan hangat.
`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        const cleanJson = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (err) {
        console.warn('[AI] Error in processAssistantMessage:', err.message);
        return null;
    }
}

module.exports = {
    processAssistantMessage
};
