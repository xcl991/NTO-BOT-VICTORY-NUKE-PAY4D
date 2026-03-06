# NTO BOT - Multi-Provider Automation Dashboard

Automation dashboard for managing multiple provider accounts (NUKE, PAY4D, VICTORY) with NTO checking, Telegram bot integration, and one-click Windows installer.

## Features

- **Multi-Provider Support** — NUKE, PAY4D, and VICTORY panels
- **Browser Automation** — Playwright-based login and NTO scraping with headless mode support
- **Telegram Bot** — Send NTO commands via Telegram, receive results + Excel reports
- **Real-time Dashboard** — WebSocket-powered live status updates, bot logs, and activity feed
- **2Captcha Integration** — Automatic captcha solving for PAY4D with cost tracking
- **Excel Export** — Export NTO results to `.xlsx` with ExcelJS
- **One-Click Installer** — Professional Windows installer (Inno Setup) with auto-setup

## Quick Start

### Option 1: Windows Installer (Recommended)

1. Download `NTO-BOT-Setup.exe` from [Releases](../../releases)
2. Run the installer — it automatically:
   - Installs Node.js 22 LTS (if not present)
   - Installs all npm dependencies
   - Sets up the SQLite database
   - Installs Chromium for browser automation
   - Creates a desktop shortcut
3. Double-click **NTO BOT** on your Desktop
4. Browser opens to `http://localhost:6969`

### Option 2: Manual Setup

```bash
# Clone the repository
git clone https://github.com/xcl991/NTO-BOT-VICTORY-NUKE-PAY4D.git
cd NTO-BOT-VICTORY-NUKE-PAY4D

# Install dependencies
cd SERVER
npm install

# Setup database
npx prisma generate
npx prisma db push

# Install Chromium
npx playwright install chromium

# Start the server
npx tsx src/index.ts
```

Open `http://localhost:6969` in your browser.

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js 22.x LTS |
| Backend | Express.js + TypeScript |
| Database | SQLite via Prisma ORM |
| Frontend | Vanilla HTML/JS + TailwindCSS + Chart.js |
| Automation | Playwright (Chromium) |
| Captcha | 2Captcha API |
| Real-time | WebSocket (ws) |
| Telegram | Long-polling bot + send API |
| Installer | Inno Setup 6 + C# launcher |

## Project Structure

```
SERVER/              Express backend (TypeScript)
  src/
    index.ts         Entry point (Express + WebSocket + static serving)
    routes/          API routes (accounts, bot, dashboard, nto, settings)
    automation/      Browser automation engine
      flows/         Login + NTO check flows per provider
      selectors/     DOM selectors per provider
      utils/         Captcha solver, Telegram, retry helpers
  prisma/
    schema.prisma    Database schema (6 models)

panel/               Frontend SPA
  index.html         Single HTML with section navigation
  assets/js/         API client + app logic

installer/           Windows installer
  setup.iss          Inno Setup script
  compile.bat        Build NTO-BOT-Setup.exe
  start.vbs          Silent launcher
  start.bat          Debug launcher (visible console)
  stop.bat           Kill server
```

## Providers

| Provider | Login | NTO Check | Captcha |
|---|---|---|---|
| **NUKE** | Username + Password + OTP | Report scraping with pagination | No |
| **PAY4D** | Username + Password + Captcha + PIN | Win Lose All CSV download | 2Captcha |
| **VICTORY** | Username + Password | Report scraping | No |

## Telegram Bot

Send NTO check commands via Telegram:

```
AccountName SLOT NTO username1,username2 01-03-2026:04-03-2026
```

The bot will:
1. Auto-start the account if not running
2. Login to the provider panel
3. Run the NTO check for specified usernames and date range
4. Reply with results + Excel file attachment

### Game Categories
`SLOT`, `SPORTS`, `CASINO`, `GAMES`

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET/POST/PUT/DELETE | `/api/accounts` | Account CRUD |
| POST | `/api/bot/start` | Start bot for account |
| POST | `/api/bot/stop` | Stop bot for account |
| POST | `/api/bot/start-all` | Start all active accounts |
| GET | `/api/dashboard/stats` | Dashboard statistics |
| GET | `/api/dashboard/activity` | Recent activity log |
| POST | `/api/nto/check` | Run NTO check |
| POST | `/api/nto/export` | Export NTO to Excel |
| POST | `/api/nto/telegram` | Send NTO via Telegram |
| GET/PUT | `/api/settings/:key` | Read/update settings |

## Configuration

Settings are stored in the database and configurable via the Settings panel:

| Setting | Default | Description |
|---|---|---|
| `browser.headless` | `false` | Run browser in headless mode (no visible window) |
| `browser.slowMo` | `100` | Delay between browser actions (ms) |
| `telegram.botToken` | — | Telegram bot token |
| `telegram.chatId` | — | Telegram chat ID for notifications |
| `captcha_api_key` | — | 2Captcha API key (required for PAY4D) |

## Building the Installer

Requirements: [Inno Setup 6](https://jrsoftware.org/isdl.php)

```bash
cd installer
compile.bat
```

This will:
1. Convert the logo JPG to ICO
2. Compile `setup.iss` into `output/NTO-BOT-Setup.exe`

## Environment Variables

Create `.env` in both root and `SERVER/` directories:

```env
PORT=6969
NODE_ENV=development
LOG_LEVEL=info
DATABASE_URL=file:../../data/bot-nto.db
ENCRYPTION_KEY=change-this-to-a-random-32-byte-key
```

## License

Private — All rights reserved.
