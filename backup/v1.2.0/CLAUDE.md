# BOT NTO - Multi-Provider Automation Dashboard

## Tech Stack
- **Runtime:** Node.js 22.x LTS
- **Backend:** Express.js + TypeScript (port 6969)
- **Database:** SQLite via Prisma ORM
- **Frontend:** Vanilla HTML/JS + TailwindCSS (CDN) + FontAwesome + Chart.js
- **Browser Automation:** Playwright (Chromium, persistent profiles)
- **Captcha Solving:** 2Captcha API (for PAY4D image captcha)
- **TOTP:** otpauth (Google Authenticator auto-OTP for NUKE)
- **Real-time:** WebSocket (ws library) via `(global as any).wsBroadcast`
- **Logging:** Winston with daily file rotation
- **Validation:** Zod schemas on all API inputs
- **Excel Export:** ExcelJS
- **Telegram:** Long-polling bot listener + send message/document/photo
- **Installer:** Inno Setup 6 (.exe) + botbopanel.exe / ntobot.exe (C# compiled launcher)

## Project Structure
```
├── SERVER/              # Express backend (TypeScript) — NOTE: uppercase folder
│   ├── prisma/
│   │   └── schema.prisma
│   ├── src/
│   │   ├── index.ts           # Entry: Express + WebSocket + static panel serving
│   │   ├── routes/
│   │   │   ├── accounts.ts    # CRUD /api/accounts
│   │   │   ├── bot.ts         # /api/bot (start, stop, start-all, stop-all, submit-otp, screenshot)
│   │   │   ├── dashboard.ts   # /api/dashboard (stats, activity)
│   │   │   ├── nto.ts         # /api/nto (list, latest, stats, check, export, telegram, download)
│   │   │   └── settings.ts    # /api/settings + telegram listener control + captcha balance/history
│   │   ├── automation/
│   │   │   ├── index.ts             # AutomationService orchestrator class
│   │   │   ├── browser/
│   │   │   │   └── context-manager.ts  # Playwright persistent browser context manager
│   │   │   ├── flows/
│   │   │   │   ├── login-flow.ts                # NUKE login (username/password/OTP agreement/auto-OTP with twoFaSecret)
│   │   │   │   ├── nto-check-flow.ts            # NUKE NTO scraping (report/overall, pagination)
│   │   │   │   ├── nuke-tarikdb-check-flow.ts   # NUKE TARIK DB (member management page scraping)
│   │   │   │   ├── pay4d-login-flow.ts          # PAY4D login (captcha + cross-origin PIN iframe)
│   │   │   │   ├── pay4d-nto-check-flow.ts      # PAY4D Win Lose All (multiselect, CSV download+parse)
│   │   │   │   ├── victory-login-flow.ts        # VICTORY login (username/password, MUI)
│   │   │   │   ├── victory-nto-check-flow.ts    # VICTORY NTO (2-tab: by-player → detail → sum valid_bet by category)
│   │   │   │   └── victory-tarikdb-check-flow.ts # VICTORY TARIK DB (contact-data page scraping)
│   │   │   ├── selectors/
│   │   │   │   ├── nuke-selectors.ts      # Ant Design component selectors (login, OTP 6-digit, report, member)
│   │   │   │   ├── pay4d-selectors.ts     # Bootstrap component selectors
│   │   │   │   └── victory-selectors.ts   # MUI component selectors (report + detail + contact-data page)
│   │   │   └── utils/
│   │   │       ├── captcha-solver.ts    # 2Captcha submit + poll + usage tracking
│   │   │       ├── excel-export.ts      # ExcelJS NTO + TARIK DB report export
│   │   │       ├── retry-handler.ts     # fillWithFallback, clickWithFallback, withRetry
│   │   │       ├── tarikdb-scheduler.ts # TARIK DB H+1 daily scheduler (auto-check yesterday)
│   │   │       ├── totp.ts             # Time-corrected TOTP generator (auto-syncs clock from server)
│   │   │       ├── telegram.ts          # Telegram API (send message/document/photo)
│   │   │       └── telegram-listener.ts # Long-polling listener, NTO + TARIK DB command parsers, auto-start bot
│   │   └── utils/
│   │       ├── errors.ts      # ApiError, ValidationError, asyncHandler, errorHandler
│   │       ├── logger.ts      # Winston + daily rotate (data/logs/)
│   │       ├── prisma.ts      # PrismaClient singleton
│   │       └── validation.ts  # Zod schemas + validate middleware
│   ├── eng.traineddata        # Tesseract OCR data (legacy, now uses 2Captcha)
│   ├── package.json
│   └── tsconfig.json
├── panel/               # Frontend SPA (static, served by Express)
│   ├── index.html       # Single HTML with section-based navigation
│   └── assets/
│       ├── css/mobile.css   # Mobile responsive sidebar
│       └── js/
│           ├── api.js       # API client + WebSocket client class
│           └── app.js       # Main SPA logic (~1050 lines)
├── installer/           # Windows installer (Inno Setup)
│   ├── setup.iss              # Inno Setup script — NTO BOT variant
│   ├── setup-botbopanel.iss   # Inno Setup script — BOT BO PANEL variant
│   ├── compile.bat            # Build NTO-BOT-Setup.exe
│   ├── compile-botbopanel.bat # Build BOTBOPANEL.exe
│   ├── install.bat            # Standalone batch installer (no Inno Setup needed)
│   ├── start.vbs        # Silent launcher (no CMD window)
│   ├── start.bat        # Debug launcher (visible CMD)
│   ├── stop.bat         # Kill server on port 6969
│   ├── ff7acb18-*.jpg   # NTO BOT logo source image
│   ├── BOT-BO-PANEL.png # BOT BO PANEL logo source image
│   ├── output/          # Built installer .exe files (gitignored)
│   ├── ntobot.exe       # NTO BOT C# launcher (gitignored)
│   ├── botbopanel.exe   # BOT BO PANEL C# launcher (gitignored)
│   ├── nto-bot.ico      # NTO BOT icon (gitignored)
│   └── botbopanel.ico   # BOT BO PANEL icon (gitignored)
├── data/                # Runtime data (gitignored)
│   ├── bot-nto.db       # SQLite database
│   ├── logs/            # Winston daily logs
│   ├── exports/         # Excel exports (.xlsx)
│   ├── downloads/       # PAY4D CSV downloads
│   ├── screenshots/     # Browser screenshots
│   └── captcha-debug/   # Captcha processing debug images
├── profiles/            # Playwright persistent browser sessions (gitignored)
├── .env                 # Root env (mirrors SERVER/.env)
└── package.json         # Root monorepo (proxy scripts to SERVER/)
```

## Commands
- `cd SERVER && npx tsx src/index.ts` - Start dev server (actual working command)
- `cd SERVER && npx prisma db push` - Push schema to SQLite
- `cd SERVER && npx prisma generate` - Generate Prisma client
- `cd SERVER && npx prisma studio` - Open Prisma Studio
- Root `npm run dev` also works (Windows only, case-insensitive `cd server`)

## Installer
- **Build (NTO BOT):** Install [Inno Setup 6](https://jrsoftware.org/isdl.php), then run `installer\compile.bat` → `NTO-BOT-Setup.exe`
- **Build (BOT BO PANEL):** Run `installer\compile-botbopanel.bat` → `BOTBOPANEL.exe`
- **What it does:** Checks/installs Node.js → copies files → npm install → prisma setup → playwright chromium → desktop shortcut
- **Launcher:** `botbopanel.exe` / `ntobot.exe` (C# compiled) — starts server hidden + opens browser
- **NUKE** checks saved session via `/homepage` before login (skip login+OTP if still valid)
- **PAY4D & VICTORY** always fresh login
- **Headless mode** respects `browser.headless` setting from database
- **Telegram listener** auto-starts on server boot if bot token + chat ID configured
- **Windows Startup** shortcut created by installer for auto-launch on login

## Database Models (Prisma)
- **Account** - Provider accounts (provider, feature, name, panelUrl, username, password, pinCode, twoFaSecret, status, lastNto, lastError, isActive)
- **BotSession** - Bot run sessions (accountId, provider, status, startedAt, stoppedAt)
- **NtoResult** - NTO check results (accountId, provider, value, rawData as JSON)
- **ActivityLog** - Action logs (action, provider, accountId, details, status)
- **Setting** - Key-value config (key unique, value, type: string/number/boolean/json)
- **CaptchaUsage** - 2Captcha cost tracking (balanceBefore, balanceAfter, cost, result, status)

## Providers
- **NUKE** - nukepanel.com (Ant Design UI). Fully implemented: session check via `/homepage` + login + auto-OTP (if twoFaSecret set) + NTO report scraping + TARIK DB member scraping. All NUKE accounts check saved session before login.
- **PAY4D** - pay4d panel (Bootstrap UI). Fully implemented: captcha login + PIN iframe + Win Lose All CSV
- **VICTORY** - victory panel (MUI React SPA). Fully implemented: login + 2-tab NTO (by-player → detail page → filter by game category → sum valid_bet_amount) + TARIK DB (contact-data page scraping by Registered Date)

## API Routes
- `GET /api` - System info
- `GET /api/health` - Health check
- `GET/POST/PUT/DELETE /api/accounts` - Account CRUD + `POST /api/accounts/bulk-delete`
- `POST /api/bot/start|stop|start-all|stop-all|submit-otp` + `GET /api/bot/status|screenshot/:id`
- `GET /api/nto` + `/latest` + `/stats` + `/result/:id` + `POST /api/nto/check|export|telegram` + `GET /api/nto/download/:filename`
- `GET/PUT /api/settings/:key` + telegram listener control + captcha balance/history
- `POST /api/settings/tarikdb-scheduler/start|stop|run-now` + `GET /api/settings/tarikdb-scheduler/status`

## WebSocket Events (broadcast via wsBroadcast)
- `BOT_STATUS` - Account status change (accountId, provider, status, name)
- `BOT_LOG` - Bot log message (accountId, provider, message, level)
- `ACCOUNT_CREATED` / `ACCOUNT_DELETED` - Account changes

## Telegram Bot Integration
- Unified long-polling listener: `telegramListener` (handles both NTO + TARIK DB commands)
- Single bot token: `notification.telegramBotToken`
- Dual group support:
  - `notification.telegramChatId` — NTO group (NTO commands only)
  - `notification.telegramChatIdTarikDb` — TARIK DB group (TARIK DB commands only, optional — if empty, all commands accepted in NTO group)
- **NTO command format:** `AccountName GAME NTO username1,username2 DD-MM-YYYY:DD-MM-YYYY`
  - Multi-line format also supported (usernames on separate lines)
  - Game categories: SLOT, SPORTS, CASINO, GAMES (mapped to provider-specific labels)
- **TARIK DB command format (different from NTO — no game category):**
  - Date range (targeted): `Captain77 TARIK DB\nesia77\n01-03-2026:05-03-2026`
  - Date range (all members): `Captain77 TARIK DB\n\n01-03-2026:05-03-2026`
  - Old user (no dates): `Captain77 TARIK DB\nID1\nID2\nID3`
- **Admin approval** for TARIK DB: non-admin users get inline keyboard (Approve/Cancel), admin identified by `notification.adminUserIds` (json array of Telegram user IDs). Empty = all users are admin.
- Auto-starts bot if not running, runs check, replies with results + Excel

## Architecture Notes
- Section-based SPA navigation (show/hide divs, rendered by app.js)
- NUKE: session check via `/homepage` (reuse saved profile if valid, else fresh login+OTP). Auto-OTP via `otpauth` if account has `twoFaSecret` (uses `pressSequentially` on 6 individual input fields)
- NUKE mid-session OTP: member page (`/management/member`) triggers separate 2FA/OTP modal after login. Uses same `pressSequentially` approach with retry up to 3 attempts
- Browser automation stealth: `navigator.webdriver` overridden to `false` via `addInitScript` + `--disable-blink-features=AutomationControlled` launch arg
- PAY4D & VICTORY: always fresh login (captcha/PIN required)
- Victory NTO: 2-tab flow (click username → new tab with provider breakdown → filter by game category → sum valid_bet_amount)
- Victory browser viewport set to 2560x1440 for better element visibility
- Browser headless mode controlled by `browser.headless` database setting
- Telegram listener auto-starts on boot when bot token + chat ID are configured in DB
- Panel Settings has Telegram Listener toggle with live status indicator
- `(global as any).wsBroadcast` used for WebSocket broadcasting across modules
- Automation flows use fallback selector patterns (primary + fallback array)
- PAY4D captcha solved via 2Captcha API, cost tracked in CaptchaUsage table
- PAY4D PIN entered via cross-origin iframe virtual keypad (auth.dotflyby.com)
- Broken adminarea navigation blocked via Playwright route interception
- NUKE TARIK DB: scrapes `/management/member` page filtered by createdDate range + optional `username.contains`, extracts Username/Wallet/Phone/Status/JoinDate columns
- NUKE TARIK DB Status detection: green color `rgb(3, 170, 20)` or `#03aa14` on ID cell → "REGIS + DEPO", else → "REGIS ONLY"
- TARIK DB results sorted: REGIS+DEPO first, then REGIS ONLY (matching Python reference)
- Victory TARIK DB: 2-cycle scraping on `/player/contact-data` — Cycle 1: `deposit_status=false` → REGIS ONLY, Cycle 2: `deposit_status=true` → REGIS + DEPO, merged (DEPO first)
- Account `feature` field (`NTO` or `TARIKDB`) controls which Telegram listener processes commands for that account
- TARIK DB Scheduler: auto-check H+1 (yesterday) daily at configurable time
  - Settings: `tarikdb.scheduler.enabled` (boolean), `tarikdb.scheduler.time` (HH:MM), `tarikdb.scheduler.accountIds` (json array)
  - 60-second interval checks if current time matches scheduled time, `lastRunDate` prevents re-runs same day
  - Processes selected TARIKDB accounts sequentially: start bot → login → check → export Excel → send Telegram → stop bot
  - Sends per-account results + summary message to Telegram
  - Saves last run info to `tarikdb.scheduler.lastRun` setting (json)
  - `runNow()` for manual trigger via panel or API
  - Auto-starts on server boot if `tarikdb.scheduler.enabled` is `true`
  - Panel UI: dedicated "Scheduler" page under TARIK DB sidebar (not in Settings)
  - Account picker with search bar, select all/none, scrollable list with counter

## Known Issues
- **NUKE mid-session OTP (RESOLVED v1.1.0):** Was returning "Otp Token Invalid". Root cause: **PC clock drift** (e.g. 50 seconds ahead) caused TOTP codes to be generated from wrong time window. Fix: `totp.ts` utility auto-syncs time from HTTP server Date headers (Google/Cloudflare) at startup, applies offset to all TOTP generation. Form filling uses `valueTracker-reset` strategy (resets React's internal `_valueTracker` then sets value via native setter + dispatches input/change events).
- Passwords/PINs stored plaintext in SQLite (ENCRYPTION_KEY exists in .env but unused)
- Root tsconfig.json references non-existent folders (shared/, NUKE/, VICTORY/, PAY4D/)
- Telegram listener auto-closes browser after each command (wastes 2Captcha credits on PAY4D)
- OTP waiting_otp status has no timeout (browser stays open indefinitely)

## Research / Planned

### v1.2.0 (Implemented)
- See `RESEARCH-V1.2.0-TARIKDB-APPROVAL-TARGETING.md` for full research with verified line numbers
- **TARIK DB Admin Approval** — non-admin user di group Telegram harus dapat approval admin sebelum bot menjalankan TARIK DB
  - Telegram inline keyboard (Approve/Cancel buttons) via `sendMessage` + `reply_markup`
  - `callback_query` handling di listener (`answerCallbackQuery`, `editMessageText`)
  - `allowed_updates` L878: add `'callback_query'` to existing `['message']`
  - Admin identified by Telegram user ID: `notification.adminUserIds` (json array in DB Setting)
  - Pending requests stored in-memory Map (requestId = `Date.now().toString(36)`)
  - Admin kirim command → langsung execute (tanpa approval)
  - Non-admin kirim command → kirim approval request → tunggu admin klik Approve/Cancel
  - Empty adminUserIds = semua user dianggap admin (no approval needed)
  - New functions in `telegram.ts`: `sendMessageWithKeyboard`, `answerCallbackQuery`, `editMessageText`
  - callback_data max 64 bytes, format: `approve_tdb_{requestId}` / `cancel_tdb_{requestId}`
- **Old User Targeting** — TARIK DB tanpa date range, cari user by username saja
  - New Telegram command format (tanpa baris tanggal):
    ```
    HOLYPLAY TARIK DB
    ID1
    ID2
    ID3
    ```
  - Parser update at `parseTarikDbCommand` L202: detect date line presence → `mode: 'date_range' | 'old_user'`
  - NUKE: URL without `createdDate` params CONFIRMED WORKING (just `username.contains=xxx`)
  - NUKE URL change at L61-66: wrap date params in `if (dateStart && dateEnd)`
  - VICTORY: dates unconditional at L114-118 — must wrap in conditional
  - Multi-username loop: per username di-query satu-satu, results digabung
  - `dateStart`/`dateEnd` jadi optional di `checkTarikDb()` L398 dan semua flow
  - NOT FOUND status for usernames with no results
  - Backward compatible: format lama (dengan tanggal) tetap didukung 100%

## Changelog

### v1.2.0
- **TARIK DB Admin Approval** — non-admin users need admin approval before TARIK DB runs
  - New Telegram inline keyboard with Approve/Cancel buttons
  - `callback_query` handling in listener (`handleCallbackQuery` method)
  - `allowed_updates` updated to `['message', 'callback_query']`
  - Admin identified by Telegram user ID: `notification.adminUserIds` (json array in DB Setting)
  - In-memory `pendingRequests` Map (keyed by `Date.now().toString(36)`)
  - Admin sends command → direct execute; non-admin → approval request
  - Empty adminUserIds = all users treated as admin (no approval)
  - Private chat = always direct execute
  - New functions in `telegram.ts`: `sendTelegramMessageWithKeyboard`, `answerCallbackQuery`, `editMessageText`
- **Old User Targeting** — TARIK DB without date range, search by username only
  - New Telegram command format: `AccountName TARIK DB\nID1\nID2\nID3` (no date line)
  - `parseTarikDbCommand` detects date line presence → `mode: 'date_range' | 'old_user'`
  - NUKE: URL without `createdDate` params (just `username.contains`)
  - VICTORY: skip date pickers when no dates provided
  - Multi-username loop: each username queried separately, results merged
  - NOT FOUND status for usernames with no results
  - Backward compatible: existing date-range format still works 100%
- **Dual Telegram Groups** — separate chat IDs for NTO and TARIK DB
  - `notification.telegramChatId` = NTO group (existing)
  - `notification.telegramChatIdTarikDb` = TARIK DB group (new, optional)
  - Bot monitors both groups, routes commands to correct group
  - If TARIK DB chat ID not set, backward compatible (all commands in NTO group)
  - TARIK DB scheduler sends results to TARIK DB group
- **Panel Settings**: Admin User IDs + TARIK DB Chat ID fields

### v1.1.0
- **Time-corrected TOTP generation** — CRITICAL FIX:
  - New file: `totp.ts` — auto-syncs clock from HTTP server Date headers (Google/Cloudflare/Microsoft) at startup
  - `generateTOTP(secret)` uses corrected timestamp (`Date.now() + clockOffsetMs`)
  - Fixes "Otp Token Invalid" caused by PC clock drift (even 30+ seconds causes TOTP window mismatch)
  - Clock offset logged at startup: `Clock offset synced: -50s (from https://www.google.com)`
- **NUKE NTO now supports mid-session 2FA OTP** (same as TARIK DB):
  - `nto-check-flow.ts` handles OTP modal on `/report/overall` page
  - `handleMidSessionOtp` exported from `nuke-tarikdb-check-flow.ts` for shared use
  - After OTP accepted, re-navigates to report page to ensure filters apply
  - `AutomationService.checkNto` passes `twoFaSecret` to NUKE NTO flow
- **OTP form filling** — cascade of 4 strategies (stops at first success):
  1. `valueTracker-reset` — resets React `_valueTracker`, native setter + input/change events
  2. `clipboard-paste` — Ctrl+V paste (for components with onPaste handler)
  3. `direct-cdp` — raw CDP `Input.dispatchKeyEvent` with all properties
  4. `pressSequentially` — Playwright Locator keyboard typing
  - Submit button enabled check after each strategy to verify React/rc-form state updated
  - Retry up to 3 attempts with page navigate between attempts
- **Victory TARIK DB**: scrape `/player/contact-data` page (MUI) with 2-cycle deposit status check
  - New file: `victory-tarikdb-check-flow.ts` — 2-cycle approach matching Python reference
  - Cycle 1: `deposit_status=false` → scrape → "REGIS ONLY"
  - Cycle 2: `deposit_status=true` → scrape → "REGIS + DEPO"
  - Merge: REGIS+DEPO first, then REGIS ONLY (sorted like NUKE)
  - Selectors: `depositStatusSelect`, `depositStatusTrue/False`, `filterDateBySelect`, `registeredDateOption`
  - Scrapes Username + Phone, page size 1000, pagination via Next button
  - Reuses `setMuiDatePicker`/`parseDateParts` from `victory-nto-check-flow.ts` (now exported)
  - `AutomationService.checkTarikDb` routes VICTORY provider to `victoryTarikDbCheckFlow`
- **Browser stealth**:
  - `channel: 'chrome'` — uses system-installed Google Chrome (real TLS fingerprint, correct sec-ch-ua)
  - `navigator.webdriver` overridden to `false` via `context.addInitScript()`
- **Installer**: added BOT BO PANEL variant
  - `setup-botbopanel.iss` → `BOTBOPANEL.exe` (separate from NTO-BOT-Setup.exe)
  - C# launcher `botbopanel.exe`, icon from `BOT-BO-PANEL.png`
  - `compile-botbopanel.bat` — auto-creates ICO, compiles C# launcher, runs ISCC

### v1.0.3
- TARIK DB Scheduler: auto-check H+1 (yesterday) daily at configurable time
  - New file: `tarikdb-scheduler.ts` — `TarikDbScheduler` class with 60s polling interval
  - Settings stored in Setting table: `tarikdb.scheduler.enabled`, `tarikdb.scheduler.time`, `tarikdb.scheduler.accountIds`
  - Sequential account processing: start bot → login → TARIK DB check → Excel export → Telegram send → stop bot
  - Per-account results + summary sent to Telegram chat
  - Last run info saved to `tarikdb.scheduler.lastRun` (json with timestamp, date, results, summary)
  - Manual trigger via "Run Sekarang" button or `POST /api/settings/tarikdb-scheduler/run-now`
  - Auto-starts on server boot if enabled; stops on graceful shutdown
  - API routes: `POST .../start|stop|run-now`, `GET .../status`
- Panel: dedicated "Scheduler" page under TARIK DB sidebar group
  - Enable toggle, time picker (24h), scrollable account picker
  - Account picker: search bar, select all/none buttons, checked counter (X/Y dipilih)
  - Live status indicator (running/stopped/executing), start/stop toggle
  - "Run Sekarang (H+1)" manual trigger button
  - Last run history display, real-time log panel via WebSocket
- Exported `formatTarikDbResultMessage()` and `waitForBotReady()` from `telegram-listener.ts` for reuse

### v1.0.2
- NUKE TARIK DB: new feature to scrape member management page (Username, Wallet, Phone, Status, JoinDate) filtered by join date range
  - Targeted mode: `&username.contains=xxx` for specific username search
  - General mode: all members in date range, paginated (size=100, up to 10 pages)
  - Status detection: green color `rgb(3,170,20)` / `#03aa14` on ID cell → REGIS+DEPO, else REGIS ONLY
  - Results sorted: REGIS+DEPO first, then REGIS ONLY
  - Telegram reply shows REGIS+DEPO / REGIS ONLY counts + Username|Phone|Status table
  - Excel export: `TARIKDB_NUKE_{timestamp}.xlsx` with 5 columns (Username, Wallet, Phone, Status, JoinDate), status color-coded
- NUKE auto-OTP: accounts with `twoFaSecret` auto-fill 6-digit Google Authenticator modal during login (using `otpauth` library)
  - Supports both 6-digit individual inputs and single-input OTP styles
  - Manual OTP submission (`nukeSubmitOtp`) also updated to handle both styles
- Telegram TARIK DB listener: separate command format (no game category, optional username)
  - Targeted: `Captain77 TARIK DB\nesia77\n01-03-2026:05-03-2026`
  - General: `Captain77 TARIK DB\n\n01-03-2026:05-03-2026`
  - Auto-starts bot, scrapes, sends Telegram reply + Excel attachment
- Replaced `otplib` with `otpauth` (simpler API, `new OTPAuth.TOTP({ secret }).generate()`)

### v1.0.1
- Victory NTO: rewritten with 2-tab flow (click username → detail page → filter by game category → sum valid_bet_amount)
- Victory now supports game category filtering (SLOT, CASINO, SPORTS, GAMES)
- Victory browser viewport set to 2560x1440 for better visibility
- NUKE session check: reuse saved login via `/homepage` check (skip OTP if still valid)
- Telegram listener auto-starts on server boot when configured
- Panel Settings: added Telegram Listener toggle with live status indicator
- Installer: added Windows Startup shortcut for auto-launch on login

### v1.0.0
- Initial release with NUKE, PAY4D, VICTORY support
- Telegram bot integration with NTO commands
- 2Captcha integration for PAY4D
- Inno Setup Windows installer with ntobot.exe launcher
