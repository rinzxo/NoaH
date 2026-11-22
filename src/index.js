const dns = require('dns');
try {
    dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestWaWebVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const qrcodeTerminal = require('qrcode-terminal');
const config = require('./config');
const reminder = require('./reminder');
const { generateVoiceNoteBuffer, triggerPhoneCall } = require('./call');
const ai = require('./ai');

const logger = pino({ level: 'silent' });
let sock = null;

function isOwner(remoteJid) {
    if (!config.ownerNumber) return true; // Jika belum diset di .env, izinkan untuk testing
    const sender = remoteJid.replace(/@s\.whatsapp\.net|@g\.us/g, '').split(':')[0];
    return sender === config.ownerNumber;
}

async function startBot() {
    console.log('----------------------------------------------------');
    console.log(`🤖 Memulai ${config.botName}...`);
    console.log(`📱 Mode Autentikasi: ${config.authMode.toUpperCase()}`);
    if (config.ownerNumber) console.log(`👑 Owner Number: ${config.ownerNumber}`);
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
        browser: Browsers.windows('Desktop'),
        auth: state,
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && config.authMode === 'qr') {
            console.log('\n📱 Silakan Scan QR Code berikut dengan WhatsApp Anda:');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (update.qr && config.authMode === 'pairing') {
            if (!sock.authState.creds.registered && config.pairingNumber) {
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(config.pairingNumber);
                        console.log(`\n🔑 KODE PAIRING ANDA: [ ${code} ]`);
                        console.log(`Buka WhatsApp di HP > Perangkat Tertaut > Tautkan dengan Kode Telepon, masukkan kode di atas.\n`);
                    } catch (err) {
                        console.error('[Pairing] Gagal meminta kode pairing:', err.message);
                    }
                }, 4000);
            }
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

        if (!isOwner(from)) {
            console.log(`[Security] Mengabaikan pesan dari bukan owner: ${from}`);
            return;
        }

        const body = (
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            ''
        ).trim();

        if (!body) return;

        console.log(`[Pesan Masuk] ${body}`);
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

    // 5. Natural Language processing via Gemini AI
    try {
        const aiParsed = await ai.parseNaturalLanguageReminder(text);
        if (aiParsed && aiParsed.isReminder && aiParsed.targetTimeISO) {
            const targetDate = new Date(aiParsed.targetTimeISO);
            if (!isNaN(targetDate.getTime()) && targetDate.getTime() > Date.now()) {
                const item = reminder.addReminder(aiParsed.reminderText || text, targetDate, from, {
                    voiceNote: true,
                    call: Boolean(aiParsed.callPhone)
                });

                await sock.sendMessage(from, {
                    text: `✅ *Siap! Pengingat Dicatat*\n\n` +
                        `🆔 ID: *${item.id}*\n` +
                        `📝 Pengingat: ${item.text}\n` +
                        `⏰ Waktu: ${item.targetTimeString}\n` +
                        `🔔 Notifikasi: Teks WA + Voice Note ${item.call ? '+ Telepon' : ''}`
                });
                return;
            }
        }

        // Jika bukan pengingat, balas percakapan santai via AI
        const reply = await ai.chatAssistant(text);
        await sock.sendMessage(from, { text: reply });
    } catch (err) {
        console.error('[Handler] Error:', err.message);
        await sock.sendMessage(from, { text: 'Perintah tidak dikenali. Ketik *!menu* untuk melihat panduan.' });
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
