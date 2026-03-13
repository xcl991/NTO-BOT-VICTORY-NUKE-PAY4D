# Live Report Feature — Research & Implementation Plan

## Overview
Convert Python `panel_livereport_combo_v2.py` (Selenium + tkinter + matplotlib) to TypeScript
and integrate into the existing panel as a new feature alongside NTO and TARIK DB.

## Python Bot Summary
- **Purpose**: Scrapes Victory panel `/report/report-profit-loss/by-referral` page
- **Data**: Groups usernames by team patterns (MKT/REBORN), summarizes REGIS/1stDP/DP/ValidBet/Winlose
- **Output**: Renders summary table as PNG image (matplotlib), sends to Telegram with caption
- **Schedule**: Hourly loop + daily recap (H-1 at 00:10) + weekly recap (Monday 10:00) + monthly recap (1st of month 10:00)
- **Modes**: MKT (`teammkt`) and REBORN (`teamreborn`) — runs both sequentially per cycle
- **Config**: URL, username, password, bot token, chat ID, headless mode, upline usernames

## Key Python Flow
1. Login to Victory panel (MUI React SPA)
2. Navigate: Menu "5. Report" → "5.8 Profit & Loss Report" → Tab "By Referral"
3. Set "Upline Username" input field (e.g., `teammkt` or `teamreborn`)
4. Set date range (start date = today, end date = optional)
5. Click Filter, set page size to 1000
6. Scroll-scrape all rows from MUI virtual table (up to 600 scroll iterations)
7. Parse usernames → extract team number + member name
   - MKT: `teammkt1glen` → Team 1, GLEN
   - REBORN: `teamreborn1a` → 1, A
8. Summarize per team: REGIS, 1stDP, 1stDP Amount, DP, DP Amount, ValidBet, Winlose
9. Build table DataFrame with calculated columns: Closing%, AVG PERFORM, AVG DP PERFORM
10. Render as PNG using matplotlib with conditional coloring
11. Generate Top 5 rankings (NDP, Closing Rate, Turnover, TX, DP Amount) + Bottom 5
12. Send photo + caption to Telegram

## Column Mapping (by-referral table)
From scrape_rows() raw data (0-indexed):
- `vals[0]` = Username
- `vals[2]` = REGIS (registration count)
- `vals[3]` = 1st DP (first deposit count)
- `vals[4]` = 1st DP Amount
- `vals[5]` = DP (deposit count)
- `vals[6]` = DP Amount
- `vals[14]` = Valid Bet
- `vals[19]` = Winlose

## Implementation Plan

### 1. Database Changes
- New Account feature: `LIVEREPORT` (add to Account.feature enum docs)
- New settings:
  - `livereport.scheduler.enabled` (boolean)
  - `livereport.scheduler.interval` (number, minutes, default 60)
  - `livereport.scheduler.accountIds` (json, number[])
  - `livereport.scheduler.modes` (json, e.g. `["MKT","REBORN"]`)
  - `livereport.scheduler.lastRun` (json)
  - `livereport.dailyRecap.enabled` (boolean)
  - `livereport.dailyRecap.time` (string, "HH:MM")
  - `livereport.weeklyRecap.enabled` (boolean)
  - `livereport.monthlyRecap.enabled` (boolean)
  - `notification.telegramChatIdLiveReport` (string, separate chat ID for live report)

### 2. Account Model
- Account with `feature: 'LIVEREPORT'` and `provider: 'VICTORY'`
- New optional fields on Account: `uplineUsername` (String?) — the upline filter value
  - Alternative: store in rawData/JSON setting per account to avoid schema change
  - Decision: Add `uplineUsername` field to Account model (simple, clean)

### 3. New Files

#### `SERVER/src/automation/flows/victory-livereport-flow.ts`
- Navigate to `/report/report-profit-loss/by-referral`
- Set upline username in MUI input
- Set date range
- Click Filter, set page size 1000
- Scroll-scrape using Playwright (evaluate JS to get all rows)
- Return raw row data

#### `SERVER/src/automation/utils/livereport-processor.ts`
- Username parsing (MKT and REBORN modes)
- Summarize rows by team
- Build table data structure
- Generate HTML table for screenshot
- Top 5 / Bottom 5 rankings
- Format Telegram caption

#### `SERVER/src/automation/utils/livereport-scheduler.ts`
- Hourly loop scheduler (configurable interval)
- Daily recap (H-1 at configurable time)
- Weekly recap (Monday at configurable time)
- Monthly recap (1st of month at configurable time)
- Sequential MKT+REBORN processing per cycle

#### Victory selectors additions
- Upline Username input selectors
- By Referral tab selector
- Page size combobox selectors

### 4. Image Rendering Strategy
Instead of matplotlib (Python), use Playwright to:
1. Build an HTML table with TailwindCSS styling (conditional coloring)
2. Set page content to the HTML
3. Take a screenshot → PNG buffer
4. Send the PNG to Telegram

This is simpler than adding a Node.js charting library and matches existing Playwright usage.

### 5. Panel UI
- New sidebar group "LIVE REPORT" (below TARIK DB)
- Pages:
  - Live Report Scheduler: enable/disable, interval, account picker, mode picker, recap toggles
  - Live Report Log: real-time WebSocket log display

### 6. API Routes
- `POST /api/settings/livereport-scheduler/start|stop|run-now`
- `GET /api/settings/livereport-scheduler/status`
- `POST /api/livereport/check` — manual trigger for a single account

### 7. Telegram Integration
- Send PNG photo with caption to configurable chat ID
- Caption includes: title, date, Top 5 / Bottom 5 NDP, motivational quote
- Reuse existing `sendTelegramPhoto` / `sendTelegramPhotoToChat` utilities
- Need to add `sendTelegramPhotoBufferToChat` for sending from buffer (not file)

## Recap Schedule Logic
- **Hourly**: Today's date only (start=today, no end date)
- **Daily H-1**: Yesterday's date (start=yesterday, end=yesterday)
- **Weekly**: Previous week (Mon-Sun before current week)
- **Monthly**: Previous month (1st to last day)

## Username Parsing Rules
### MKT Mode
Pattern: `teammkt{N}{name}` (case-insensitive, underscores removed)
- `teammkt1glen` → Team 1, GLEN
- `teammkt2budi` → Team 2, BUDI

### REBORN Mode
Pattern: `teamreborn{N}{letter}` (case-insensitive)
- `teamreborn1a` → 1, A
- `teamreborn3b` → 3, B

## Table Columns (Output)
| Column | Calculation |
|--------|------------|
| Team | Label from username parsing |
| REGIS | Sum of registration count |
| 1st DP | Sum of first deposit count |
| Closing % | (1st DP / REGIS) * 100 |
| 1st DP Amt | Sum of first deposit amount |
| AVG PERFORM | 1st DP Amt / 1st DP (green if ≥100K, red otherwise) |
| DP | Sum of deposit count |
| DP Amt | Sum of deposit amount |
| AVG DP PERFORM | DP Amt / DP |
| Valid Bet | Sum of valid bet |
| Winlose | Sum of winlose |

## Conditional Coloring
- **AVG PERFORM / AVG DP PERFORM**: ≥100,000 → green bg, <100,000 → red bg
- **Closing %**: ≥70% → green bg, <70% → red bg
- **Team Total rows**: Yellow background, bold
- **Grand Total row**: Dark teal background, white text, bold
- **Header row**: Light indigo background, bold

## Implementation Order
1. Victory selectors for by-referral page
2. Live report flow (navigate + scrape)
3. Live report processor (parse + summarize + render HTML → PNG)
4. Telegram photo send from buffer
5. Live report scheduler
6. AutomationService.checkLiveReport method
7. API routes
8. Panel UI
9. Account `uplineUsername` field (schema change)
10. CLAUDE.md update
