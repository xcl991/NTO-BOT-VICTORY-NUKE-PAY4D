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
│   │   │   ├── settings.ts    # /api/settings + telegram listener control + captcha balance/history
│   │   │   └── updater.ts     # /api/updater (check, download, apply, upload)
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
│   │   │   │   ├── pay4d-tarikdb-check-flow.ts  # PAY4D TARIK DB (All User page → profile click → phone extraction)
│   │   │   │   ├── victory-login-flow.ts        # VICTORY login (username/password, MUI)
│   │   │   │   ├── victory-nto-check-flow.ts    # VICTORY NTO (2-tab: by-player → detail → sum valid_bet by category)
│   │   │   │   ├── victory-tarikdb-check-flow.ts # VICTORY TARIK DB (contact-data page scraping)
│   │   │   │   ├── victory-livereport-flow.ts   # VICTORY Live Report (by-referral + by-company profit/loss scraping)
│   │   │   │   ├── cuttly-login-flow.ts         # CUTT.LY login (email/password + reCAPTCHA v3) + session check
│   │   │   │   ├── cuttly-gantinomor-flow.ts    # CUTT.LY GANTI NOMOR (search → change all matching shortlinks + pagination)
│   │   │   │   └── nuke-gantinomor-flow.ts      # NUKE GANTI NOMOR (identity page WA number change)
│   │   │   ├── selectors/
│   │   │   │   ├── nuke-selectors.ts      # Ant Design component selectors (login, OTP 6-digit, report, member, identity)
│   │   │   │   ├── pay4d-selectors.ts     # Bootstrap component selectors
│   │   │   │   ├── cuttly-selectors.ts    # CUTT.LY selectors (login, search results, change URL page)
│   │   │   │   └── victory-selectors.ts   # MUI component selectors (report + detail + contact-data page)
│   │   │   └── utils/
│   │   │       ├── captcha-solver.ts    # 2Captcha submit + poll + usage tracking
│   │   │       ├── excel-export.ts      # ExcelJS NTO + TARIK DB report export
│   │   │       ├── retry-handler.ts     # fillWithFallback, clickWithFallback, withRetry
│   │   │       ├── tarikdb-scheduler.ts # TARIK DB H+1 daily scheduler (auto-check yesterday)
│   │   │       ├── livereport-processor.ts # Live Report data processing, HTML table rendering, PNG export
│   │   │       ├── livereport-scheduler.ts # Live Report scheduler (hourly + daily/weekly/monthly recap)
│   │   │       ├── totp.ts             # Time-corrected TOTP generator (auto-syncs clock from server)
│   │   │       ├── telegram.ts          # Telegram API (send message/document/photo)
│   │   │       ├── telegram-listener.ts # Long-polling listener, NTO + TARIK DB command parsers, auto-start bot
│   │   │       └── gantinomor-listener.ts # Separate Telegram listener for GANTI NOMOR commands
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
│   ├── update.bat       # Manual update script (standalone)
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
│   ├── captcha-debug/   # Captcha processing debug images
│   └── updates/         # Auto-updater downloads and temp files
├── profiles/            # Playwright persistent browser sessions (gitignored)
├── build-update.bat     # Developer tool: package source into update ZIP
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
- **Account** - Provider accounts (provider, feature, name, panelUrl, username, password, pinCode, twoFaSecret, proxy, uplineUsername, cuttlyLinkCs, cuttlyLinkMst, status, lastNto, lastError, isActive)
- **BotSession** - Bot run sessions (accountId, provider, status, startedAt, stoppedAt)
- **NtoResult** - NTO check results (accountId, provider, value, rawData as JSON)
- **ActivityLog** - Action logs (action, provider, accountId, details, status)
- **Setting** - Key-value config (key unique, value, type: string/number/boolean/json)
- **CaptchaUsage** - 2Captcha cost tracking (balanceBefore, balanceAfter, cost, result, status)

## Providers
- **NUKE** - nukepanel.com (Ant Design UI). Fully implemented: session check via `/homepage` + login + auto-OTP (if twoFaSecret set) + NTO report scraping + TARIK DB member scraping + GANTI NOMOR (identity page WA number change). All NUKE accounts check saved session before login.
- **PAY4D** - pay4d panel (Bootstrap UI). Fully implemented: captcha login + PIN iframe + Win Lose All CSV + TARIK DB (All User page scraping)
- **VICTORY** - victory panel (MUI React SPA). Fully implemented: login + 2-tab NTO (by-player → detail page → filter by game category → sum valid_bet_amount) + TARIK DB (contact-data page scraping by Registered Date)
- **CUTTLY** - cutt.ly shortlink management. Fully implemented: email/password login (reCAPTCHA v3 invisible) + persistent session + GANTI NOMOR (search old phone → change all matching shortlinks across pagination)

## API Routes
- `GET /api` - System info
- `GET /api/health` - Health check
- `GET/POST/PUT/DELETE /api/accounts` - Account CRUD + `POST /api/accounts/bulk-delete`
- `POST /api/bot/start|stop|start-all|stop-all|submit-otp` + `GET /api/bot/status|screenshot/:id`
- `GET /api/nto` + `/latest` + `/stats` + `/result/:id` + `POST /api/nto/check|export|telegram` + `GET /api/nto/download/:filename`
- `GET/PUT /api/settings/:key` + telegram listener control + captcha balance/history
- `POST /api/settings/tarikdb-scheduler/start|stop|run-now` + `GET /api/settings/tarikdb-scheduler/status`
- `POST /api/settings/livereport-scheduler/start|stop|run-now` + `GET /api/settings/livereport-scheduler/status`
- `POST /api/settings/gantinomor-listener/start|stop` + `GET /api/settings/gantinomor-listener/status`
- `GET /api/updater/check` + `POST /api/updater/download|apply|upload`

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
- **GANTI NOMOR** — separate Telegram bot + chat ID (`notification.telegramBotTokenGantiNomor` + `notification.telegramChatIdGantiNomor`)
  - Separate `GantiNomorTelegramListener` class in `gantinomor-listener.ts`
  - **CUTT.LY command:** `cutt.ly GANTI NOMOR\nold mst:62xxx\nnew mst:62yyy`
  - **NUKE command:** `Captain77 GANTI NOMOR\nold cs:62xxx\nnew cs:62yyy`
  - Supports `old cs/new cs` and/or `old mst/new mst` (minimal salah satu pair)
  - Multi-command: separator `---` untuk multiple commands dalam 1 pesan
  - CUTT.LY: batched (start browser once → all commands → stop once)
  - NUKE: per-account (start → process → stop per account)
  - Auto-starts bot if not running, auto-closes after done

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
- PAY4D TARIK DB: scrapes "All User" page (`switchMenu('menuAllUser')`) — no server-side date filter, scans rows client-side for matching Join Date
  - Phone NOT in table — must click profile button (`editProfilUsers`) → read `input.form-control.telpon` → click "Back to All Users"
  - Status: `credit > 0` → "REGIS + DEPO", else → "REGIS ONLY" (credit from table column 2)
  - Join Date in column 4 as `input[type='text'][readonly]`, format "DD Mon YYYY" (e.g. "03 Mar 2026")
  - Pagination via numbered `<li class="page-item" onclick="menuUsers(N)">` pages (no Next/Prev button)
  - ~6 seconds per user (click profile → read → back), slower than NUKE/Victory
- Account `feature` field (`NTO`, `TARIKDB`, `LIVEREPORT`, or `GANTINOMOR`) controls which Telegram listener processes commands for that account
- Live Report uses separate Telegram bot token (`notification.telegramBotTokenLiveReport`), independent from NTO/TARIK DB
- Live Report `uplineUsername` supports comma-separated values — loops per upline with 3s delay
- Live Report username parsing is prefix-dynamic: any upline prefix works (not just `teammkt`/`teamreborn`)
- Live Report scrapes both by-referral (per upline) and by-company (once per account) — company sent as separate PNG
- Live Report label: if username has no member letter suffix (e.g., `superalx1`), uses original username as label; team total rows skipped for single-member teams
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
- **OTP waiting_otp timeout (RESOLVED v1.6.0):** Auto-stop bot after 2 minutes if OTP not submitted
- **Pending approval TTL (RESOLVED v1.6.0):** Expired approval requests auto-cleaned after 10 minutes
- **Missing DEFAULT_SETTINGS (RESOLVED v1.6.0):** `adminUserIds` and `telegramChatIdTarikDb` now seeded
- Passwords/PINs stored plaintext in SQLite (ENCRYPTION_KEY exists in .env but unused) — planned for future version
- Telegram listener auto-closes browser after each command (wastes 2Captcha credits on PAY4D)
- PAY4D TARIK DB: profile-click flow is slow (~6s per user) — no server-side phone API available

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

### v1.8.0
- **Live Report Improvements**
  - **Separate Telegram bot token** for Live Report: `notification.telegramBotTokenLiveReport` — Live Report uses its own bot, independent from NTO/TARIK DB bot
  - **Multiple upline support** — `uplineUsername` supports comma-separated values (e.g., `teamreborn,superalx`), loops through each upline: scrape → render → send per upline, 3s delay between
  - **Dynamic username prefix** — `usernameKeyMkt()` and `usernameKeyReborn()` now accept dynamic prefix from upline username instead of hardcoded `teammkt`/`teamreborn`. Any upline prefix works (e.g., `superalx`, `captain77`)
  - **No-letter username support** — usernames without member letter suffix (e.g., `superalx1`, `superalx10`) now parse correctly. Member letter is optional in regex. For these patterns: label uses original username, team total rows skipped (redundant)
  - **Dynamic report title** — report title uses upline username in uppercase (e.g., `SUPERALX REPORT`, `TEAMREBORN MKT REPORT`) instead of hardcoded "TEAMREBORN"
  - **Company Report** — separate PNG scraped from `/report/report-profit-loss/by-company`
    - New flow: `victoryCompanyReportFlow()` in `victory-livereport-flow.ts`
    - Navigates to by-company page, sets date range, clicks Filter, finds row matching target date
    - Extracts 24 columns: Date, Reg Count, Login Count, 1st DP, DP, WD, DP/WD Diff, Adjustment, Bet, Valid Bet, Player WL, Promo, Rebate, Commission, Total WL, FRB, JPC
    - Flexible date matching (e.g., "9 March 2026" or "09/03/2026")
    - Rendered as standalone vertical table (Metric | Value) with color-coded WL values
    - Scraped once per account, sent as separate PNG after all upline reports
    - New function: `renderCompanyReportToPng()` in `livereport-processor.ts`
  - **Per-account manual trigger** — `POST /api/settings/livereport-scheduler/run-now` accepts `accountId` in body to trigger single account
  - **Proxy input** in Live Report account creation form (panel)
  - **Per-account run button** in Live Report scheduler account list (panel)
- **GANTI NOMOR** — Telegram-driven WhatsApp number change for NUKE identity page + CUTT.LY shortlinks
  - **New provider: CUTTLY** — cutt.ly shortlink management with persistent browser session
    - `cuttly-login-flow.ts`: email/password login at `https://cutt.ly/login` (reCAPTCHA v3 invisible auto-executes)
    - `cuttlySessionCheck()`: checks saved session by navigating to panelUrl, detects login redirect or form
    - Persistent browser profile: login once, reuse session until expired
  - **New flow: `cuttly-gantinomor-flow.ts`** — search old phone → change ALL matching shortlinks
    - `collectMatchingResults()`: scans all `.url_options` divs on page for `phone={oldNumber}` in link href
    - `collectPaginationUrls()`: extracts pagination links for multi-page results
    - `changeOneResult()`: navigates to `/change/{alias}` → replaces `phone=old` with `phone=new` in input → submits
    - `changeSingleLink()`: orchestrates all pages with dedup via `visitedPages` Set, returns `changedCount`
    - Handles 10+ results per page across multiple pagination pages
  - **New flow: `nuke-gantinomor-flow.ts`** — NUKE identity page (`/configuration/identity`) WA number change
    - Navigates to identity page, handles mid-session OTP via `handleMidSessionOtp()`
    - `fillAntInput()`: valueTracker-reset strategy for Ant Design inputs (reset `_valueTracker` → native setter → dispatch events)
    - Verifies old number matches current value before changing
    - Reads current WA1 (CS) and WA2 (MST) values, fills new values, submits form
  - **New selectors: `cuttly-selectors.ts`** — login form (#email, #password, button.g-recaptcha), search results (.url_options), change page (input[name="link"]), pagination
  - **NUKE selectors: identity section** — #whatsapp, #whatsapp2, submit button with fallbacks
  - **New listener: `gantinomor-listener.ts`** — separate `GantiNomorTelegramListener` class
    - Own bot token + chat ID: `notification.telegramBotTokenGantiNomor` + `notification.telegramChatIdGantiNomor`
    - Command format: `cutt.ly GANTI NOMOR` (CUTTLY) or `AccountName GANTI NOMOR` (NUKE)
    - Supports `old cs:` / `new cs:` and/or `old mst:` / `new mst:` (minimal 1 pair)
    - Multi-command: `---` separator for multiple commands in 1 message
    - Explicit provider routing: `cutt.ly` / `cuttly` header → CUTTLY, anything else → NUKE by name match
    - Per-account command queueing via `accountQueues` Map
    - CUTT.LY batched: start browser once → process all commands → stop once
    - NUKE: start/stop per account
    - Auto-starts bot if not running, waits for login (60s timeout), handles OTP
    - Auto-closes browser after all commands done
  - **AutomationService.changeNumber()** — routes by provider: CUTTLY → `cuttlyGantiNomorFlow`, NUKE → `nukeGantiNomorFlow`
  - **New account fields**: `cuttlyLinkCs String?`, `cuttlyLinkMst String?` — team shortlink URLs for CS and MST
  - **Validation**: `providerEnum` includes `CUTTLY`, `featureEnum` includes `GANTINOMOR`
  - **Dashboard**: CUTTLY added to provider stats query
  - **Settings**: `notification.telegramBotTokenGantiNomor` + `notification.telegramChatIdGantiNomor` auto-seeded
  - **API routes**: `POST /api/settings/gantinomor-listener/start|stop`, `GET /api/settings/gantinomor-listener/status`
  - **Auto-start**: listener starts on boot if both token + chatId configured
  - **Graceful shutdown**: listener stopped on server exit
  - **Panel**: GANTI NOMOR sidebar group (NUKE, CUTT.LY, Settings sections)
  - **Panel**: CS Link + MST Link form fields (conditional on CUTTLY provider) in add/edit account
  - **Panel**: Telegram bot token + chat ID settings with listener toggle + status indicator
  - **Panel**: command guide with CUTT.LY vs NUKE examples
- **Panel Changes**
  - Added "Telegram Bot Token (Live Report)" input field in scheduler settings
  - Added proxy dropdown + input to Live Report add account form
  - Per-account play button + inline upline editing in account list

### v1.7.0
- **Live Report** — Victory panel profit/loss report scraping with team-based summary + PNG rendering
  - New flow: `victory-livereport-flow.ts` — scrapes `/report/report-profit-loss/by-referral` page
    - Sets Upline Username (MUI input with char-by-char typing + JS fallback)
    - Sets date range via MUI DatePicker (reuses `setMuiDatePicker` from victory-nto-check-flow)
    - Scroll-scrapes MUI virtual table (up to 600 iterations, dedup by username key)
    - Sets page size to 1000 via MUI Select combobox
  - New processor: `livereport-processor.ts` — data processing + HTML table → PNG rendering
    - Username parsing: MKT mode (`teammkt1glen` → Team 1, GLEN) vs REBORN mode (`teamreborn1a` → 1A)
    - Columns: REGIS, 1stDP, 1stDP Amount, Closing%, AVG PERFORM, DP, DP Amt, AVG DP PERFORM, Valid Bet, Winlose
    - Conditional coloring: AVG ≥100K → green, <100K → red; Closing ≥70% → green, <70% → red
    - Team totals (yellow), grand total (dark teal), Top 5 rankings
    - Renders styled HTML table via Playwright `page.setContent()` + `screenshot()` → PNG buffer
    - 20 motivational quotes for Telegram captions
  - New scheduler: `livereport-scheduler.ts` — `LiveReportScheduler` class (matches TarikDbScheduler pattern)
    - Settings: `livereport.scheduler.enabled`, `.interval` (minutes), `.accountIds` (json), `.dailyRecapTime` (HH:MM), `.weeklyRecap`, `.monthlyRecap`, `.lastRun`
    - Separate Telegram bot: `notification.telegramBotTokenLiveReport` + `notification.telegramChatIdLiveReport`
    - 60s interval check: daily recap (H-1 at configurable time) + weekly (Monday 10:00) + monthly (1st 10:00) + hourly
    - Sequential account processing: start bot → login → scrape → summarize → render PNG → send Telegram → stop bot
    - Mode detection: `uplineUsername` containing 'mkt' → MKT mode, else → REBORN mode
  - New account feature: `LIVEREPORT` (alongside `NTO` and `TARIKDB`)
  - New field: `uplineUsername String?` on Account model (used for Live Report upline filter)
  - New Telegram function: `sendTelegramPhotoBufferToChat()` — sends PNG buffer via sendPhoto with fallback to sendDocument
  - New method: `AutomationService.checkLiveReport()` — validates VICTORY provider, runs flow, processes data, renders PNG
  - Victory selectors: added `liveReport` section (uplineInput, startDate, endDate, filterButton, tableBody, loadingSpinner)
  - Panel: Live Report Scheduler page with config card (enable, interval, daily recap time, weekly/monthly checkboxes, Telegram chat ID)
  - Panel: inline account creation form on scheduler page (name, URL, username, password, upline)
  - Panel: account picker with search, select all/none, counter
  - Panel: upline field in edit account modal (shown for LIVEREPORT feature accounts)
  - Validation: `featureEnum` updated to include `LIVEREPORT` (v1.8.0 adds `GANTINOMOR`)
  - Auto-starts on server boot if enabled; stops on graceful shutdown

### v1.6.0
- **Bug Fixes & Stability**
  - Add missing `DEFAULT_SETTINGS`: `notification.adminUserIds` (json, `[]`) and `notification.telegramChatIdTarikDb` (string, `''`) — fresh installs now auto-seed these
  - Add TTL/expiration (10 min) to `pendingRequests` Map in telegram-listener — auto-cleanup expired approval requests via 60s interval timer, hooks into `start()`/`stop()`
  - Add OTP timeout (2 min) — `setTimeout` in `AutomationService.startBot()`, auto-stops bot + closes browser if `waiting_otp` status persists after 120s
  - NTO list endpoint (`GET /api/nto`) now supports `offset` query param and returns `total` count for pagination
  - Root `tsconfig.json` cleanup — removed non-existent folder references (`shared/`, `NUKE/`, `VICTORY/`, `PAY4D/`)
- **Panel UX Improvements**
  - Custom confirmation modal (`showConfirmModal`) — replaced all 7 native `confirm()` dialogs with themed modal (dark mode compatible)
  - NTO Results pagination — page size selector (10/25/50/100), prev/next controls, total count display
  - NTO Results search — filter by account name (live search input)
  - NTO Export Excel button — green icon per-result row, triggers `POST /api/nto/export` + auto-downloads file
  - NTO Send Telegram button — blue Telegram icon per-result row, triggers `POST /api/nto/telegram`
  - Screenshot button — purple camera icon appears on running accounts, opens modal with live browser screenshot + refresh
  - Loading spinners — start/stop bot buttons show spinner during async operation
  - Bot Activity log filters — dropdown filter by provider (NUKE/VICTORY/PAY4D) and status (success/error/warning/info)
  - New API client methods: `nto.check()`, `nto.exportExcel()`, `nto.sendTelegram()`, `nto.result()`, `bot.screenshotUrl()`
- **PAY4D TARIK DB** — new feature: scrape "All User" page for member data
  - New file: `pay4d-tarikdb-check-flow.ts` — navigates to All User page, scans rows for matching Join Date, clicks profile for phone, determines status by credit
  - No server-side date filter — client-side scan of Join Date column (`input[type='text'][readonly]` in column 4)
  - Profile-click flow: click `editProfilUsers` button → read `input.form-control.telpon` → click "Back to All Users" (~6s per user)
  - Status: `credit > 0` → "REGIS + DEPO", else → "REGIS ONLY"
  - Supports both date_range mode (scan for matching dates) and old_user mode (search by username)
  - Phone number formatting: `08xxx` → `628xxx` (matching Python reference)
  - Pagination via numbered `<li class="page-item" onclick="menuUsers(N)">` pages (no Next/Prev button)
  - Continues to next page if target dates found (handles 100+ rows per date across pages)
  - Recovery on error: auto-navigates back to All User page
  - New selectors in `pay4d-selectors.ts`: `allUser` section (menuButton, searchInput, profileButton, phoneInput, backButton, pagination)
  - `AutomationService.checkTarikDb()` routes PAY4D provider to new flow
  - Works with existing Telegram TARIK DB commands, Excel export, and Scheduler
- **Per-Account Proxy** — each account can use its own HTTP/HTTPS/SOCKS5/SOCKS4 proxy
  - New `proxy` field on Account model (optional String)
  - Proxy passed to Playwright `launchPersistentContext` with `{ server, username?, password? }`
  - `parseProxyString()` in `context-manager.ts` handles all proxy URL formats
  - Proxy credentials masked in logs: `proxyStr.replace(/\/\/.*:.*@/, '//***:***@')`
  - Panel UI: dropdown (HTTP/HTTPS/SOCKS5/SOCKS4) + simplified input `host:port:username:password`
  - `buildProxyUrl()` / `parseProxyUrl()` helpers in app.js for format conversion
  - Works for all providers (NUKE, PAY4D, VICTORY) and all features (NTO + TARIK DB)
- **Audit Fixes**
  - Fixed duplicate `class` attribute on checkbox in account table row template (app.js)
  - Fixed error response format in updater.ts — all errors now include `code` field (consistent with other routes)
  - Fixed schema comment: `logged_in` → `logging_in` (matches actual code usage)

### v1.5.0
- **Dark Mode** — full dark mode support for panel UI
  - TailwindCSS `darkMode: 'class'` configuration via CDN
  - Comprehensive CSS `.dark` class overrides for all Tailwind utility classes (backgrounds, text, borders, shadows, inputs, scrollbars)
  - Dark mode toggle button (moon/sun icon) in sidebar footer
  - `localStorage` persistence for dark mode preference
  - System preference detection via `prefers-color-scheme: dark` (auto-detect on first visit)
  - Flash prevention: inline script before app.js applies dark class immediately on page load
  - Chart.js legend colors adapt to dark/light mode
  - Mobile header and hamburger icon dark mode support in `mobile.css`
  - All JS-rendered content (provider sections, activity list, stat cards, forms, modals) styled via CSS class overrides
  - Functions: `toggleDarkMode()`, `updateDarkModeIcon()`, `isDarkMode()` in app.js

### v1.4.0
- **Auto Updater** — one-click update system from panel
  - New route: `SERVER/src/routes/updater.ts` with 4 endpoints (`check`, `download`, `apply`, `upload`)
  - One-click flow: "Cek & Update Otomatis" button → check → confirm → download → install → restart → auto-refresh
  - PowerShell update script (detached): stop server → backup DB → extract ZIP → npm install → prisma generate/push → restart
  - Manual upload: offline update via ZIP file upload from panel
  - WebSocket `UPDATE_STATUS` events for real-time progress
  - Auto-reload: panel polls `/api/health` after server restart, refreshes when ready
  - `express-fileupload` middleware registered for upload support (50MB limit)
  - `build-update.bat` — developer tool to package source files into update ZIP
  - `installer/update.bat` — standalone manual update script (no panel needed)
  - Setting: `updater.url` — URL to versions.json manifest
  - versions.json format: `{ "latest": "1.4.0", "changelog": "...", "downloadUrl": "https://..." }`
  - Preserved during update: `data/` (DB, logs), `profiles/`, `.env`
- **Dynamic version** — version now read from `SERVER/package.json` at runtime (was hardcoded)
  - `APP_VERSION` constant, exposed globally and used in `/api` endpoint + console banner
  - Panel System Info shows live version from API

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
