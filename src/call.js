const googleTTS = require('google-tts-api');
const { spawn } = require('child_process');
const config = require('./config');

/**
 * Konversi buffer MP3 ke buffer Opus Ogg agar kompatibel 100% sebagai WhatsApp Voice Note (PTT)
 */
function convertMp3ToOpusOgg(mp3Buffer) {
    return new Promise((resolve) => {
        try {
            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-c:a', 'libopus',
                '-b:a', '32k',
                '-vbr', 'on',
                '-compression_level', '10',
                '-f', 'ogg',
                'pipe:1'
            ]);

            const chunks = [];
            ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
            ffmpeg.stdout.on('end', () => {
                if (chunks.length > 0) {
                    resolve({
                        buffer: Buffer.concat(chunks),
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: true
                    });
                } else {
                    resolve({
                        buffer: mp3Buffer,
                        mimetype: 'audio/mpeg',
                        ptt: false
                    });
                }
            });

            ffmpeg.stderr.on('data', () => {});
            ffmpeg.on('error', (err) => {
                console.warn('[FFMPEG] Gagal konversi Opus Ogg, fallback ke audio MP3:', err.message);
                resolve({
                    buffer: mp3Buffer,
                    mimetype: 'audio/mpeg',
                    ptt: false
                });
            });

            ffmpeg.stdin.write(mp3Buffer);
            ffmpeg.stdin.end();
        } catch (e) {
            resolve({
                buffer: mp3Buffer,
                mimetype: 'audio/mpeg',
                ptt: false
            });
        }
    });
}

/**
 * Generate audio buffer untuk pesan suara WA (PTT Voice Note)
 */
async function generateVoiceNoteBuffer(text) {
    try {
        const cleanText = text.slice(0, 199); // Google TTS limit ~200 chars per request
        const base64 = await googleTTS.getAudioBase64(cleanText, {
            lang: 'id',
            slow: false,
            host: 'https://translate.google.com',
            timeout: 10000
        });
        const mp3Buffer = Buffer.from(base64, 'base64');
        return await convertMp3ToOpusOgg(mp3Buffer);
    } catch (err) {
        console.error('[TTS] Gagal generate audio:', err.message);
        return null;
    }
}

/**
 * Lakukan panggilan suara telepon GSM melalui Twilio Voice API jika dikonfigurasi
 */
async function triggerPhoneCall(toPhoneNumber, reminderText) {
    const { accountSid, authToken, fromNumber } = config.twilio;
    if (!accountSid || !authToken || !fromNumber || !toPhoneNumber) {
        return { success: false, reason: 'Twilio belum dikonfigurasi di .env' };
    }

    try {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
        const twiml = `<Response><Say voice="alice" language="id-ID">Halo, ini asisten privat WhatsApp kamu. Pengingat: ${reminderText}. Sekali lagi: ${reminderText}. Terima kasih.</Say></Response>`;

        const target = toPhoneNumber.startsWith('+') ? toPhoneNumber : `+${toPhoneNumber}`;

        const params = new URLSearchParams();
        params.append('To', target);
        params.append('From', fromNumber);
        params.append('Twiml', twiml);

        const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        const json = await res.json();
        if (res.ok) {
            console.log(`[Twilio Call] Berhasil memanggil ${target}, SID: ${json.sid}`);
            return { success: true, sid: json.sid };
        } else {
            console.error('[Twilio Call] Error response:', json);
            return { success: false, error: json.message };
        }
    } catch (err) {
        console.error('[Twilio Call] Exception:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    generateVoiceNoteBuffer,
    triggerPhoneCall
};
