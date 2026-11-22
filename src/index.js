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
const qrcodeTerminal = require('qrcode-terminal');
const config = require('./config');
const reminder = require('./reminder');
const { generateVoiceNoteBuffer, triggerPhoneCall } = require('./call');
const ai = require('./ai');

const logger = pino({ level: 'silent' });
let sock = null;

function resolveSender(remoteJid) {
    if (!remoteJid) return '';
    if (remoteJid.endsWith('@s.whatsapp.net')) {
        return remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    }
    if (remoteJid.endsWith('@lid')) {
        const lidUser = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        try {
            const reverseFile = path.join(config.sessionDir, `lid-mapping-${lidUser}_reverse.json`);
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

function isOwner(remoteJid) {
    if (!config.ownerNumbers || config.ownerNumbers.length === 0) return true;
    const phone = resolveSender(remoteJid);
    return config.ownerNumbers.includes(phone);
}

async function startBot() {
    console.log('----------------------------------------------------');
    console.log(`🤖 Memulai ${config.botName}...`);
    console.log(`📱 Mode Autentikasi: ${config.authMode.toUpperCase()}`);
    if (config.ownerNumbers?.length) console.log(`👑 Owner Number: ${config.ownerNumbers.join(', ')}`);
    console.log('----------------------------------------------------');

    const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);

    let version = [2, 3000, 1043857760];
    try {
        const vInfo = await fetchLatestWaWebVersion();
        if (vInfo && Array.isArray(vInfo.version)) version = vInfo.version;
    } catch (e) {}

    sock = makeWASocket({
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

    sock.ev.on('creds.update', saveCreds);

    if (config.authMode === 'pairing' && !sock.authState.creds.registered && config.pairingNumber) {
        setTimeout(async () => {
            try {
                console.log(`[Baileys] Meminta Pairing Code untuk nomor: ${config.pairingNumber}`);
                const code = await sock.requestPairingCode(config.pairingNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`\n🔑 KODE PAIRING WHATSAPP: [ ${formattedCode} ]`);
                console.log(`Buka WhatsApp di HP > Perangkat Tertaut > Tautkan dengan nomor telepon saja\n`);
            } catch (err) {
                console.error('[Baileys] Gagal meminta kode pairing:', err.message);
            }
        }, 3500);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && config.authMode === 'qr') {
            console.log('\n📱 Silakan Scan QR Code berikut dengan WhatsApp Anda:');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ Koneksi terputus (status: ${statusCode}). Mencoba koneksi ulang: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(startBot, 3000);
            } else {
                console.log('❌ Sesi WhatsApp telah Logout. Hapus folder sessions/ untuk menghubungkan ulang.');
            }
        } else if (connection === 'open') {
            console.log('✅ Bot WhatsApp berhasil terhubung dan siap digunakan!');
            startReminderScheduler();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg || !msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        if (isGroup) return; // Asisten privat hanya bekerja di direct chat

        const resolvedSender = resolveSender(from);
        if (!isOwner(from)) {
            console.log(`[Security] Mengabaikan pesan dari bukan owner: ${from} (resolved: ${resolvedSender})`);
            return;
        }

        const body = (
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            ''
        ).trim();

        if (!body) return;

        console.log(`[Pesan Masuk dari ${resolvedSender}] ${body}`);
        await handleMessage(from, body);
    });
}

async function handleMessage(from, text) {
    const lower = text.toLowerCase();

    // 1. Menu / Help
    if (lower === '!menu' || lower === '!help' || lower === 'menu' || lower === 'bantuan') {
        const menuText = `*📋 MENU ASISTEN PRIVAT*\n\n` +
            `*Perintah Pengingat (Reminder):*\n` +
            `• *!ingat <waktu> <pesan>*\n` +
            `  Contoh: _!ingat 15m Matikan kompor_\n` +
            `  Contoh: _!ingat 14:30 Meeting dengan tim_\n` +
            `  Contoh: _!ingat 2 jam Minum air_\n\n` +
            `• *!call <waktu> <pesan>*\n` +
            `  Sama seperti !ingat + memicu panggilan suara (Twilio jika aktif)\n\n` +
            `• *!list* / *!jadwal*\n` +
            `  Melihat daftar pengingat yang aktif\n\n` +
            `• *!hapus <id>*\n` +
            `  Membatalkan pengingat sesuai ID\n\n` +
            `_Catatan: Jika Anda mengirim pesan bahasa biasa, AI akan otomatis mendeteksi jadwal pengingat._`;

        await sock.sendMessage(from, { text: menuText });
        return;
    }

    // 2. List Reminders
    if (lower === '!list' || lower === '!jadwal') {
        const list = reminder.listReminders(from);
        if (list.length === 0) {
            await sock.sendMessage(from, { text: '📭 Tidak ada pengingat aktif saat ini.' });
            return;
        }

        let resp = `*⏰ DAFTAR PENGINGAT AKTIF (${list.length}):*\n\n`;
        list.forEach((item, idx) => {
            resp += `${idx + 1}. *[ID: ${item.id}]*\n`;
            resp += `   📝 Pesan: ${item.text}\n`;
            resp += `   🕒 Waktu: ${item.targetTimeString}\n`;
            resp += `   📞 Call: ${item.call ? 'Ya' : 'Voice Note'}\n\n`;
        });
        resp += `_Gunakan *!hapus <id>* untuk membatalkan._`;
        await sock.sendMessage(from, { text: resp });
        return;
    }

    // 3. Hapus Reminder
    if (lower.startsWith('!hapus ')) {
        const id = text.substring(7).trim();
        const success = reminder.cancelReminder(id, from);
        if (success) {
            await sock.sendMessage(from, { text: `✅ Pengingat dengan ID *${id}* berhasil dibatalkan.` });
        } else {
            await sock.sendMessage(from, { text: `❌ Pengingat dengan ID *${id}* tidak ditemukan.` });
        }
        return;
    }

    // 4. Perintah !ingat atau !call
    const isCallCommand = lower.startsWith('!call ');
    const isIngatCommand = lower.startsWith('!ingat ');

    if (isCallCommand || isIngatCommand) {
        const content = text.substring(isCallCommand ? 6 : 7).trim();
        const parts = content.split(' ');
        if (parts.length < 2) {
            await sock.sendMessage(from, { text: `Format salah. Contoh: *!ingat 15m Matikan kompor*` });
            return;
        }

        let timeStr = parts[0];
        let reminderMsg = parts.slice(1).join(' ');

        // Kasus: "!ingat 2 jam makan" -> timeStr: "2 jam", reminderMsg: "makan"
        if (['jam', 'menit', 'hari'].includes(parts[1]?.toLowerCase())) {
            timeStr = `${parts[0]} ${parts[1]}`;
            reminderMsg = parts.slice(2).join(' ');
        }

        const targetDate = reminder.parseRelativeTime(timeStr);
        if (!targetDate) {
            await sock.sendMessage(from, { text: `❌ Format waktu "${timeStr}" tidak valid. Gunakan 10m, 2 jam, atau 14:30.` });
            return;
        }

        const item = reminder.addReminder(reminderMsg, targetDate, from, {
            voiceNote: true,
            call: isCallCommand
        });

        await sock.sendMessage(from, {
            text: `✅ *Pengingat Berhasil Disimpan!*\n\n` +
                `🆔 ID: *${item.id}*\n` +
                `📝 Pesan: ${item.text}\n` +
                `⏰ Waktu: ${item.targetTimeString}\n` +
                `🔔 Metode: Pesan WA + Voice Note ${item.call ? '+ Telepon' : ''}`
        });
        return;
    }

    // 5. Real AI Assistant dengan Gemini Function Calling (AI Tools)
    try {
        const reply = await ai.handleUserMessageWithAI(text, from);
        if (reply) {
            await sock.sendMessage(from, { text: reply });
            return;
        }
    } catch (err) {
        console.error('[Handler AI Error]:', err.message);
        await sock.sendMessage(from, { text: 'Maaf, asisten AI sedang memproses terlalu banyak data sejenak. Coba tanyakan lagi ya!' });
    }
}

// Scheduler pengecekan pengingat setiap 10 detik
let isSchedulerRunning = false;
function startReminderScheduler() {
    if (isSchedulerRunning) return;
    isSchedulerRunning = true;

    setInterval(async () => {
        if (!sock) return;
        try {
            const dueList = reminder.getDueReminders();
            for (const item of dueList) {
                reminder.markFired(item.id);
                console.log(`[ALERT] Memproses pengingat: ${item.text} untuk ${item.targetJid}`);

                // 1. Kirim pesan teks alarm
                const alertText = `🚨 *PENGINGAT WAKTU TIBA!* 🚨\n\n` +
                    `📝 *Pesan:* ${item.text}\n` +
                    `🕒 *Waktu Terjadwal:* ${item.targetTimeString}\n\n` +
                    `_Asisten Privat Anda_`;

                await sock.sendMessage(item.targetJid, { text: alertText });

                // 2. Kirim pesan suara (PTT Voice Note)
                if (item.voiceNote) {
                    try {
                        const voiceBuffer = await generateVoiceNoteBuffer(`Halo! Ini pengingat untuk kamu: ${item.text}`);
                        if (voiceBuffer) {
                            await sock.sendMessage(item.targetJid, {
                                audio: voiceBuffer,
                                mimetype: 'audio/mp4',
                                ptt: true
                            });
                        }
                    } catch (e) {
                        console.error('[Scheduler] Gagal kirim voice note:', e.message);
                    }
                }

                // 3. Panggil via Twilio jika diaktifkan
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

// Tangani shutdown bersih
process.on('SIGINT', () => {
    console.log('\nMematikan bot...');
    process.exit(0);
});

startBot();
