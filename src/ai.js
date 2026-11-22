const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');
const reminder = require('./reminder');

let genAI = null;
let model = null;

const tools = [
    {
        name: 'buat_pengingat',
        description: 'Membuat jadwal pengingat (reminder) baru untuk pengguna. Dipanggil ketika pengguna meminta diingatkan, memesan alarm, atau membuat janji/kegiatan.',
        parameters: {
            type: 'OBJECT',
            properties: {
                pesan: {
                    type: 'STRING',
                    description: 'Isi pengingat atau kegiatan yang harus dilakukan (contoh: "Angkat jemuran", "Minum obat", "Meeting klien").'
                },
                menit_dari_sekarang: {
                    type: 'NUMBER',
                    description: 'Jumlah menit dari sekarang pengingat harus dibunyikan (contoh: 10, 15, 60, 120).'
                },
                jam_spesifik: {
                    type: 'STRING',
                    description: 'Jam spesifik berbunyi format HH:mm (contoh: "14:30", "09:00", "20:00").'
                },
                dengan_telepon: {
                    type: 'BOOLEAN',
                    description: 'True jika pengguna meminta ditelepon / panggilan suara, false jika cukup chat & pesan suara.'
                }
            },
            required: ['pesan']
        }
    },
    {
        name: 'lihat_daftar_pengingat',
        description: 'Melihat seluruh daftar pengingat yang sedang aktif dan belum selesai.',
        parameters: {
            type: 'OBJECT',
            properties: {}
        }
    },
    {
        name: 'batalkan_pengingat',
        description: 'Membatalkan atau menghapus jadwal pengingat yang sudah dibuat.',
        parameters: {
            type: 'OBJECT',
            properties: {
                id_pengingat: {
                    type: 'STRING',
                    description: 'ID unik pengingat jika pengguna menyebutkannya (contoh: "k9x2m").'
                },
                kata_kunci: {
                    type: 'STRING',
                    description: 'Kata kunci nama kegiatan yang ingin dibatalkan jika ID tidak diketahui (contoh: "jemuran", "obat").'
                }
            }
        }
    }
];

if (config.geminiApiKey) {
    try {
        genAI = new GoogleGenerativeAI(config.geminiApiKey);
        model = genAI.getGenerativeModel({
            model: config.geminiModel || 'gemini-3.5-flash-lite',
            tools: [{ functionDeclarations: tools }]
        });
    } catch (e) {
        console.warn('[AI] Inisialisasi Gemini Tools gagal:', e.message);
    }
}

// Memory percakapan singkat per pengirim
const chatSessions = new Map();

function getChatSession(senderJid) {
    if (!chatSessions.has(senderJid)) {
        chatSessions.set(senderJid, []);
    }
    return chatSessions.get(senderJid);
}

function addToHistory(senderJid, role, text) {
    const history = getChatSession(senderJid);
    history.push({ role, parts: [{ text }] });
    if (history.length > 10) history.shift();
}

/**
 * Handle pesan masuk menggunakan Gemini AI Function Calling (AI Tools)
 */
async function handleUserMessageWithAI(userText, senderJid) {
    if (!model) {
        return 'Maaf, kunci Gemini API belum terpasang dengan benar di .env.';
    }

    const now = new Date();
    const nowJakarta = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const systemContext = `[Sistem: Kamu adalah Noah, asisten pribadi privat AI WhatsApp yang cerdas, sopan, dan sigap. Waktu saat ini di Jakarta: ${nowJakarta} (${now.toISOString()}). Gunakan tools yang tersedia jika pengguna ingin membuat, melihat, atau membatalkan pengingat.]`;

    const history = getChatSession(senderJid);
    const contents = [
        ...history,
        { role: 'user', parts: [{ text: `${systemContext}\nPengguna: ${userText}` }] }
    ];

    try {
        const result = await model.generateContent({ contents });
        const response = result.response;
        const functionCalls = response.functionCalls();

        // 1. Jika Gemini memanggil Tool
        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            console.log(`🤖 [AI Tool Call] Memanggil tool "${call.name}" dengan parameter:`, call.args);

            // Tool: buat_pengingat
            if (call.name === 'buat_pengingat') {
                const { pesan, menit_dari_sekarang, jam_spesifik, dengan_telepon } = call.args;
                let targetDate = null;

                if (menit_dari_sekarang) {
                    targetDate = new Date(Date.now() + Math.round(menit_dari_sekarang * 60 * 1000));
                } else if (jam_spesifik) {
                    targetDate = reminder.parseRelativeTime(jam_spesifik);
                } else {
                    targetDate = new Date(Date.now() + 10 * 60 * 1000); // default 10m
                }

                const item = reminder.addReminder(pesan, targetDate, senderJid, {
                    voiceNote: true,
                    call: Boolean(dengan_telepon)
                });

                const reply = `✅ *Siap! Pengingat Berhasil Dicatat*\n\n` +
                    `📝 *Kegiatan:* ${item.text}\n` +
                    `🕒 *Waktu:* ${item.targetTimeString}\n` +
                    `🔔 *Notifikasi:* Pesan WA + Voice Note ${item.call ? '+ Panggilan Telepon' : ''}\n\n` +
                    `_Saya akan langsung kabari kamu begitu waktunya tiba!_`;

                addToHistory(senderJid, 'user', userText);
                addToHistory(senderJid, 'model', reply);
                return reply;
            }

            // Tool: lihat_daftar_pengingat
            if (call.name === 'lihat_daftar_pengingat') {
                const list = reminder.listReminders(senderJid);
                let reply = '';
                if (list.length === 0) {
                    reply = '📭 Saat ini belum ada jadwal pengingat yang aktif. Ada yang ingin kamu jadwalkan?';
                } else {
                    reply = `📋 *Daftar Pengingat Aktif Kamu (${list.length}):*\n\n`;
                    list.forEach((item, idx) => {
                        reply += `${idx + 1}. *${item.text}*\n   🕒 Waktu: ${item.targetTimeString} (ID: ${item.id})\n\n`;
                    });
                    reply += `_Beri tahu saya jika ada yang ingin dibatalkan atau ditambahkan!_`;
                }

                addToHistory(senderJid, 'user', userText);
                addToHistory(senderJid, 'model', reply);
                return reply;
            }

            // Tool: batalkan_pengingat
            if (call.name === 'batalkan_pengingat') {
                const { id_pengingat, kata_kunci } = call.args;
                const list = reminder.listReminders(senderJid);
                let target = null;

                if (id_pengingat) {
                    target = list.find(r => r.id === id_pengingat);
                } else if (kata_kunci) {
                    const kw = kata_kunci.toLowerCase();
                    target = list.find(r => r.text.toLowerCase().includes(kw));
                }

                if (target) {
                    reminder.cancelReminder(target.id, senderJid);
                    const reply = `✅ Pengingat *"${target.text}"* untuk ${target.targetTimeString} telah berhasil dibatalkan.`;
                    addToHistory(senderJid, 'user', userText);
                    addToHistory(senderJid, 'model', reply);
                    return reply;
                } else {
                    const reply = `Maaf, saya tidak menemukan jadwal pengingat yang cocok untuk dibatalkan. Kamu bisa ketik *"cek jadwal"* untuk melihat daftar aktif.`;
                    addToHistory(senderJid, 'user', userText);
                    addToHistory(senderJid, 'model', reply);
                    return reply;
                }
            }
        }

        // 2. Jika bukan tool (obrolan santai, tanya informasi, brainstorming)
        const reply = response.text().trim();
        addToHistory(senderJid, 'user', userText);
        addToHistory(senderJid, 'model', reply);
        return reply;
    } catch (err) {
        console.error('[AI Tool Error]:', err.message);
        return 'Maaf, asisten AI sedang memproses data sejenak. Coba tanyakan lagi ya!';
    }
}

module.exports = {
    handleUserMessageWithAI
};
