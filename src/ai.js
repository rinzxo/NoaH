const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');
const reminder = require('./reminder');
const { searchWeb } = require('./search');
const groupManager = require('./groupManager');

let genAI = null;
let modelWithTools = null;
let modelGeneral = null;
let socketGetter = null;

function setSockets(getter) {
    socketGetter = getter;
}

const tools = [
    {
        name: 'buat_pengingat',
        description: 'Membuat jadwal pengingat baru untuk Laksmana.',
        parameters: {
            type: 'OBJECT',
            properties: {
                pesan: {
                    type: 'STRING',
                    description: 'Isi pengingat atau tugas (contoh: "Minum obat", "Meeting klien", "Transfer tagihan").'
                },
                menit_dari_sekarang: {
                    type: 'NUMBER',
                    description: 'Jumlah menit dari sekarang pengingat harus berdering.'
                },
                jam_spesifik: {
                    type: 'STRING',
                    description: 'Jam spesifik berbunyi format HH:mm (contoh: "14:30", "09:00").'
                },
                dengan_telepon: {
                    type: 'BOOLEAN',
                    description: 'True jika Laksmana meminta ditelepon / panggilan suara.'
                }
            },
            required: ['pesan']
        }
    },
    {
        name: 'lihat_daftar_pengingat',
        description: 'Melihat seluruh daftar pengingat Laksmana yang sedang aktif.',
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
                    description: 'ID pengingat jika diketahui.'
                },
                kata_kunci: {
                    type: 'STRING',
                    description: 'Nama tugas/kegiatan yang ingin dibatalkan.'
                }
            }
        }
    },
    {
        name: 'cari_informasi_web',
        description: 'Mencari informasi terkini, berita, fakta, harga, cuaca, atau data dari internet. Dipanggil saat Laksmana meminta mencari informasi atau menanyakan hal-hal yang membutuhkan data live/terbaru.',
        parameters: {
            type: 'OBJECT',
            properties: {
                query: {
                    type: 'STRING',
                    description: 'Kata kunci pencarian yang ringkas dan relevan (contoh: "jadwal bola timnas", "kurs dollar hari ini", "cuaca jakarta", "gempa terkini").'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'rangkum_grup',
        description: 'Meringkas dan merangkum pesan-pesan penting dari grup WhatsApp yang diikuti Bapak Laksmana tanpa mengganggu alur grup.',
        parameters: {
            type: 'OBJECT',
            properties: {
                nama_grup: {
                    type: 'STRING',
                    description: 'Nama grup spesifik (misal: "OSIS", "Office", "Rinz Group", "DesainKita") atau biarkan kosong untuk merangkum seluruh grup aktif.'
                }
            }
        }
    },
    {
        name: 'daftar_grup',
        description: 'Melihat daftar nama grup WhatsApp yang sedang dipantau oleh NoaH beserta jumlah pesan terekam.',
        parameters: {
            type: 'OBJECT',
            properties: {}
        }
    },
    {
        name: 'kirim_pesan_wa',
        description: 'Mengirimkan pesan WhatsApp langsung dan real-time ke grup WhatsApp atau ke kontak/nomor HP tertentu atas nama Pak Laksmana. Panggil tool ini setiap kali Pak Laksmana meminta menyampaikan pesan, membalas, atau mengabarkan sesuatu ke grup atau kontak.',
        parameters: {
            type: 'OBJECT',
            properties: {
                tujuan: {
                    type: 'STRING',
                    description: 'Nama grup WhatsApp tujuan (misal: "RG3C+ Komisi C SMANDU ( KitaAtur )", "Marketing | Rinz Group", "Key Frame") atau nama kontak/nomor HP.'
                },
                pesan: {
                    type: 'STRING',
                    description: 'Isi teks pesan lengkap yang akan dikirimkan ke tujuan.'
                }
            },
            required: ['tujuan', 'pesan']
        }
    }
];

if (config.geminiApiKey) {
    try {
        genAI = new GoogleGenerativeAI(config.geminiApiKey);
        modelWithTools = genAI.getGenerativeModel({
            model: config.geminiModel || 'gemini-3.5-flash-lite',
            tools: [{ functionDeclarations: tools }]
        });
        modelGeneral = genAI.getGenerativeModel({
            model: config.geminiModel || 'gemini-3.5-flash-lite'
        });
    } catch (e) {
        console.warn('[AI] Inisialisasi Gemini gagal:', e.message);
    }
}

// Memory percakapan singkat
const ownerChatHistory = [];
const guestChatHistory = new Map(); // guestJid -> history

function addHistory(historyArr, role, text) {
    historyArr.push({ role, parts: [{ text }] });
    if (historyArr.length > 10) historyArr.shift();
}

/**
 * 1. Menangani pesan langsung dari Laksmana (Owner) ke NoaH
 */
async function handleOwnerMessage(userText, senderJid) {
    if (!modelWithTools) {
        return 'Maaf Pak Laksmana, API Gemini belum terhubung di sistem.';
    }

    const now = new Date();
    const nowJakarta = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const systemContext = `[Sistem: Kamu adalah NoaH, asisten pribadi setia, cerdas, dan tanggap dari Bapak Laksmana Ibrahim Rino.
PROFIL OWNER:
Bapak Laksmana Ibrahim Rino adalah Founder & CEO dari Rinz Group Inovasi, sebuah entitas teknologi digital yang menaungi:
1. KitaPay (kitapay.rinzgroup.web.id) - Layanan pembayaran digital QRIS instan dan payment gateway.
2. KitaAtur (kitaatur.rinzgroup.web.id) - Aplikasi PWA manajemen kas, absensi, dan pembukuan organisasi.
3. DesainKita / KitaCom - Layanan desain grafis dan branding visual.
4. NoaH Assistant - Asisten pribadi pintar berbasis AI.
Website resmi: rinzgroup.web.id.

Waktu Jakarta: ${nowJakarta}.
Bersikaplah sangat hormat, cerdas, hangat, sigap, dan solutif. Panggil beliau "Pak Laksmana" atau "Mas Laksmana".
Kamu MEMILIKI AKSES PENUH untuk mengirim pesan secara langsung dan real-time ke grup WhatsApp mana pun yang diikuti Pak Laksmana atau ke kontak siapa pun atas perintah beliau menggunakan tool \`kirim_pesan_wa\`.
Gunakan tools yang tersedia jika beliau ingin:
- Mengirim pesan atau mewakili beliau berbicara di grup/kontak (\`kirim_pesan_wa\`).
- Merangkum obrolan grup WhatsApp (\`rangkum_grup\` atau \`daftar_grup\`).
- Membuat jadwal/agenda (\`buat_pengingat\`, \`lihat_daftar_pengingat\`, \`batalkan_pengingat\`).
- Mencari informasi web (\`cari_informasi_web\`).]`;

    const contents = [
        ...ownerChatHistory,
        { role: 'user', parts: [{ text: `${systemContext}\nLaksmana: ${userText}` }] }
    ];

    try {
        const result = await modelWithTools.generateContent({ contents });
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            console.log(`🤖 [NoaH Tool] Eksekusi "${call.name}":`, call.args);

            // Tool: buat_pengingat
            if (call.name === 'buat_pengingat') {
                const { pesan, menit_dari_sekarang, jam_spesifik, dengan_telepon } = call.args;
                let targetDate = null;

                if (menit_dari_sekarang) {
                    targetDate = new Date(Date.now() + Math.round(menit_dari_sekarang * 60 * 1000));
                } else if (jam_spesifik) {
                    targetDate = reminder.parseRelativeTime(jam_spesifik);
                } else {
                    targetDate = new Date(Date.now() + 10 * 60 * 1000);
                }

                const item = reminder.addReminder(pesan, targetDate, senderJid, {
                    voiceNote: true,
                    call: Boolean(dengan_telepon)
                });

                const reply = `Siap Pak Laksmana! Pengingat telah saya jadwalkan:\n\n` +
                    `📝 *Kegiatan:* ${item.text}\n` +
                    `🕒 *Waktu:* ${item.targetTimeString}\n` +
                    `🔔 *Notifikasi:* Teks WA + Voice Note ${item.call ? '+ Telepon Langsung' : ''}\n\n` +
                    `Tenang saja, saya akan ingatkan tepat pada waktunya.`;

                addHistory(ownerChatHistory, 'user', userText);
                addHistory(ownerChatHistory, 'model', reply);
                return reply;
            }

            // Tool: lihat_daftar_pengingat
            if (call.name === 'lihat_daftar_pengingat') {
                const list = reminder.listReminders(senderJid);
                let reply = '';
                if (list.length === 0) {
                    reply = 'Saat ini belum ada jadwal pengingat yang aktif, Pak Laksmana. Ada kegiatan atau tugas yang ingin saya jadwalkan?';
                } else {
                    reply = `📋 *Daftar Agenda & Pengingat Aktif (${list.length}):*\n\n`;
                    list.forEach((item, idx) => {
                        reply += `${idx + 1}. *${item.text}*\n   🕒 ${item.targetTimeString} (ID: ${item.id})\n\n`;
                    });
                    reply += `Beri tahu saya jika ada yang ingin disesuaikan atau dibatalkan ya Pak.`;
                }

                addHistory(ownerChatHistory, 'user', userText);
                addHistory(ownerChatHistory, 'model', reply);
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
                    const reply = `Baik Pak Laksmana, pengingat *"${target.text}"* untuk ${target.targetTimeString} telah berhasil saya batalkan.`;
                    addHistory(ownerChatHistory, 'user', userText);
                    addHistory(ownerChatHistory, 'model', reply);
                    return reply;
                } else {
                    const reply = `Saya tidak menemukan jadwal pengingat tersebut Pak. Silakan katakan *"cek jadwal"* untuk melihat daftar yang aktif.`;
                    addHistory(ownerChatHistory, 'user', userText);
                    addHistory(ownerChatHistory, 'model', reply);
                    return reply;
                }
            }

            // Tool: cari_informasi_web
            if (call.name === 'cari_informasi_web') {
                const { query } = call.args;
                console.log(`🔍 [NoaH Web Search] Mencari info: "${query}"`);
                const rawSearch = await searchWeb(query);

                const searchPrompt = `Bapak Laksmana bertanya: "${userText}".
Berikut informasi terkini dari hasil pencarian web untuk "${query}":
${rawSearch}

Tugas:
Jawab dan jelaskan informasi di atas kepada Pak Laksmana secara ringkas, jelas, akurat, dan sopan seperti asisten pribadi terbaik.`;

                const summaryResult = await modelGeneral.generateContent(searchPrompt);
                const reply = summaryResult.response.text().trim();

                addHistory(ownerChatHistory, 'user', userText);
                addHistory(ownerChatHistory, 'model', reply);
                return reply;
            }

            // Tool: rangkum_grup
            if (call.name === 'rangkum_grup') {
                const { nama_grup } = call.args || {};
                console.log(`📑 [NoaH Group] Merangkum grup: "${nama_grup || 'Semua Grup'}"`);
                const reply = await groupManager.summarize(nama_grup, modelGeneral);
                addHistory(ownerChatHistory, 'user', userText);
                addHistory(ownerChatHistory, 'model', reply);
                return reply;
            }

            // Tool: daftar_grup
            if (call.name === 'daftar_grup') {
                const reply = groupManager.getGroupListFormatted();
                addHistory(ownerChatHistory, 'user', userText);
                addHistory(ownerChatHistory, 'model', reply);
                return reply;
            }

            // Tool: kirim_pesan_wa
            if (call.name === 'kirim_pesan_wa') {
                const { tujuan, pesan } = call.args;
                console.log(`📤 [NoaH Send WA] Mengirim ke "${tujuan}": "${pesan}"`);
                const ownerSock = socketGetter?.getOwnerSock ? socketGetter.getOwnerSock() : null;
                if (!ownerSock) {
                    const reply = 'Maaf Pak Laksmana, sesi WhatsApp Anda (nomor pribadi) sedang tidak terhubung.';
                    addHistory(ownerChatHistory, 'user', userText);
                    addHistory(ownerChatHistory, 'model', reply);
                    return reply;
                }

                try {
                    const target = await groupManager.sendMessageToTarget(tujuan, pesan, ownerSock);
                    const reply = `Siap Pak Laksmana! Pesan telah berhasil saya sampaikan ke ${target.isGroup ? 'grup' : 'kontak'} *${target.name}*:\n\n"${pesan}"`;
                    addHistory(ownerChatHistory, 'user', userText);
                    addHistory(ownerChatHistory, 'model', reply);
                    return reply;
                } catch (err) {
                    console.error('[NoaH Send WA Error]:', err.message);
                    const reply = `Maaf Pak Laksmana, gagal mengirim ke "${tujuan}": ${err.message}`;
                    addHistory(ownerChatHistory, 'user', userText);
                    addHistory(ownerChatHistory, 'model', reply);
                    return reply;
                }
            }
        }

        const reply = response.text().trim();
        addHistory(ownerChatHistory, 'user', userText);
        addHistory(ownerChatHistory, 'model', reply);
        return reply;
    } catch (err) {
        console.error('[NoaH Owner Error]:', err.message);
        return 'Maaf Pak Laksmana, ada sedikit gangguan koneksi AI. Boleh diulangi sekali lagi?';
    }
}

/**
 * 2. Menangani pesan dari orang lain ke nomor pribadi Laksmana (Auto-Reply & Deteksi Urgent)
 */
async function handleGuestMessage(guestText, guestJid, guestName = 'Tamu') {
    if (!modelGeneral) {
        return {
            replyToGuest: `Halo, mohon maaf saat ini Bapak Laksmana sedang belum sempat membuka chat. Saya NoaH, asisten pribadi beliau. Pesan Anda sudah tercatat dan akan segera disampaikan. Terima kasih!`,
            isUrgent: false,
            urgentSummary: null
        };
    }

    const now = new Date();
    const nowJakarta = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    const prompt = `
Kamu adalah NoaH, asisten pribadi cerdas, santun, dan profesional dari Bapak Laksmana.
Seseorang (${guestName}) mengirim pesan ke nomor WhatsApp pribadi Laksmana:
"${guestText}"

Waktu saat ini: ${nowJakarta}.
Laksmana sedang sibuk beraktivitas dan belum sempat membuka chat.

Tugasmu:
1. Buatkan balasan yang sangat sopan, ramah, dan profesional. Sampaikan bahwa kamu adalah NoaH, asisten pribadi Bapak Laksmana. Beritahu bahwa Laksmana sedang berhalangan/belum membuka ponsel, dan tampung pesan mereka dengan baik.
2. Analisis dengan teliti apakah isi pesan ini bersifat URGENT / MENDESAK / PENTING (contoh: urusan transfer/uang mendesak, janji temu saat ini juga, keluarga sakit/darurat, kendala server/sistem kritis, atau hal yang harus segera ditanggapi detik ini juga).

Kembalikan HANYA format JSON valid tanpa backticks markdown:
{
  "replyToGuest": "kalimat balasan santun untuk pengirim",
  "isUrgent": boolean,
  "urgentSummary": "penjelasan singkat alasan darurat jika isUrgent true, atau null jika false"
}
`;

    try {
        const result = await modelGeneral.generateContent(prompt);
        const text = result.response.text().trim();
        const cleanJson = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);
        return parsed;
    } catch (err) {
        console.error('[NoaH Guest AI Error]:', err.message);
        return {
            replyToGuest: `Halo, mohon maaf saat ini Bapak Laksmana sedang belum sempat membuka WhatsApp. Saya NoaH, asisten pribadi beliau. Pesan Anda sudah saya catat dan akan saya teruskan ke beliau. Terima kasih!`,
            isUrgent: false,
            urgentSummary: null
        };
    }
}

function getModelGeneral() {
    return modelGeneral;
}

module.exports = {
    handleOwnerMessage,
    handleGuestMessage,
    getModelGeneral,
    setSockets
};
