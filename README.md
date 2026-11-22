# 🤖 PRIVATE ASISTEN (WhatsApp Bot)

Asisten pribadi WhatsApp untuk penjadwalan, pengingat otomatis (reminder), pesan suara (Voice Note), dan panggilan suara.

---

## ✨ Fitur Utama
1. **Private Access**: Hanya merespons nomor pemilik (*Owner*).
2. **Pengingat Terjadwal (Reminder)**:
   - Waktu relatif: `!ingat 15m Matikan kompor`, `!ingat 2 jam Kerjakan tugas`
   - Jam spesifik: `!ingat 14:30 Meeting dengan klien`
3. **Dual Alert Notification**:
   - 💬 **Pesan Teks Alarm WhatsApp**
   - 🎙️ **Pesan Suara Otomatis (PTT Voice Note)**: Bot mengirim rekaman suara Text-to-Speech bahasa Indonesia.
   - 📞 **Panggilan Telepon (Opsional via Twilio)**: Jika dikonfigurasi, bot langsung menelpon nomor HP kamu.
4. **Natural Language / AI Chat**:
   - Jika `GEMINI_API_KEY` diisi, kamu bisa chat bebas: _"ingetin gw 20 menit lagi angkat jemuran"_, bot otomatis menjadwalkan.
5. **VPS Ready**:
   - Mendukung autentikasi via **Pairing Code** (tanpa perlu scan QR di terminal VPS).
   - Dilengkapi konfigurasi PM2 (`ecosystem.config.js`) & Dockerfile.

---

## 🚀 Cara Menjalankan Lokal

1. Salin `.env.example` ke `.env`:
   ```bash
   cp .env.example .env
   ```
2. Isi `OWNER_NUMBER` dengan nomor WhatsApp Anda (format: `628123456789`).
3. Jalankan bot:
   ```bash
   npm start
   ```
4. Scan QR code yang muncul di terminal menggunakan WhatsApp di HP.

---

## 🌐 Cara Deploy ke VPS

### Opsi 1: Menggunakan PM2 (Direkomendasikan)
1. Clone repo di VPS:
   ```bash
   git clone <URL_REPO_GITHUB>
   cd private-asisten
   npm install --omit=dev
   ```
2. Buat file `.env` dan atur:
   ```env
   OWNER_NUMBER="628123456789"
   AUTH_MODE="pairing"
   PAIRING_NUMBER="628123456789"
   ```
3. Jalankan pertama kali secara manual untuk input kode pairing:
   ```bash
   npm start
   ```
   Masukkan 8 digit kode pairing ke WhatsApp HP > **Perangkat Tertaut** > **Tautkan dengan nomor telepon**.
4. Setelah terhubung, jalankan bot di background via PM2:
   ```bash
   npm install -g pm2
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

---

## 📋 Daftar Perintah Bot
| Perintah | Contoh | Keterangan |
|---|---|---|
| `!menu` | `!menu` | Menampilkan panduan |
| `!ingat <waktu> <pesan>` | `!ingat 15m Minum obat` | Buat pengingat baru |
| `!call <waktu> <pesan>` | `!call 14:00 Meeting` | Pengingat + telepon GSM |
| `!list` / `!jadwal` | `!list` | Cek daftar pengingat aktif |
| `!hapus <id>` | `!hapus kl39x` | Batalkan pengingat |
