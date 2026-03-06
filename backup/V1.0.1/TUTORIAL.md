# Tutorial Setup NTO BOT

Panduan lengkap dari awal hingga bot siap digunakan.

---

## Daftar Isi

1. [Install NTO BOT](#1-install-nto-bot)
2. [Membuat Telegram Bot (BotFather)](#2-membuat-telegram-bot-botfather)
3. [Mendapatkan Chat ID Telegram](#3-mendapatkan-chat-id-telegram)
4. [Daftar 2Captcha (untuk PAY4D)](#4-daftar-2captcha-untuk-pay4d)
5. [Konfigurasi di Panel NTO BOT](#5-konfigurasi-di-panel-nto-bot)
6. [Menambahkan Akun Provider](#6-menambahkan-akun-provider)
7. [Menjalankan Bot](#7-menjalankan-bot)
8. [Menggunakan Telegram Command](#8-menggunakan-telegram-command)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Install NTO BOT

### Cara Cepat (Installer)

1. Download `NTO-BOT-Setup.exe`
2. Jalankan installer, klik **Next** sampai selesai
3. Installer otomatis:
   - Install Node.js (jika belum ada)
   - Download semua dependencies
   - Setup database
   - Install browser Chromium
   - Buat shortcut di Desktop
4. Double-click **NTO BOT** di Desktop untuk mulai

### Cara Manual

```bash
cd SERVER
npm install
npx prisma generate
npx prisma db push
npx playwright install chromium
npx tsx src/index.ts
```

Buka browser ke `http://localhost:6969`

---

## 2. Membuat Telegram Bot (BotFather)

### Step 1: Buka BotFather

1. Buka Telegram
2. Cari **@BotFather** di search bar
3. Klik **Start** atau ketik `/start`

### Step 2: Buat Bot Baru

1. Ketik `/newbot`
2. BotFather akan bertanya **nama bot** — masukkan nama yang kamu mau
   ```
   NTO Bot
   ```
3. BotFather akan bertanya **username bot** — harus diakhiri dengan `bot`
   ```
   nto_checker_bot
   ```
4. BotFather akan memberikan **Bot Token** seperti ini:
   ```
   7123456789:AAH1bGcjRk_xXxXxXxXxXxXxXxXxXxXxXx
   ```

> **PENTING:** Simpan token ini! Jangan share ke orang lain.

### Step 3: Disable Group Privacy (Opsional)

Jika ingin bot bisa membaca pesan di grup:

1. Ketik `/mybots` di BotFather
2. Pilih bot kamu
3. Pilih **Bot Settings** > **Group Privacy**
4. Pilih **Turn off**

### Step 4: Tambahkan Bot ke Grup

1. Buat grup Telegram baru atau buka grup yang sudah ada
2. Tambahkan bot kamu ke grup (search username bot)
3. Bot akan muncul sebagai member

---

## 3. Mendapatkan Chat ID Telegram

Chat ID diperlukan untuk bot mengirim notifikasi ke grup/chat yang benar.

### Cara 1: Menggunakan @userinfobot

1. Buka Telegram
2. Cari **@userinfobot**
3. Klik **Start**
4. Bot akan membalas dengan info kamu termasuk **ID**
   ```
   Id: 123456789
   ```
5. Ini adalah **Chat ID pribadi** kamu

### Cara 2: Mendapatkan Chat ID Grup

1. Tambahkan **@RawDataBot** ke grup kamu
2. RawDataBot akan mengirim pesan JSON
3. Cari bagian `"chat"` > `"id"`:
   ```json
   "chat": {
     "id": -1001234567890,
     "title": "Nama Grup",
     "type": "supergroup"
   }
   ```
4. Angka `-1001234567890` adalah **Chat ID grup**
5. **Keluarkan @RawDataBot** dari grup setelah dapat ID

### Cara 3: Menggunakan API Telegram

Setelah punya Bot Token, buka URL ini di browser (ganti `TOKEN` dengan token bot kamu):

```
https://api.telegram.org/botTOKEN/getUpdates
```

Kirim pesan apapun ke bot/grup, lalu refresh URL. Cari `"chat":{"id":...}` di response.

---

## 4. Daftar 2Captcha (untuk PAY4D)

> **Catatan:** 2Captcha hanya diperlukan jika menggunakan provider **PAY4D**. NUKE dan VICTORY tidak memerlukan 2Captcha.

### Step 1: Daftar Akun

1. Buka [https://2captcha.com](https://2captcha.com)
2. Klik **Sign Up** / **Register**
3. Isi form pendaftaran (email, password)
4. Verifikasi email

### Step 2: Top Up Saldo

1. Login ke dashboard 2Captcha
2. Klik **Top Up Balance** atau **Add Funds**
3. Pilih metode pembayaran:
   - **Cryptocurrency** (Bitcoin, Ethereum, dll)
   - **Perfect Money**
   - **PayPal** (via Airtm)
   - Dan lainnya
4. Minimum top up: **$1.00**
5. Harga per solve: sekitar **$0.001 - $0.003** (sangat murah)

> **Estimasi biaya:** 1000 captcha solve = ~$1-3. Saldo $1 cukup untuk ratusan kali solve.

### Step 3: Dapatkan API Key

1. Login ke [2captcha.com](https://2captcha.com)
2. Buka halaman **Dashboard** atau **API Settings**
3. Cari bagian **API Key** — biasanya terlihat seperti:
   ```
   a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
   ```
4. Copy API Key ini

### Cara Kerja

NTO BOT menggunakan 2Captcha untuk menyelesaikan image captcha di halaman login PAY4D secara otomatis:

```
Login PAY4D → Captcha muncul → Screenshot dikirim ke 2Captcha API
→ 2Captcha solve (~10 detik) → Jawaban diisi otomatis → Login berhasil
```

Setiap solve dicatat di tabel **CaptchaUsage** dan bisa dilihat di panel Settings > Captcha History.

---

## 5. Konfigurasi di Panel NTO BOT

Buka `http://localhost:6969` dan klik menu **Settings**.

### Telegram Settings

| Field | Isi dengan | Contoh |
|---|---|---|
| **Bot Token** | Token dari BotFather (Step 2) | `7123456789:AAH1bGcjRk_xXx...` |
| **Chat ID** | Chat ID dari Step 3 | `-1001234567890` |
| **Notification Enabled** | Toggle ON | |

Setelah mengisi Bot Token dan Chat ID:
1. Klik toggle **Telegram Listener** ke **ON**
2. Status akan berubah menjadi **Running**
3. Bot sekarang mendengarkan perintah dari Telegram

### Captcha Settings (untuk PAY4D)

| Field | Isi dengan | Contoh |
|---|---|---|
| **2Captcha API Key** | API Key dari 2captcha.com | `a1b2c3d4e5f6...` |

Setelah mengisi API Key:
- **Balance** akan muncul otomatis (menunjukkan saldo 2Captcha)
- **Captcha History** menampilkan riwayat solve dan biaya

### Browser Settings

| Setting | Default | Keterangan |
|---|---|---|
| **Headless Mode** | OFF | ON = browser tidak terlihat (background) |
| **Slow Mo** | 100ms | Kecepatan klik/ketik (semakin rendah semakin cepat) |

---

## 6. Menambahkan Akun Provider

Klik tab provider yang ingin ditambahkan (**NUKE**, **PAY4D**, atau **VICTORY**).

### NUKE

| Field | Keterangan |
|---|---|
| Account Name | Nama untuk identifikasi (bebas) |
| Panel URL | URL panel NUKE (contoh: `https://nukepanel.com`) |
| Username | Username login panel |
| Password | Password login panel |

> NUKE menggunakan OTP. Saat login pertama kali, bot akan menunggu kamu memasukkan OTP dari panel.

### PAY4D

| Field | Keterangan |
|---|---|
| Account Name | Nama untuk identifikasi (bebas) |
| Panel URL | URL panel PAY4D |
| Username | Username login panel |
| Password | Password login panel |
| PIN Code | PIN 6 digit untuk verifikasi setelah login |

> PAY4D memerlukan **2Captcha API Key** yang sudah dikonfigurasi di Settings.

### VICTORY

| Field | Keterangan |
|---|---|
| Account Name | Nama untuk identifikasi (bebas) |
| Panel URL | URL panel Victory |
| Username | Username login panel |
| Password | Password login panel |

---

## 7. Menjalankan Bot

### Dari Panel

1. Buka tab provider (NUKE/PAY4D/VICTORY)
2. Klik tombol **Start** di sebelah akun yang ingin dijalankan
3. Atau klik **Start All** untuk menjalankan semua akun aktif
4. Lihat status dan log di bagian bawah

### Status Bot

| Status | Artinya |
|---|---|
| `idle` | Bot belum dijalankan |
| `starting` | Bot sedang memulai browser |
| `logging_in` | Bot sedang login ke panel |
| `waiting_otp` | Menunggu input OTP (NUKE only) |
| `running` | Bot aktif dan siap menerima perintah |
| `checking_nto` | Sedang menjalankan NTO check |
| `error` | Terjadi error (lihat log untuk detail) |

### Submit OTP (NUKE)

Ketika status `waiting_otp`:
1. Lihat kode OTP dari panel NUKE
2. Masukkan di field OTP pada panel NTO BOT
3. Klik **Submit OTP**
4. Bot akan melanjutkan login

---

## 8. Menggunakan Telegram Command

Setelah Telegram Listener aktif dan bot sedang running, kirim perintah di chat/grup Telegram.

### Format Command

```
NamaAkun GAME NTO username1,username2 DD-MM-YYYY:DD-MM-YYYY
```

### Contoh

```
CAPTAIN77 SLOT NTO player123,player456 01-03-2026:04-03-2026
```

Artinya:
- **CAPTAIN77** — nama akun (sesuai yang ditambahkan di panel)
- **SLOT** — kategori game
- **NTO** — keyword wajib
- **player123,player456** — username yang dicek (pisahkan dengan koma)
- **01-03-2026:04-03-2026** — rentang tanggal (dari:sampai)

### Format Alternatif (Multi-line)

```
CAPTAIN77 SLOT NTO
player123
player456
player789
01-03-2026:04-03-2026
```

### Kategori Game

| Keyword | NUKE | PAY4D | VICTORY |
|---|---|---|---|
| `SLOT` | Slot Games | Slots | Semua (diabaikan) |
| `SPORTS` | Sports | Sport | Semua (diabaikan) |
| `CASINO` | Live Casino | Live Casino | Semua (diabaikan) |
| `GAMES` | Games | Togel | Semua (diabaikan) |

### Contoh Respons Bot

```
NTO Check Results for CAPTAIN77
Game: SLOT | Date: 01-03-2026 s/d 04-03-2026

player123: -500,000
player456: +1,200,000

Total: +700,000
```

Bot juga akan mengirimkan file **Excel (.xlsx)** dengan detail lengkap.

### Format Tanggal

Gunakan `s/d` atau `:` sebagai pemisah tanggal:

```
01-03-2026:04-03-2026
01-03-2026 s/d 04-03-2026
```

Format tanggal: `DD-MM-YYYY`

---

## 9. Troubleshooting

### Bot tidak merespons di Telegram

1. Pastikan **Telegram Listener** status **Running** di Settings
2. Pastikan **Bot Token** dan **Chat ID** sudah benar
3. Pastikan bot sudah ditambahkan ke grup
4. Pastikan **Group Privacy** sudah di-OFF di BotFather

### Login PAY4D gagal "Captcha unsolvable"

1. Pastikan **2Captcha API Key** sudah benar di Settings
2. Cek saldo 2Captcha (harus > $0)
3. Coba lagi — kadang captcha memang sulit dibaca

### Error 500 di Dashboard

1. Pastikan database sudah di-setup: `cd SERVER && npx prisma db push`
2. Restart server

### Browser tidak muncul / muncul padahal headless ON

1. Buka **Settings** di panel
2. Toggle **Headless Mode** sesuai keinginan
3. **Restart bot** (Stop lalu Start lagi) — setting berlaku saat start

### OTP NUKE timeout

1. OTP harus dimasukkan sebelum expired
2. Jika terlalu lama, **Stop** lalu **Start** ulang bot
3. Masukkan OTP segera setelah status berubah ke `waiting_otp`

### Server tidak bisa diakses

1. Pastikan server jalan (double-click `ntobot.exe` atau shortcut Desktop)
2. Buka `http://localhost:6969` di browser
3. Jika port 6969 sudah dipakai, jalankan `stop.bat` lalu coba lagi

### Captcha terlalu mahal

- Harga normal: ~$0.001-0.003 per solve
- Cek **Captcha History** di Settings untuk monitoring biaya
- Jika terlalu sering solve gagal, captcha image mungkin berubah format

---

## Ringkasan Setting yang Diperlukan

| Setting | Wajib Untuk | Cara Dapat |
|---|---|---|
| Telegram Bot Token | Semua provider | BotFather (@BotFather) |
| Telegram Chat ID | Semua provider | @userinfobot atau @RawDataBot |
| 2Captcha API Key | PAY4D saja | 2captcha.com |
| Panel URL | Semua provider | Dari operator/admin panel |
| Username & Password | Semua provider | Dari operator/admin panel |
| PIN Code | PAY4D saja | Dari operator/admin panel |
