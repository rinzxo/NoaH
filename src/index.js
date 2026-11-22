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

// File konfigurasi auto-reply persisten
const settingsFile = path.join(__dirname, '../data/settings.json');
function loadSettings() {
    try {
        if (fs.existsSync(settingsFile)) {
            return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        }
    } catch (e) {}
    return { autoReplyEnabled: true, delayMinutes: 3 };
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) {
        console.error('[Settings] Gagal menyimpan settings:', e.message);
    }
}

let appSettings = loadSettings();

// Pelacak Aktivitas Owner (Laksmana) agar asisten tidak menyela obrolan yang sedang aktif
let lastOwnerGlobalActivity = 0;
const lastChatActivity = new Map(); // chatKey -> timestamp
const pendingGuestReplies = new Map(); // chatKey -> { timeout, messages: [], pushName, senderPhone, from }
const guestCooldown = new Map(); // chatKey -> timestamp

function handleSettingsCommand(text) {
    const clean = text.toLowerCase().trim();
    if (/(matikan|nonaktifkan|stop|off)\s+auto\s*reply/i.test(clean)) {
        appSettings.autoReplyEnabled = false;
        saveSettings(appSettings);
        return '🔴 *Auto-Reply Tamu Dinonaktifkan*\n\nBaik Pak Laksmana, fitur balasan otomatis untuk tamu di nomor pribadi Anda telah saya *NONAKTIFKAN*. NoaH tidak akan membalas pesan tamu sama sekali.';
    }
    if (/(nyalakan|aktifkan|hidupkan|on)\s+auto\s*reply/i.test(clean)) {
        appSettings.autoReplyEnabled = true;
        saveSettings(appSettings);
        return `🟢 *Auto-Reply Tamu Diaktifkan*\n\nSiap Pak Laksmana! Balasan otomatis untuk pesan tamu telah *DIAKTIFKAN* kembali dengan jeda cerdas ${appSettings.delayMinutes || 3} menit.\n\nNoaH *TIDAK AKAN* membalas jika:\n1. Anda sedang aktif chatting di WhatsApp.\n2. Anda baru saja mengobrol dengan kontak tersebut.\n3. Anda membalas pesan tamu sebelum jeda waktu habis.`;
    }
    const delayMatch = clean.match(/(?:jeda|delay)\s+auto\s*reply\s+(?:jadi\s+)?(\d+)\s*(?:menit|m)?/i);
    if (delayMatch) {
        const mins = parseInt(delayMatch[1], 10);
        if (mins >= 1 && mins <= 60) {
            appSettings.delayMinutes = mins;
            saveSettings(appSettings);
            return `⏱️ *Jeda Auto-Reply Diperbarui*\n\nSiap Pak Laksmana! Jeda waktu tunggu sebelum NoaH membalas pesan tamu diubah menjadi *${mins} menit*.`;
        }
    }
    if (/(status|cek)\s+auto\s*reply/i.test(clean)) {
        const status = appSettings.autoReplyEnabled ? '🟢 AKTIF' : '🔴 NONAKTIF';
        return `ℹ️ *Status Auto-Reply NoaH:*\n\n• Status: *${status}*\n• Jeda waktu tunggu: *${appSettings.delayMinutes || 3} menit*\n\n_Ketik "matikan auto reply" untuk mematikan, atau "jeda auto reply 5 menit" untuk mengubah jeda waktu._`;
    }
    return null;
}

async function executeDelayedGuestReply(chatKey) {
    const item = pendingGuestReplies.get(chatKey);
    pendingGuestReplies.delete(chatKey);
    if (!item) return;

    if (!appSettings.autoReplyEnabled) return;

    // Pastikan lagi apakah Pak Laksmana sempat aktif sebelum jeda berakhir
    const lastChatTime = lastChatActivity.get(chatKey) || 0;
    if (Date.now() - lastChatTime < 10 * 60 * 1000) {
        console.log(`[Auto-Reply] Dibatalkan: Pak Laksmana aktif di obrolan dengan ${chatKey}.`);
        return;
    }
    if (Date.now() - lastOwnerGlobalActivity < 3 * 60 * 1000) {
        console.log(`[Auto-Reply] Dibatalkan: Pak Laksmana terdeteksi aktif/online di WhatsApp.`);
        return;
    }

    const fullText = item.messages.join('\n');
    console.log(`[Auto-Reply] Mengeksekusi balasan otomatis untuk ${item.pushName} (${chatKey})...`);

    try {
        const aiAnalysis = await ai.handleGuestMessage(fullText, item.from, item.pushName);
        if (aiAnalysis && aiAnalysis.replyToGuest) {
            await ownerSock.sendMessage(item.from, { text: aiAnalysis.replyToGuest });
            guestCooldown.set(chatKey, Date.now());
            console.log(`✅ [Auto-Reply] NoaH berhasil membalas pesan tertunda dari ${item.pushName} (${chatKey}).`);
        }
    } catch (err) {
        console.error('[Delayed Reply Error]:', err.message);
    }
}

async function checkUrgentAlertInBackground(body, from, pushName, senderPhone) {
    try {
        const lower = body.toLowerCase();
        const urgentKeywords = ['urgent', 'darurat', 'penting', 'tolong', 'cepet', 'cepat', 'segera', 'down', 'error', 'rusak', 'sakit', 'kecelakaan', 'transfer', 'gawat', 'help'];
        const mightBeUrgent = urgentKeywords.some(kw => lower.includes(kw));
        if (!mightBeUrgent && body.length < 50) return;

        const aiAnalysis = await ai.handleGuestMessage(body, from, pushName);
        if (aiAnalysis && aiAnalysis.isUrgent) {
            console.log(`🚨 [URGENT DETECTED!] Melaporkan pesan mendesak ke nomor Laksmana...`);
            const ownerTargetJid = `${config.ownerNumber}@s.whatsapp.net`;
            const urgentAlert = `🚨 *LAPORAN DARURAT DARI NoaH* 🚨\n\n` +
                `Pak Laksmana, ada pesan mendesak masuk di nomor pribadi Anda!\n\n` +
                `👤 *Pengirim:* ${pushName} (+${senderPhone})\n` +
                `💬 *Isi Pesan:* "${body}"\n` +
                `⚠️ *Analisis Kebutuhan:* ${aiAnalysis.urgentSummary || 'Memerlukan respons cepat'}\n\n` +
                `_Pesan ini masuk di WhatsApp pribadi Anda saat Anda belum merespons. Mohon segera dicek ya Pak!_`;

            if (botSock) {
                await botSock.sendMessage(ownerTargetJid, { text: urgentAlert });
                try {
                    const voiceText = `Pak Laksmana, ada pesan darurat masuk dari ${pushName}. ${aiAnalysis.urgentSummary || 'Mohon segera periksa WhatsApp Anda.'}`;
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
    } catch (e) {
        console.error('[Urgent Check Error]:', e.message);
    }
}

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
            const settingReply = handleSettingsCommand(body);
            if (settingReply) {
                await botSock.sendMessage(from, { text: settingReply });
                return;
            }
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
        const chatKey = resolveSender(from, config.ownerSessionDir) || from.replace(/@.+/, '');

        // KASUS A: Pesan dikirim oleh Laksmana sendiri (fromMe: true)
        if (msg.key.fromMe) {
            lastOwnerGlobalActivity = Date.now();
            lastChatActivity.set(chatKey, Date.now());

            // Batalkan antrean auto-reply jika ada untuk kontak ini!
            if (pendingGuestReplies.has(chatKey)) {
                console.log(`[Auto-Reply] Dibatalkan: Pak Laksmana membalas sendiri chat ke ${chatKey}`);
                clearTimeout(pendingGuestReplies.get(chatKey).timeout);
                pendingGuestReplies.delete(chatKey);
            }

            // Cek apakah ini pesan ke diri sendiri ("Message Yourself")
            const isSelfChat = from.includes(config.ownerNumber) || chatKey === config.ownerNumber;
            if (isSelfChat && body) {
                console.log(`[Owner Socket] Laksmana mengirim pesan ke diri sendiri: "${body}"`);
                const settingReply = handleSettingsCommand(body);
                if (settingReply) {
                    await ownerSock.sendMessage(from, { text: settingReply });
                    return;
                }
                const reply = await ai.handleOwnerMessage(body, from);
                if (reply) {
                    await ownerSock.sendMessage(from, { text: reply });
                }
            }
            return;
        }

        if (!body) return;

        // Abaikan jika pesan berasal dari nomor bot itu sendiri
        if (chatKey === config.botNumber) return;

        const pushName = msg.pushName || chatKey || 'Tamu';
        console.log(`[Owner Socket] Tamu (${pushName} - ${chatKey}): "${body}"`);

        // 1. Cek apakah fitur auto-reply diaktifkan
        if (!appSettings.autoReplyEnabled) {
            console.log(`[Auto-Reply] Dilewati: Fitur auto-reply sedang dinonaktifkan.`);
            return;
        }

        // 2. Cek apakah Laksmana sedang AKTIF:
        // a. Aktif di chat ini dalam 10 menit terakhir?
        const lastChatTime = lastChatActivity.get(chatKey) || 0;
        if (Date.now() - lastChatTime < 10 * 60 * 1000) {
            console.log(`[Auto-Reply] Dilewati: Pak Laksmana sedang aktif mengobrol dengan ${pushName} (${chatKey}).`);
            return;
        }

        // b. Aktif di WhatsApp secara umum dalam 3 menit terakhir?
        if (Date.now() - lastOwnerGlobalActivity < 3 * 60 * 1000) {
            console.log(`[Auto-Reply] Dilewati: Pak Laksmana sedang aktif/online di WhatsApp.`);
            return;
        }

        // 3. Cek cooldown (agar tidak membalas berulang kali dalam 30 menit ke kontak yang sama)
        const lastReply = guestCooldown.get(chatKey) || 0;
        if (Date.now() - lastReply < 30 * 60 * 1000) {
            console.log(`[Auto-Reply] Dilewati: Kontak ${chatKey} sudah pernah dibalas otomatis dalam 30 menit terakhir.`);
            return;
        }

        // 4. Jadwalkan balasan otomatis tertunda (3 menit jeda default)
        const delayMs = (appSettings.delayMinutes || 3) * 60 * 1000;

        if (!pendingGuestReplies.has(chatKey)) {
            console.log(`[Auto-Reply] Menjadwalkan auto-reply untuk ${pushName} (${chatKey}) dalam ${appSettings.delayMinutes || 3} menit jika tidak dibalas Laksmana.`);
            const pendingItem = {
                from,
                chatKey,
                pushName,
                senderPhone: chatKey,
                messages: [body],
                timeout: setTimeout(async () => {
                    await executeDelayedGuestReply(chatKey);
                }, delayMs)
            };
            pendingGuestReplies.set(chatKey, pendingItem);
        } else {
            const item = pendingGuestReplies.get(chatKey);
            item.messages.push(body);
            console.log(`[Auto-Reply] Menambahkan pesan baru dari ${pushName} ke antrean tertunda.`);
        }

        // 5. Cek darurat (Urgent) di latar belakang TANPA membalas tamu duluan
        checkUrgentAlertInBackground(body, from, pushName, chatKey);
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
