const dns = require('dns');
try {
    dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestWaWebVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const reminder = require('./reminder');
const { generateVoiceNoteBuffer, triggerPhoneCall } = require('./call');
const ai = require('./ai');

const logger = pino({ level: 'silent' });

let botSock = null;
let ownerSock = null;

// Cooldown balas otomatis tamu di nomor owner: 3 menit per nomor
const guestReplyCooldown = new Map();

function extractMessageText(message) {
    if (!message) return '';
    let m = message;
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
    if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;

    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        ''
    ).trim();
}

function resolveSender(remoteJid, sessionDir) {
    if (!remoteJid) return '';
    if (remoteJid.endsWith('@s.whatsapp.net')) {
        return remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    }
    if (remoteJid.endsWith('@lid')) {
        const lidUser = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        try {
            const reverseFile = path.join(sessionDir, `lid-mapping-${lidUser}_reverse.json`);
            if (fs.existsSync(reverseFile)) {
                const content = JSON.parse(fs.readFileSync(reverseFile, 'utf8'));
                const resolved = String(content).replace(/\D/g, '');
                if (resolved) return resolved;
            }
        } catch (e) {}
        return lidUser;
    }
    return remoteJid.replace(/\D/g, '');
}

/**
 * -------------------------------------------------------------
 * 1. INISIALISASI SESI BOT (081219363321)
 * -------------------------------------------------------------
 */
async function startBotSocket() {
    if (!fs.existsSync(config.botSessionDir)) {
        fs.mkdirSync(config.botSessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(config.botSessionDir);

    let version = [2, 3000, 1043857760];
    try {
        const vInfo = await fetchLatestWaWebVersion();
        if (vInfo && Array.isArray(vInfo.version)) version = vInfo.version;
    } catch (e) {}

    botSock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000
    });

    botSock.ev.on('creds.update', saveCreds);

    botSock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[Bot Socket] Koneksi terputus (${statusCode}). Reconnect: ${shouldReconnect}`);
            if (shouldReconnect) setTimeout(startBotSocket, 4000);
        } else if (connection === 'open') {
            console.log('✅ [Bot Socket] Nomor Bot NoaH (081219363321) AKTIF & TERHUBUNG!');
            startReminderScheduler();
        }
    });

    botSock.ev.on('messages.upsert', async ({ messages }) => {
        if (!messages || messages.length === 0) return;
        const msg = messages[0];
        if (!msg || !msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        if (!from || from.endsWith('@g.us') || from.endsWith('@newsletter') || from.includes('broadcast')) return;

        const senderPhone = resolveSender(from, config.botSessionDir);
        const body = extractMessageText(msg.message);
        if (!body) return;

        console.log(`[Bot Socket] Pesan masuk dari ${senderPhone}: "${body}"`);

        // Pesan dari Laksmana ke NoaH
        if (senderPhone === config.ownerNumber || from.includes(config.ownerNumber)) {
            const reply = await ai.handleOwnerMessage(body, from);
            if (reply) {
                await botSock.sendMessage(from, { text: reply });
            }
        } else {
            // Pesan dari orang lain ke nomor bot
            await botSock.sendMessage(from, {
                text: `Halo! Saya *NoaH*, asisten pribadi dari Bapak Laksmana. Ini adalah saluran bot operasional asisten. Jika ada keperluan penting, silakan hubungi nomor pribadi beliau langsung.`
            });
        }
    });
}

/**
 * -------------------------------------------------------------
 * 2. INISIALISASI SESI OWNER (085282695970) - AUTO-REPLY & URGENT ALERT
 * -------------------------------------------------------------
 */
async function startOwnerSocket() {
    if (!fs.existsSync(config.ownerSessionDir)) {
        fs.mkdirSync(config.ownerSessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(config.ownerSessionDir);

    let version = [2, 3000, 1043857760];
    try {
        const vInfo = await fetchLatestWaWebVersion();
        if (vInfo && Array.isArray(vInfo.version)) version = vInfo.version;
    } catch (e) {}

    ownerSock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000
    });

    ownerSock.ev.on('creds.update', saveCreds);

    if (!ownerSock.authState.creds.registered && config.ownerNumber) {
        setTimeout(async () => {
            try {
                console.log(`[Owner Socket] Meminta Pairing Code untuk nomor Laksmana: ${config.ownerNumber}`);
                const code = await ownerSock.requestPairingCode(config.ownerNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`\n======================================================`);
                console.log(`🔑 KODE PAIRING NOMOR LAKSMANA (${config.ownerNumber}):`);
                console.log(`👉 [ ${formattedCode} ]`);
                console.log(`Buka WhatsApp Laksmana > Perangkat Tertaut > Tautkan dengan nomor telepon saja`);
                console.log(`======================================================\n`);
            } catch (err) {
                console.error('[Owner Socket] Gagal meminta kode pairing:', err.message);
            }
        }, 3500);
    }

    ownerSock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[Owner Socket] Koneksi terputus (${statusCode}). Reconnect: ${shouldReconnect}`);
            if (shouldReconnect) setTimeout(startOwnerSocket, 4000);
        } else if (connection === 'open') {
            console.log('✅ [Owner Socket] Nomor Pribadi Laksmana (085282695970) AKTIF & TERHUBUNG!');
        }
    });

    ownerSock.ev.on('messages.upsert', async ({ messages }) => {
        if (!messages || messages.length === 0) return;
        const msg = messages[0];
        if (!msg || !msg.message) return;

        const from = msg.key.remoteJid;
        // Abaikan grup, saluran (newsletter), dan status WhatsApp
        if (!from || from.endsWith('@g.us') || from.endsWith('@newsletter') || from.includes('broadcast')) return;

        const body = extractMessageText(msg.message);
        if (!body) return;

        const senderPhone = resolveSender(from, config.ownerSessionDir);

        // Kasus A: Laksmana chatting ke diri sendiri (Message Yourself di nomornya sendiri)
        const isMessageToSelf = from.includes(config.ownerNumber) || senderPhone === config.ownerNumber;
        if (isMessageToSelf) {
            // Jika Laksmana mengetik pesan ke diri sendiri, layani sebagai perintah asisten!
            console.log(`[Owner Socket] Laksmana mengirim catatan ke diri sendiri: "${body}"`);
            const reply = await ai.handleOwnerMessage(body, from);
            if (reply) {
                await ownerSock.sendMessage(from, { text: reply });
            }
            return;
        }

        // Jangan balas pesan yang dikirim oleh Laksmana ke orang lain
        if (msg.key.fromMe) return;

        // Jangan balas jika pesan berasal dari nomor bot itu sendiri
        if (senderPhone === config.botNumber) return;

        const pushName = msg.pushName || senderPhone || 'Seseorang';
        console.log(`[Owner Socket] Tamu (${pushName} - ${senderPhone}): "${body}"`);

        // Cek cooldown per nomor tamu (3 menit) agar tidak spamming
        const now = Date.now();
        const lastReplyTime = guestReplyCooldown.get(senderPhone) || 0;
        const isCooldown = (now - lastReplyTime) < 3 * 60 * 1000;

        // Analisis pesan via AI NoaH
        const aiAnalysis = await ai.handleGuestMessage(body, from, pushName);

        // Kirim balasan otomatis ke tamu jika di luar cooldown atau jika urgent
        if (!isCooldown || aiAnalysis.isUrgent) {
            guestReplyCooldown.set(senderPhone, now);
            await ownerSock.sendMessage(from, { text: aiAnalysis.replyToGuest });
            console.log(`[Owner Socket] NoaH telah membalas tamu (${senderPhone}).`);
        }

        // JIKA URGENT: SEGERA LAPORKAN KE LAKSMANA VIA NOMOR BOT!
        if (aiAnalysis.isUrgent) {
            console.log(`🚨 [URGENT DETECTED!] Melaporkan pesan mendesak ke nomor Laksmana...`);
            const ownerTargetJid = `${config.ownerNumber}@s.whatsapp.net`;

            const urgentAlert = `🚨 *LAPORAN DARURAT DARI NoaH* 🚨\n\n` +
                `Pak Laksmana, ada pesan mendesak masuk di nomor pribadi Anda!\n\n` +
                `👤 *Pengirim:* ${pushName} (+${senderPhone})\n` +
                `💬 *Isi Pesan:* "${body}"\n` +
                `⚠️ *Analisis Kebutuhan:* ${aiAnalysis.urgentSummary || 'Memerlukan respons cepat'}\n\n` +
                `_Saya telah membalas tamu secara santun bahwa Anda sedang berhalangan. Mohon segera dicek ya Pak!_`;

            if (botSock) {
                await botSock.sendMessage(ownerTargetJid, { text: urgentAlert });
                try {
                    const voiceText = `Pak Laksmana, ada pesan darurat masuk di nomor pribadi Anda dari ${pushName}. ${aiAnalysis.urgentSummary || 'Mohon segera periksa WhatsApp Anda.'}`;
                    const audioBuffer = await generateVoiceNoteBuffer(voiceText);
                    if (audioBuffer) {
                        await botSock.sendMessage(ownerTargetJid, {
                            audio: audioBuffer,
                            mimetype: 'audio/mp4',
                            ptt: true
                        });
                    }
                } catch (e) {
                    console.error('[Urgent Voice Note Error]:', e.message);
                }
            }
        }
    });
}

/**
 * -------------------------------------------------------------
 * 3. SCHEDULER PENGINGAT (REMINDER ALERTS)
 * -------------------------------------------------------------
 */
let isSchedulerRunning = false;
function startReminderScheduler() {
    if (isSchedulerRunning) return;
    isSchedulerRunning = true;

    setInterval(async () => {
        if (!botSock) return;
        try {
            const dueList = reminder.getDueReminders();
            for (const item of dueList) {
                reminder.markFired(item.id);
                console.log(`[ALERT] Pengingat tiba: ${item.text} untuk ${item.targetJid}`);

                const alertText = `🚨 *PENGINGAT WAKTU TIBA!* 🚨\n\n` +
                    `Pak Laksmana, ini pengingat yang telah dijadwalkan:\n` +
                    `📝 *Kegiatan:* ${item.text}\n` +
                    `🕒 *Waktu:* ${item.targetTimeString}\n\n` +
                    `_Asisten Pribadi NoaH_`;

                await botSock.sendMessage(item.targetJid, { text: alertText });

                if (item.voiceNote) {
                    try {
                        const voiceBuffer = await generateVoiceNoteBuffer(`Halo Pak Laksmana, ini pengingat untuk Anda: ${item.text}`);
                        if (voiceBuffer) {
                            await botSock.sendMessage(item.targetJid, {
                                audio: voiceBuffer,
                                mimetype: 'audio/mp4',
                                ptt: true
                            });
                        }
                    } catch (e) {
                        console.error('[Scheduler] Gagal kirim voice note:', e.message);
                    }
                }

                if (item.call) {
                    const cleanPhone = item.targetJid.replace(/@s\.whatsapp\.net|@g\.us/g, '').split(':')[0];
                    triggerPhoneCall(cleanPhone, item.text).catch(err => {
                        console.error('[Scheduler] Gagal trigger call:', err.message);
                    });
                }
            }
        } catch (err) {
            console.error('[Scheduler Error]:', err.message);
        }
    }, 10000);
}

console.log('----------------------------------------------------');
console.log(`🤖 Memulai Sistem Dual-Session ${config.botName}`);
console.log(`👑 Pemilik: ${config.ownerName} (${config.ownerNumber})`);
console.log(`📱 Nomor Bot: ${config.botNumber}`);
console.log('----------------------------------------------------');

startBotSocket();
startOwnerSocket();

process.on('SIGINT', () => {
    console.log('\nMematikan sistem NoaH...');
    process.exit(0);
});
