# BOT NTO - Multi-Provider Automation Dashboard

## Tech Stack
- **Runtime:** Node.js 22.x LTS
- **Backend:** Express.js + TypeScript (port 6969)
- **Database:** SQLite via Prisma ORM
- **Frontend:** Vanilla HTML/JS + TailwindCSS (CDN) + FontAwesome + Chart.js
- **Browser Automation:** Playwright (Chromium, persistent profiles)
- **Captcha Solving:** 2Captcha API (for PAY4D image captcha)
- **Real-time:** WebSocket (ws library) via `(global as any).wsBroadcast`
- **Logging:** Winston with daily file rotation
- **Validation:** Zod schemas on all API inputs
- **Excel Export:** ExcelJS
- **Telegram:** Long-polling bot listener + send message/document/photo

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
│   │   │   │   ├── login-flow.ts           # NUKE login (username/password/OTP agreement/OTP input)
│   │   │   │   ├── nto-check-flow.ts       # NUKE NTO scraping (report/overall, pagination)
│   │   │   │   ├── pay4d-login-flow.ts     # PAY4D login (captcha + cross-origin PIN iframe)
│   │   │   │   └── pay4d-nto-check-flow.ts # PAY4D Win Lose All (multiselect, CSV download+parse)
│   │   │   ├── selectors/
│   │   │   │   ├── nuke-selectors.ts   # Ant Design component selectors
│   │   │   │   └── pay4d-selectors.ts  # Bootstrap component selectors
│   │   │   └── utils/
│   │   │       ├── captcha-solver.ts    # 2Captcha submit + poll + usage tracking
│   │   │       ├── excel-export.ts      # ExcelJS NTO report export
│   │   │       ├── retry-handler.ts     # fillWithFallback, clickWithFallback, withRetry
│   │   │       ├── telegram.ts          # Telegram API (send message/document/photo)
│   │   │       └── telegram-listener.ts # Long-polling listener, NTO command parser, auto-start bot
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
│           └── app.js       # Main SPA logic (~785 lines)
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

## Database Models (Prisma)
- **Account** - Provider accounts (provider, name, panelUrl, username, password, pinCode, status, lastNto, lastError, isActive)
- **BotSession** - Bot run sessions (accountId, provider, status, startedAt, stoppedAt)
- **NtoResult** - NTO check results (accountId, provider, value, rawData as JSON)
- **ActivityLog** - Action logs (action, provider, accountId, details, status)
- **Setting** - Key-value config (key unique, value, type: string/number/boolean/json)
- **CaptchaUsage** - 2Captcha cost tracking (balanceBefore, balanceAfter, cost, result, status)

## Providers
- **NUKE** - nukepanel.com (Ant Design UI). Fully implemented: login + OTP + NTO report scraping
- **PAY4D** - pay4d panel (Bootstrap UI). Fully implemented: captcha login + PIN iframe + Win Lose All CSV
- **VICTORY** - NOT IMPLEMENTED. Accounts can be created but bot start returns "not implemented"

## API Routes
- `GET /api` - System info
- `GET /api/health` - Health check
- `GET/POST/PUT/DELETE /api/accounts` - Account CRUD + `POST /api/accounts/bulk-delete`
- `POST /api/bot/start|stop|start-all|stop-all|submit-otp` + `GET /api/bot/status|screenshot/:id`
- `GET /api/nto` + `/latest` + `/stats` + `/result/:id` + `POST /api/nto/check|export|telegram` + `GET /api/nto/download/:filename`
- `GET/PUT /api/settings/:key` + telegram listener control + captcha balance/history

## WebSocket Events (broadcast via wsBroadcast)
- `BOT_STATUS` - Account status change (accountId, provider, status, name)
- `BOT_LOG` - Bot log message (accountId, provider, message, level)
- `ACCOUNT_CREATED` / `ACCOUNT_DELETED` - Account changes

## Telegram Bot Integration
- Long-polling listener (`telegram-listener.ts`) listens for NTO commands
- Command format: `AccountName GAME NTO username1,username2 DD-MM-YYYY:DD-MM-YYYY`
- Multi-line format also supported (usernames on separate lines)
- Auto-starts bot if not running, runs NTO check, replies with results + Excel
- Game categories: SLOT, SPORTS, CASINO, GAMES (mapped to provider-specific labels)

## Architecture Notes
- Section-based SPA navigation (show/hide divs, rendered by app.js)
- Playwright persistent contexts save login sessions across restarts (NUKE benefits, PAY4D always re-logins)
- `(global as any).wsBroadcast` used for WebSocket broadcasting across modules
- Automation flows use fallback selector patterns (primary + fallback array)
- PAY4D captcha solved via 2Captcha API, cost tracked in CaptchaUsage table
- PAY4D PIN entered via cross-origin iframe virtual keypad (auth.dotflyby.com)
- Broken adminarea navigation blocked via Playwright route interception

## Known Issues
- Passwords/PINs stored plaintext in SQLite (ENCRYPTION_KEY exists in .env but unused)
- Root tsconfig.json references non-existent folders (shared/, NUKE/, VICTORY/, PAY4D/)
- No locking mechanism for concurrent Telegram NTO commands on same account
- Telegram listener auto-closes browser after each command (wastes 2Captcha credits on PAY4D)
- OTP waiting status has no timeout (browser stays open indefinitely)
- VICTORY provider not implemented but selectable in UI
