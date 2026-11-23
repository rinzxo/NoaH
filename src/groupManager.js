const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../data');
const groupFile = path.join(dataDir, 'group_data.json');

let groupData = { groups: {} };

function loadGroupData() {
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        if (fs.existsSync(groupFile)) {
            groupData = JSON.parse(fs.readFileSync(groupFile, 'utf8'));
            if (!groupData.groups) groupData.groups = {};
        }
    } catch (e) {
        groupData = { groups: {} };
    }
}

let saveTimer = null;
function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            fs.writeFileSync(groupFile, JSON.stringify(groupData, null, 2), 'utf8');
        } catch (e) {
            console.error('[GroupManager] Gagal simpan group_data:', e.message);
        }
    }, 8000);
}

loadGroupData();

const groupNameCache = new Map();

async function resolveGroupName(groupJid, sock) {
    if (groupNameCache.has(groupJid)) {
        return groupNameCache.get(groupJid);
    }
    if (groupData.groups[groupJid]?.name && groupData.groups[groupJid].name !== 'Grup WhatsApp') {
        groupNameCache.set(groupJid, groupData.groups[groupJid].name);
        return groupData.groups[groupJid].name;
    }
    if (sock && typeof sock.groupMetadata === 'function') {
        try {
            const meta = await sock.groupMetadata(groupJid);
            if (meta && meta.subject) {
                groupNameCache.set(groupJid, meta.subject);
                return meta.subject;
            }
        } catch (e) {}
    }
    return 'Grup WhatsApp';
}

async function recordMessage(groupJid, senderPhone, pushName, text, sock) {
    if (!text || !text.trim() || !groupJid) return;

    if (!groupData.groups[groupJid]) {
        groupData.groups[groupJid] = {
            name: 'Grup WhatsApp',
            lastUpdated: Date.now(),
            messages: []
        };
    }

    const grp = groupData.groups[groupJid];
    grp.lastUpdated = Date.now();

    if (!grp.name || grp.name === 'Grup WhatsApp') {
        grp.name = await resolveGroupName(groupJid, sock);
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta'
    });

    if (!grp.messages) grp.messages = [];

    grp.messages.push({
        sender: pushName || senderPhone || 'Member',
        phone: senderPhone || '',
        text: text.trim(),
        time: timeStr,
        timestamp: Date.now()
    });

    // Batasi maksimum 150 pesan terakhir per grup untuk efisiensi penyimpanan
    if (grp.messages.length > 150) {
        grp.messages = grp.messages.slice(-150);
    }

    scheduleSave();
}

function getGroupListFormatted() {
    const list = Object.entries(groupData.groups).map(([jid, grp]) => ({
        jid,
        name: grp.name || 'Grup WhatsApp',
        count: (grp.messages || []).length,
        lastUpdated: grp.lastUpdated || 0
    }));

    if (list.length === 0) {
        return 'Saat ini belum ada data obrolan grup yang terekam oleh NoaH, Pak Laksmana.';
    }

    list.sort((a, b) => b.lastUpdated - a.lastUpdated);

    let reply = `👥 *Daftar Grup yang Dipantau NoaH (${list.length}):*\n\n`;
    list.forEach((item, idx) => {
        reply += `${idx + 1}. *${item.name}*\n   💬 ${item.count} pesan tersimpan\n\n`;
    });
    reply += `_Untuk merangkum, Anda bisa ketik *"rangkum grup [nama]"* (contoh: "rangkum grup OSIS") atau tanyakan langsung ke NoaH._`;
    return reply;
}

async function summarize(targetQuery, geminiModel) {
    const allGroups = Object.entries(groupData.groups);
    if (allGroups.length === 0) {
        return 'Belum ada pesan grup yang terekam oleh NoaH, Pak Laksmana. Begitu ada percakapan masuk di grup yang Anda ikuti, saya akan otomatis mencatatnya secara hening tanpa mengganggu alur grup.';
    }

    let selectedGroups = [];

    if (targetQuery && targetQuery.trim() && targetQuery.toLowerCase() !== 'semua') {
        const query = targetQuery.toLowerCase().trim();
        selectedGroups = allGroups.filter(([jid, grp]) => {
            const name = (grp.name || '').toLowerCase();
            return name.includes(query);
        });
    } else {
        // Ambil grup yang memiliki pesan dalam 24 jam terakhir (maksimal 5 grup teraktif)
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        selectedGroups = allGroups
            .filter(([jid, grp]) => grp.lastUpdated >= dayAgo && grp.messages && grp.messages.length > 0)
            .sort((a, b) => (b[1].messages?.length || 0) - (a[1].messages?.length || 0))
            .slice(0, 5);
    }

    if (selectedGroups.length === 0) {
        return `Saya tidak menemukan data pesan baru untuk grup *"${targetQuery}"*. Silakan cek *"daftar grup"* untuk melihat nama grup yang aktif dipantau.`;
    }

    let transcript = '';
    for (const [jid, grp] of selectedGroups) {
        const recentMsgs = (grp.messages || []).slice(-45);
        if (recentMsgs.length === 0) continue;

        transcript += `\n=== NAMA GRUP: ${grp.name} ===\n`;
        for (const m of recentMsgs) {
            transcript += `[${m.time}] ${m.sender}: ${m.text}\n`;
        }
    }

    if (!transcript.trim()) {
        return 'Pesan di grup yang Anda minta masih kosong atau belum ada obrolan hari ini, Pak.';
    }

    if (!geminiModel) {
        return 'Maaf Pak Laksmana, modul AI belum siap untuk memproses rangkuman.';
    }

    const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const prompt = `
Kamu adalah NoaH, asisten pribadi setia, cerdas, dan tanggap dari Bapak Laksmana Ibrahim Rino.
Berikut adalah transkrip obrolan WhatsApp dari grup yang diikuti oleh Bapak Laksmana:
${transcript}

Waktu saat ini: ${now}.

Tugasmu sebagai asisten pribadi:
Buatkan rangkuman eksekutif yang sangat rapi, informatif, dan mudah dipahami oleh Pak Laksmana.
Untuk setiap grup yang ada di transkrip, buatkan poin:
📌 *[Nama Grup]*
• *Topik Utama:* (Jelaskan dalam 1-2 kalimat apa yang sedang dibahas/ramai)
• *Poin Penting & Keputusan:* (Daftar keputusan, pengumuman, atau jadwal yang dibicarakan)
• *Tindakan untuk Pak Laksmana:* (Sebutkan jika ada yang me-mention/membutuhkan Laksmana, atau tugas untuk beliau. Jika tidak ada, tulis "Tidak ada hal mendesak untuk Bapak")

Gunakan gaya bahasa santun, profesional, dan padat. Hindari penjelasan bertele-tele.
`;

    try {
        const result = await geminiModel.generateContent(prompt);
        const summary = result.response.text().trim();
        return `📑 *RANGKUMAN OBROLAN GRUP WHATSAPP*\n\n${summary}`;
    } catch (err) {
        console.error('[Group Summarize Error]:', err.message);
        return 'Maaf Pak Laksmana, terjadi kendala saat memproses rangkuman grup dengan AI. Mohon dicoba beberapa saat lagi.';
    }
}

async function findGroup(query, sock) {
    if (!query) return null;
    const q = query.toLowerCase().trim();

    // 1. Cek dari database yang sudah tersimpan
    const stored = Object.entries(groupData.groups);
    for (const [jid, grp] of stored) {
        const name = (grp.name || '').toLowerCase();
        if (name === q || name.includes(q) || q.includes(name)) {
            return { jid, name: grp.name };
        }
    }

    // Keyword matching untuk nama panjang (contoh: "RG3C", "SMANDU", "Komisi C", "KitaAtur")
    const words = q.split(/[\s+(),-]+/).filter(w => w.length >= 3);
    let bestMatch = null;
    let highestScore = 0;

    for (const [jid, grp] of stored) {
        const name = (grp.name || '').toLowerCase();
        let score = 0;
        for (const w of words) {
            if (name.includes(w)) score++;
        }
        if (score > highestScore) {
            highestScore = score;
            bestMatch = { jid, name: grp.name };
        }
    }
    if (bestMatch && highestScore > 0) {
        return bestMatch;
    }

    // 2. Jika tidak ada di lokal, cari langsung dari grup aktif di WhatsApp socket
    if (sock && typeof sock.groupFetchAllParticipating === 'function') {
        try {
            const all = await sock.groupFetchAllParticipating();
            for (const [jid, meta] of Object.entries(all)) {
                const name = (meta.subject || '').toLowerCase();
                if (name === q || name.includes(q) || q.includes(name)) {
                    if (!groupData.groups[jid]) {
                        groupData.groups[jid] = { name: meta.subject, lastUpdated: Date.now(), messages: [] };
                    } else {
                        groupData.groups[jid].name = meta.subject;
                    }
                    scheduleSave();
                    return { jid, name: meta.subject };
                }
            }

            for (const [jid, meta] of Object.entries(all)) {
                const name = (meta.subject || '').toLowerCase();
                let score = 0;
                for (const w of words) {
                    if (name.includes(w)) score++;
                }
                if (score > highestScore) {
                    highestScore = score;
                    bestMatch = { jid, name: meta.subject };
                }
            }
            if (bestMatch && highestScore > 0) {
                if (!groupData.groups[bestMatch.jid]) {
                    groupData.groups[bestMatch.jid] = { name: bestMatch.name, lastUpdated: Date.now(), messages: [] };
                }
                scheduleSave();
                return bestMatch;
            }
        } catch (e) {
            console.error('[GroupManager] Gagal fetch all participating groups:', e.message);
        }
    }

    return null;
}

async function resolveDestination(tujuan, sock) {
    if (!tujuan) return null;
    const cleanDigits = tujuan.replace(/\D/g, '');
    if (cleanDigits.length >= 9 && cleanDigits.length <= 15) {
        let phone = cleanDigits;
        if (phone.startsWith('0')) {
            phone = '62' + phone.slice(1);
        }
        return {
            jid: `${phone}@s.whatsapp.net`,
            name: `+${phone}`,
            isGroup: false
        };
    }

    const grp = await findGroup(tujuan, sock);
    if (grp) {
        return {
            jid: grp.jid,
            name: grp.name,
            isGroup: true
        };
    }

    // Cek apakah tujuan cocok dengan nama kontak/member yang pernah mengirim pesan
    const q = tujuan.toLowerCase().trim();
    for (const [gJid, gData] of Object.entries(groupData.groups)) {
        if (gData.messages) {
            for (const m of gData.messages) {
                const sName = (m.sender || '').toLowerCase();
                if (m.phone && (sName === q || sName.includes(q) || q.includes(sName))) {
                    let phone = m.phone.replace(/\D/g, '');
                    if (phone.startsWith('0')) phone = '62' + phone.slice(1);
                    return {
                        jid: `${phone}@s.whatsapp.net`,
                        name: m.sender || `+${phone}`,
                        isGroup: false
                    };
                }
            }
        }
    }

    return null;
}

async function sendMessageToTarget(tujuan, pesan, sock) {
    if (!sock) throw new Error('Koneksi WhatsApp belum terhubung.');
    const target = await resolveDestination(tujuan, sock);
    if (!target) {
        throw new Error(`Tujuan "${tujuan}" tidak ditemukan. Pastikan nama grup atau nomor WhatsApp sesuai.`);
    }

    // Gestur mengetik sebentar sebelum mengirim pesan ke grup/kontak
    try {
        await sock.sendPresenceUpdate('composing', target.jid);
        await new Promise(r => setTimeout(r, 1200));
    } catch (e) {}

    await sock.sendMessage(target.jid, { text: pesan });
    recordMessage(target.jid, config.ownerNumber, 'Laksmana', pesan, sock);

    try {
        await sock.sendPresenceUpdate('paused', target.jid);
    } catch (e) {}

    return target;
}

function getRecentMessages(groupJid, limit = 20) {
    if (!groupData.groups[groupJid] || !groupData.groups[groupJid].messages) return [];
    return groupData.groups[groupJid].messages.slice(-limit);
}

module.exports = {
    recordMessage,
    getRecentMessages,
    getGroupListFormatted,
    summarize,
    resolveGroupName,
    findGroup,
    resolveDestination,
    sendMessageToTarget
};
