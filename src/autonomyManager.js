const fs = require('fs');
const path = require('path');
const config = require('./config');
const groupManager = require('./groupManager');

const dataDir = path.join(__dirname, '../data');
const autonomyFile = path.join(dataDir, 'autonomy.json');

let autonomyState = {
    chats: {} // jid -> { jid, name, isGroup, enabled, instruction, createdAt, lastReplied }
};

function loadAutonomy() {
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        if (fs.existsSync(autonomyFile)) {
            const raw = fs.readFileSync(autonomyFile, 'utf8');
            autonomyState = JSON.parse(raw);
            if (!autonomyState.chats) autonomyState.chats = {};
        }
    } catch (e) {
        console.error('[Autonomy] Gagal membaca autonomy.json:', e.message);
        autonomyState = { chats: {} };
    }
}

function saveAutonomy() {
    try {
        fs.writeFileSync(autonomyFile, JSON.stringify(autonomyState, null, 2), 'utf8');
    } catch (e) {
        console.error('[Autonomy] Gagal menyimpan autonomy.json:', e.message);
    }
}

loadAutonomy();

function getAutonomy(jid) {
    if (!jid) return null;
    const normalized = jid.split('@')[0].split(':')[0];
    const isGrp = jid.includes('@g.us');
    const standardJid = `${normalized}@${isGrp ? 'g.us' : 's.whatsapp.net'}`;

    let entry = autonomyState.chats[standardJid] || autonomyState.chats[jid];
    if (entry && entry.enabled) return entry;

    const cleanDigits = jid.replace(/\D/g, '');
    if (cleanDigits.length >= 9) {
        for (const item of Object.values(autonomyState.chats)) {
            if (item.enabled && item.jid.replace(/\D/g, '') === cleanDigits) {
                return item;
            }
        }
    }

    return null;
}

function hasAutonomy(jid) {
    return Boolean(getAutonomy(jid));
}

function getAutonomyList() {
    return Object.values(autonomyState.chats).filter(c => c.enabled);
}

function getAllAutonomy() {
    return Object.values(autonomyState.chats);
}

/**
 * Mengaktifkan atau memperbarui mandat otonomi untuk grup atau kontak tertentu
 */
async function setAutonomy(targetQuery, instruction, sock) {
    if (!targetQuery || !targetQuery.trim()) {
        throw new Error('Target grup atau kontak tidak boleh kosong.');
    }
    const cleanInstruction = (instruction || '').trim();
    if (!cleanInstruction) {
        throw new Error('Instruksi/mandat otonomi harus diisi agar NoaH paham konteks yang harus dibahas.');
    }

    const target = await groupManager.resolveDestination(targetQuery, sock);
    if (!target) {
        throw new Error(`Target "${targetQuery}" tidak ditemukan. Pastikan nama grup atau nomor WhatsApp valid.`);
    }

    const entry = {
        jid: target.jid,
        name: target.name,
        isGroup: Boolean(target.isGroup),
        enabled: true,
        instruction: cleanInstruction,
        createdAt: Date.now(),
        lastReplied: 0
    };

    autonomyState.chats[target.jid] = entry;
    saveAutonomy();
    return entry;
}

/**
 * Menonaktifkan atau mencabut otonomi dari grup atau kontak tertentu
 */
async function disableAutonomy(targetQuery, sock) {
    if (!targetQuery || !targetQuery.trim()) {
        throw new Error('Target grup atau kontak tidak boleh kosong.');
    }

    const q = targetQuery.toLowerCase().trim();
    // Cari berdasarkan JID langsung atau nama di autonomyState
    for (const [jid, item] of Object.entries(autonomyState.chats)) {
        if (jid === q || (item.name && item.name.toLowerCase().includes(q)) || q.includes((item.name || '').toLowerCase())) {
            item.enabled = false;
            saveAutonomy();
            return item;
        }
    }

    // Jika belum ketemu, coba resolveDestination
    const target = await groupManager.resolveDestination(targetQuery, sock);
    if (target && autonomyState.chats[target.jid]) {
        autonomyState.chats[target.jid].enabled = false;
        saveAutonomy();
        return autonomyState.chats[target.jid];
    }

    return null;
}

function formatAutonomyList() {
    const list = getAutonomyList();
    if (list.length === 0) {
        return 'Saat ini *belum ada obrolan atau grup* yang diberikan mandat otonomi, Pak Laksmana.\n\nUntuk mengaktifkan, ketik:\n`otonomi [nama grup] : [instruksi]`\n_Contoh:_ `otonomi RG3C : wakili saya bahas video tutorial KitaAtur malam ini`';
    }

    let reply = `🤖 *Daftar Obrolan Berstatus Otonomi Aktif (${list.length}):*\n\n`;
    list.forEach((item, idx) => {
        const typeStr = item.isGroup ? 'Grup' : 'Kontak Pribadi';
        reply += `${idx + 1}. *${item.name}* (${typeStr})\n`;
        reply += `   📌 *Mandat:* "${item.instruction}"\n`;
        reply += `   🕒 Diaktifkan: ${new Date(item.createdAt).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n`;
    });

    reply += `_Untuk mematikan: ketik "matikan otonomi [nama grup]"_\n_Untuk mengubah mandat: ketik "otonomi [nama grup] : [instruksi baru]"_`;
    return reply;
}

// Memory buffer dan timer debounce
const chatBuffers = new Map(); // jid -> { messages: [], timer: Timeout, lastIncomingTime: number }
const lastReplyTime = new Map(); // jid -> timestamp
const lastOwnerActiveTime = new Map(); // jid -> timestamp

/**
 * Evaluasi pesan masuk menggunakan Gemini dan kirimkan respons otonom jika relevan
 */
async function processAutonomousBuffer(jid, entry, sock, botSock, geminiModel, replyWithTyping) {
    const buf = chatBuffers.get(jid);
    chatBuffers.delete(jid);
    if (!buf || buf.messages.length === 0) return;

    if (!entry.enabled) return;

    // Cek apakah Laksmana baru saja aktif di chat ini dalam 45 detik terakhir
    const ownerTime = lastOwnerActiveTime.get(jid) || 0;
    if (Date.now() - ownerTime < 45 * 1000) {
        console.log(`[Autonomy] Dilewati: Pak Laksmana aktif sendiri di chat ${entry.name}.`);
        return;
    }

    // Cek cooldown (minimal 25 detik antar balasan otomatis di obrolan yang sama)
    const lastReply = lastReplyTime.get(jid) || 0;
    if (Date.now() - lastReply < 25 * 1000) {
        console.log(`[Autonomy] Cooldown aktif untuk ${entry.name}, dilewati sementara.`);
        return;
    }

    if (!geminiModel) {
        console.warn('[Autonomy] Model AI tidak tersedia untuk evaluasi otonom.');
        return;
    }

    // Ambil histori pesan terkini dari groupManager atau buffer
    const recentMsgs = groupManager.getRecentMessages ? groupManager.getRecentMessages(jid, 15) : [];
    let transcript = '';
    if (recentMsgs.length > 0) {
        transcript = recentMsgs.map(m => `[${m.time}] ${m.sender}: ${m.text}`).join('\n');
    } else {
        transcript = buf.messages.map(m => `${m.sender}: ${m.text}`).join('\n');
    }

    const incomingText = buf.messages.map(m => `${m.sender}: "${m.text}"`).join('\n');
    const nowJakarta = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    const prompt = `
Kamu adalah NoaH, asisten pribadi cerdas, santun, dan solutif dari Bapak Laksmana Ibrahim Rino (Founder & CEO Rinz Group Inovasi: KitaPay, KitaAtur, DesainKita).
Bapak Laksmana telah MEMBERIKAN OTONOMI PENUH kepadamu untuk mewakili beliau di dalam obrolan: "${entry.name}".

MANDAT & INSTRUKSI DARI PAK LAKSMANA:
"${entry.instruction}"

Waktu saat ini: ${nowJakarta}.

RIWAYAT PERCAKAPAN TERKINI:
${transcript}

PESAN MASUK TERBARU:
${incomingText}

TUGAS EVALUASI & AKSI:
1. Analisis apakah pesan masuk di atas PERLU DITANGGAPI olehmu mewakili Pak Laksmana?
   - shouldReply = TRUE jika:
     * Ada yang memanggil/me-mention Pak Laksmana atau NoaH.
     * Ada yang bertanya sesuatu yang relevan dengan mandat ("${entry.instruction}").
     * Percakapan membahas topik pekerjaan/proyek terkait yang memerlukan konfirmasi, kabar, atau arahan mewakili Pak Laksmana.
   - shouldReply = FALSE jika:
     * Pesan adalah candaan ringan/obrolan santai antar anggota lain yang tidak menyangkut Pak Laksmana maupun topik mandat.
     * Pesan hanya stiker, tawa singkat, atau salam yang sudah terjawab.
     * Tidak ada konteks yang relevan atau tidak etis jika asisten ikut campur.

2. Jika shouldReply = TRUE, buatkan pesan balasan:
   - GAYA BAHASA: Sangat natural, santai namun tetap sopan, mengalir luwes seperti manusia mengobrol di WhatsApp.
   - BERBICARA SEPERLUNYA: Jangan bertele-tele atau mengeluarkan teks panjang jika sekadar bertanya atau mengonfirmasi (cukup 1-2 kalimat pendek yang lugas).
   - Posisikan dirimu mewakili Bapak Laksmana secara elegan (misal: "Halo rekan-rekan, mewakili Pak Laksmana...").
   - Jawab sesuai konteks mandat dengan bijak. JANGAN membuat komitmen finansial atau janji palsu yang tidak ada di mandat.

Kembalikan HANYA format JSON valid tanpa backticks markdown:
{
  "shouldReply": boolean,
  "replyText": "kalimat balasan jika shouldReply true, atau null jika false",
  "reason": "alasan singkat evaluasi"
}
`;

    try {
        console.log(`[Autonomy] Mengevaluasi pesan masuk di ${entry.name}...`);
        const result = await geminiModel.generateContent(prompt);
        const text = result.response.text().trim();
        const cleanJson = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);

        console.log(`[Autonomy Evaluasi] Result untuk ${entry.name}:`, parsed);

        if (parsed.shouldReply && parsed.replyText) {
            const replyMsg = parsed.replyText.trim();
            // Kirim pesan dengan gestur mengetik
            if (replyWithTyping && sock) {
                await replyWithTyping(sock, jid, replyMsg);
            } else if (sock) {
                await sock.sendMessage(jid, { text: replyMsg });
            }

            lastReplyTime.set(jid, Date.now());
            entry.lastReplied = Date.now();
            saveAutonomy();

            // Catat pesan balasan NoaH ke rekaman percakapan grup
            groupManager.recordMessage(jid, config.ownerNumber, 'NoaH (Mewakili Laksmana)', replyMsg, sock);

            console.log(`✅ [Autonomy] Berhasil mengirim tanggapan otonom ke ${entry.name}`);

            // Laporkan aksi otonom ke nomor pribadi Pak Laksmana via Bot Socket!
            if (botSock) {
                const ownerTargetJid = `${config.ownerNumber}@s.whatsapp.net`;
                const reportText = `🤖 *LAPORAN AKSI OTONOM NoaH*\n\n` +
                    `Pak Laksmana, saya baru saja mewakili Anda membalas obrolan di *${entry.name}*:\n\n` +
                    `💬 *Konteks Pesan:*\n${incomingText}\n\n` +
                    `📝 *Balasan NoaH:*\n"${replyMsg}"\n\n` +
                    `📌 *Mandat:* "${entry.instruction}"\n` +
                    `_Laporan ini dikirim otomatis agar Anda selalu terupdate._`;

                await botSock.sendMessage(ownerTargetJid, { text: reportText });
            }
        }
    } catch (err) {
        console.error('[Autonomy Process Error]:', err.message);
    }
}

/**
 * Dipanggil setiap ada pesan masuk di grup atau obrolan pribadi
 */
function onMessageReceived({ jid, isGroup, fromMe, senderPhone, pushName, body, sock, botSock, geminiModel, replyWithTyping }) {
    if (!jid || !body) return;

    // Jika pesan dikirim oleh Laksmana sendiri (fromMe)
    if (fromMe) {
        lastOwnerActiveTime.set(jid, Date.now());
        // Batalkan timer antrean jika Laksmana mengetik sendiri
        if (chatBuffers.has(jid)) {
            clearTimeout(chatBuffers.get(jid).timer);
            chatBuffers.delete(jid);
            console.log(`[Autonomy] Debounce dibatalkan karena Pak Laksmana mengirim pesan sendiri di ${jid}`);
        }
        return;
    }

    const entry = getAutonomy(jid);
    if (!entry) return; // Obrolan ini tidak memiliki otonomi aktif

    // Abaikan jika pesan berasal dari bot itu sendiri
    if (senderPhone === config.botNumber) return;

    console.log(`[Autonomy] Menerima pesan di obrolan berotonomi: ${entry.name} (${pushName}: "${body}")`);

    // Inisialisasi atau tambahkan ke buffer debounce
    if (!chatBuffers.has(jid)) {
        const buf = {
            messages: [{ sender: pushName || senderPhone || 'Member', text: body }],
            lastIncomingTime: Date.now(),
            timer: setTimeout(async () => {
                await processAutonomousBuffer(jid, entry, sock, botSock, geminiModel, replyWithTyping);
            }, 6500) // Debounce 6.5 detik untuk menunggu jika ada kalimat lanjutan
        };
        chatBuffers.set(jid, buf);
    } else {
        const buf = chatBuffers.get(jid);
        buf.messages.push({ sender: pushName || senderPhone || 'Member', text: body });
        buf.lastIncomingTime = Date.now();
        // Reset debounce timer
        clearTimeout(buf.timer);
        buf.timer = setTimeout(async () => {
            await processAutonomousBuffer(jid, entry, sock, botSock, geminiModel, replyWithTyping);
        }, 5000);
    }
}

module.exports = {
    getAutonomy,
    hasAutonomy,
    getAutonomyList,
    getAllAutonomy,
    setAutonomy,
    disableAutonomy,
    formatAutonomyList,
    onMessageReceived
};
