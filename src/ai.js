const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');
const reminder = require('./reminder');
const { searchWeb } = require('./search');
const groupManager = require('./groupManager');
const autonomyManager = require('./autonomyManager');

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
                    description: 'Isi pengingat atau tugas (contoh: "Minum obat", "Meeting klien", "Ngerjain PR").'
                },
                jam_spesifik: {
                    type: 'STRING',
                    description: 'Waktu berbunyi spesifik dalam format 24 jam Waktu Indonesia Barat (WIB), contoh: "20:00" untuk jam 8 malam, "08:00" untuk jam 8 pagi, "14:30" untuk jam setengah 3 siang. UTAMAKAN parameter ini jika user menyebutkan jam tertentu!'
                },
                menit_dari_sekarang: {
                    type: 'NUMBER',
                    description: 'HANYA gunakan jika user meminta durasi relatif dari sekarang, contoh: "10 menit lagi" (isi 10) atau "1 jam lagi" (isi 60). JANGAN gunakan jika user menyebutkan jam spesifik!'
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
    },
    {
        name: 'atur_otonomi_chat',
        description: 'Memberikan mandat otonomi atau mencabut mandat otonomi agar NoaH aktif dan otomatis mewakili Pak Laksmana di grup atau obrolan tertentu untuk membahas konteks spesifik secara langsung.',
        parameters: {
            type: 'OBJECT',
            properties: {
                tujuan: {
                    type: 'STRING',
                    description: 'Nama grup atau nama kontak yang ingin diberikan/dicabut otonomi (contoh: "RG3C+ Komisi C SMANDU", "OSIS", "M. Nazriel").'
                },
                aktif: {
                    type: 'BOOLEAN',
                    description: 'True jika ingin mengaktifkan mandat otonomi, False jika ingin mematikan/mencabut otonomi.'
                },
                instruksi: {
                    type: 'STRING',
                    description: 'Konteks atau mandat spesifik yang harus dibahas dan diwakili oleh NoaH atas nama Pak Laksmana (contoh: "Bahas pengerjaan video tutorial KitaAtur malam ini, konfirmasi kesiapan materi, dan bantu jawab pertanyaan seputar KitaAtur").'
                }
            },
            required: ['tujuan', 'aktif']
        }
    },
    {
        name: 'lihat_daftar_otonomi',
        description: 'Melihat seluruh daftar obrolan atau grup yang saat ini memiliki status otonomi aktif beserta instruksi khususnya.',
        parameters: {
            type: 'OBJECT',
            properties: {}
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
async function handleOwnerMessage(userText, senderJid, media = null) {
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

ATURAN KOMUNIKASI (SANGAT PENTING):
1. BERBICARA SEPERLUNYA & NATURAL:
   - Gunakan bahasa yang natural, santai tapi tetap sopan & hormat kepada Pak Laksmana.
   - Jangan mengeluarkan teks panjang jika sekadar bertanya, mengonfirmasi, atau mengajukan sesuatu. Cukup 1 sampai 2 kalimat pendek yang lugas dan to-the-point.
   - HINDARI basa-basi panjang, salam berulang, atau gaya bicara kaku seperti robot/surat dinas (CONTOH DILARANG: "Selamat pagi/siang Bapak Laksmana", "Mohon maaf atas ketidaknyamanan...", "Apakah ada hal lain yang bisa saya bantu, Pak?").
   - Langsung ke inti jawaban atau tanyakan hal yang diperlukan secara wajar.
2. JELAS, PADAT & SOLUTIF:
   - Sampaikan informasi pentingnya saja. Jika beliau butuh penjelasan lebih detail, beliau akan bertanya lagi.

Kamu MEMILIKI KEMAMPUAN LENGKAP untuk:
1. Melihat, membaca, dan menganalisis gambar/foto/screenshot/dokumen (OCR) secara langsung dan visual. Jika Pak Laksmana mengirimkan foto jadwal pelajaran, agenda, catatan tugas, formulir, atau dokumen apa pun, baca seluruh teks dan detailnya dengan teliti, rangkumkan untuk beliau, dan buatkan jadwal pengingat jika diminta.
2. Mengirim pesan secara langsung dan real-time ke grup WhatsApp mana pun yang diikuti Pak Laksmana atau ke kontak siapa pun atas perintah beliau menggunakan tool \`kirim_pesan_wa\`.
3. Merangkum obrolan grup WhatsApp (\`rangkum_grup\` atau \`daftar_grup\`).
4. Membuat jadwal/agenda (\`buat_pengingat\`, \`lihat_daftar_pengingat\`, \`batalkan_pengingat\`).
5. Mencari informasi web (\`cari_informasi_web\`).
6. Mengatur mode otonomi khusus (\`atur_otonomi_chat\`, \`lihat_daftar_otonomi\`) ketika Pak Laksmana ingin kamu otomatis mewakili beliau dan berdiskusi di grup atau obrolan tertentu untuk membahas konteks spesifik secara langsung.]`;

    const userParts = [];
    if (media && media.buffer) {
        userParts.push({
            inlineData: {
                data: media.buffer.toString('base64'),
                mimeType: media.mimeType || 'image/jpeg'
            }
        });
    }
    userParts.push({ text: `${systemContext}\nLaksmana: ${userText}` });

    const contents = [
        ...ownerChatHistory,
        { role: 'user', parts: userParts }
    ];

    const historyUserText = media ? `[Mengirim Foto] ${userText}` : userText;

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

                // Prioritaskan jam_spesifik terlebih dahulu jika user menyebutkan jam!
                if (jam_spesifik) {
                    targetDate = reminder.parseRelativeTime(jam_spesifik);
                } else if (menit_dari_sekarang) {
                    targetDate = new Date(Date.now() + Math.round(menit_dari_sekarang * 60 * 1000));
                } else {
                    targetDate = new Date(Date.now() + 10 * 60 * 1000);
                }

                if (!targetDate) {
                    targetDate = new Date(Date.now() + 10 * 60 * 1000);
                }

                const item = reminder.addReminder(pesan, targetDate, senderJid, {
                    voiceNote: true,
                    call: Boolean(dengan_telepon)
                });

                const reply = `Siap Pak, pengingat *"${item.text}"* sudah dijadwalkan untuk ${item.targetTimeString}. Nanti saya ingatkan ya.`;

                addHistory(ownerChatHistory, 'user', historyUserText);
                addHistory(ownerChatHistory, 'model', reply);
                return reply;
            }

            // Tool: lihat_daftar_pengingat
            if (call.name === 'lihat_daftar_pengingat') {
                const list = reminder.listReminders(senderJid);
                let reply = '';
                if (list.length === 0) {
                    reply = 'Belum ada jadwal pengingat yang aktif nih Pak.';
                } else {
                    reply = `📋 *Daftar Pengingat Aktif:*\n\n` +
                        list.map((item, idx) => `${idx + 1}. *${item.text}* — ${item.targetTimeString}`).join('\n');
                }

                addHistory(ownerChatHistory, 'user', historyUserText);
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
                    const reply = `Pengingat *"${target.text}"* untuk ${target.targetTimeString} sudah dibatalkan ya Pak.`;
                    addHistory(ownerChatHistory, 'user', historyUserText);
                    addHistory(ownerChatHistory, 'model', reply);
                    return reply;
                } else {
                    const reply = `Pengingatnya tidak ditemukan Pak. Coba ketik *"cek jadwal"* untuk lihat daftarnya.`;
                    addHistory(ownerChatHistory, 'user', historyUserText);
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
Hasil pencarian web untuk "${query}":
${rawSearch}

TUGAS KOMUNIKASI (WAJIB):
Jawab intinya saja secara natural, ringkas, dan to the point layaknya chat WhatsApp biasa (1-3 kalimat jika cukup). Bicaralah seperlunya.
JANGAN membuat salam pembuka/penutup panjang, jangan bertele-tele, dan jangan gunakan gaya bahasa robot formal. Jika tidak ketemu infonya, katakan apa adanya secara santai.`;

                const summaryResult = await modelGeneral.generateContent(searchPrompt);
                const reply = summaryResult.response.text().trim();

                addHistory(ownerChatHistory, 'user', historyUserText);
                addHistory(ownerChatHistory, 'model', reply);
                return reply;
            }

            // Tool: rangkum_grup
            if (call.name === 'rangkum_grup') {
                const { nama_grup } = call.args || {};
                console.log(`📑 [NoaH Group] Merangkum grup: "${nama_grup || 'Semua Grup'}"`);
                const reply = await groupManager.summarize(nama_grup, modelGeneral);
                addHistory(ownerChatHistory, 'user', historyUserText);
                addHistory(ownerChatHistory, 'model', reply);
                return reply;
            }

            // Tool: daftar_grup
            if (call.name === 'daftar_grup') {
                const reply = groupManager.getGroupListFormatted();
                addHistory(ownerChatHistory, 'user', historyUserText);
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
                    addHistory(ownerChatHistory, 'user', historyUserText);
                    addHistory(ownerChatHistory, 'model', reply);
                    return reply;
                }

                try {
                    const target = await groupManager.sendMessageToTarget(tujuan, pesan, ownerSock);
                    const reply = `Pesan sudah terkirim ke ${target.isGroup ? 'grup' : 'kontak'} *${target.name}* ya Pak.`;
                    addHistory(ownerChatHistory, 'user', historyUserText);
                    addHistory(ownerChatHistory, 'model', reply);
                    return reply;
                } catch (err) {
                    console.error('[NoaH Send WA Error]:', err.message);
                    const reply = `Gagal kirim ke "${tujuan}": ${err.message}`;
                    addHistory(ownerChatHistory, 'user', historyUserText);
                    addHistory(ownerChatHistory, 'model', reply);
                    return reply;
                }
            }

            // Tool: atur_otonomi_chat
            if (call.name === 'atur_otonomi_chat') {
                const { tujuan, aktif, instruksi } = call.args;
                const ownerSock = socketGetter?.getOwnerSock ? socketGetter.getOwnerSock() : null;

                if (aktif) {
                    try {
                        const entry = await autonomyManager.setAutonomy(tujuan, instruksi, ownerSock);
                        const reply = `Siap Pak, otonomi di *${entry.name}* sudah aktif untuk: "${entry.instruction}". Nanti kalau ada bahasan yang relevan langsung saya tanggapi dan kabari Bapak.`;
                        addHistory(ownerChatHistory, 'user', historyUserText);
                        addHistory(ownerChatHistory, 'model', reply);
                        return reply;
                    } catch (err) {
                        const reply = `Gagal mengaktifkan otonomi untuk "${tujuan}": ${err.message}`;
                        addHistory(ownerChatHistory, 'user', historyUserText);
                        addHistory(ownerChatHistory, 'model', reply);
                        return reply;
                    }
                } else {
                    try {
                        const removed = await autonomyManager.disableAutonomy(tujuan, ownerSock);
                        if (removed) {
                            const reply = `Otonomi di *${removed.name}* sudah dinonaktifkan ya Pak.`;
                            addHistory(ownerChatHistory, 'user', historyUserText);
                            addHistory(ownerChatHistory, 'model', reply);
                            return reply;
                        } else {
                            const reply = `Status otonomi untuk "${tujuan}" tidak ditemukan Pak.`;
                            addHistory(ownerChatHistory, 'user', historyUserText);
                            addHistory(ownerChatHistory, 'model', reply);
                            return reply;
                        }
                    } catch (err) {
                        const reply = `Gagal menonaktifkan otonomi: ${err.message}`;
                        addHistory(ownerChatHistory, 'user', historyUserText);
                        addHistory(ownerChatHistory, 'model', reply);
                        return reply;
                    }
                }
            }

            // Tool: lihat_daftar_otonomi
            if (call.name === 'lihat_daftar_otonomi') {
                const reply = autonomyManager.formatAutonomyList();
                addHistory(ownerChatHistory, 'user', historyUserText);
                addHistory(ownerChatHistory, 'model', reply);
                return reply;
            }
        }

        const reply = response.text().trim();
        addHistory(ownerChatHistory, 'user', historyUserText);
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
1. Buatkan balasan yang natural, ramah, dan ringkas seperlunya (1-2 kalimat pendek). Sampaikan bahwa kamu NoaH (asisten Pak Laksmana) dan pesannya sudah dicatat karena Pak Laksmana sedang beraktivitas. JANGAN panjang atau bertele-tele.
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
