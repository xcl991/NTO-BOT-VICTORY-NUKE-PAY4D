# Research v1.2.0: TARIK DB Admin Approval + Old User Targeting

## Deep Research Findings (Verified Line Numbers)

### Key Source Files Analyzed
| File | Lines | Key Findings |
|------|-------|--------------|
| `telegram-listener.ts` | 992 | Poll loop L878, handleMessage L905, parseTarikDb L202, processTarikDb L253 |
| `telegram.ts` | ~150 | sendTelegramMessage, sendTelegramDocument, getTelegramConfig |
| `nuke-tarikdb-check-flow.ts` | ~350 | nukeTarikDbCheckFlow, URL building L61-66, scrapeMemberPage |
| `victory-tarikdb-check-flow.ts` | ~250 | victoryTarikDbCheckFlow, runFilterCycle, dates unconditional L114-118 |
| `automation/index.ts` | ~500 | checkTarikDb L398, routes VICTORY vs NUKE |

---

## Fitur 1: Admin Approval untuk TARIK DB Request

### Konsep
Ketika user general (non-admin) di group Telegram mengirim command TARIK DB, bot TIDAK langsung menjalankan — melainkan mengirim pesan approval ke group dengan tombol **Approve** dan **Cancel**. Hanya user admin (berdasarkan chat ID) yang bisa menekan tombol.

### Flow
```
1. User A kirim: "HOLYPLAY TARIK DB\nID1\nID2\nID3"
2. Bot detect user A bukan admin
3. Bot kirim pesan ke group:
   ┌──────────────────────────────────────┐
   │ TARIK DB Request                     │
   │                                      │
   │ Dari: @userA (ID: 123456)            │
   │ Waktu: 06-03-2026 21:30 WIB         │
   │ Account: HOLYPLAY                    │
   │ Target: ID1, ID2, ID3               │
   │                                      │
   │ [Approve]  [Cancel]                  │
   └──────────────────────────────────────┘
4a. Admin klik Approve → bot mulai proses TARIK DB
4b. Admin klik Cancel → bot reply "Cancelled by admin"
4c. Non-admin klik → bot reply "Unauthorized" (toast)
```

### Telegram Bot API yang Dibutuhkan

#### 1. Inline Keyboard (kirim pesan dengan tombol)
```typescript
// sendMessage dengan reply_markup
const body = {
  chat_id: chatId,
  text: approvalText,
  parse_mode: 'HTML',
  reply_markup: {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `approve_tdb_${requestId}` },
        { text: '❌ Cancel', callback_data: `cancel_tdb_${requestId}` }
      ]
    ]
  }
};
await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
```

#### 2. Handle Callback Query (tombol diklik)
```typescript
// answerCallbackQuery — acknowledge klik (hilangkan loading spinner)
await fetch(`${TELEGRAM_API}${botToken}/answerCallbackQuery`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    callback_query_id: callbackId,
    text: 'Processing...',
    show_alert: false    // false = toast kecil, true = popup alert
  })
});
```

#### 3. Edit Message (update pesan setelah approve/cancel)
```typescript
// editMessageText — ubah pesan + hapus tombol
await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: chatId,
    message_id: messageId,
    text: 'Approved by admin @adminUser\nProcessing TARIK DB...',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [] }  // hapus tombol
  })
});
```

### Perubahan di Listener (telegram-listener.ts)

#### A. Update `allowed_updates` (LINE 878)
```typescript
// SEBELUM (line 878):
allowed_updates: ['message'],

// SESUDAH:
allowed_updates: ['message', 'callback_query'],
```

#### B. Handle callback_query di poll loop (LINE 893-901)
```typescript
// SEBELUM:
for (const update of updates) {
  if (update.message?.text) {
    await this.handleMessage(update.message);
  }
}

// SESUDAH:
for (const update of updates) {
  if (update.message?.text) {
    await this.handleMessage(update.message);
  } else if (update.callback_query) {
    await this.handleCallbackQuery(update.callback_query);
  }
}
```

#### C. Admin verification di callback handler (NEW METHOD)
```typescript
private async handleCallbackQuery(callbackQuery: any): Promise<void> {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const adminIds = await this.getAdminUserIds();  // dari DB setting

  // Jika adminIds kosong = semua user dianggap admin
  if (adminIds.length > 0 && !adminIds.includes(userId)) {
    await answerCallbackQuery(this.botToken, callbackQuery.id, 'Hanya admin yang bisa approve/cancel', true);
    return;
  }

  const data = callbackQuery.data;  // e.g. "approve_tdb_a1b2c3"
  const parts = data.split('_');
  const action = parts[0];       // "approve" or "cancel"
  const requestId = parts[2];    // "a1b2c3"

  if (action === 'approve') {
    await answerCallbackQuery(this.botToken, callbackQuery.id, 'Approved! Processing...', false);
    await editMessageText(chatId, messageId, '✅ Approved! Processing TARIK DB...');
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      this.pendingRequests.delete(requestId);
      // Execute using existing processTarikDbCommand flow
      await this.executePendingTarikDb(pending);
    }
  } else if (action === 'cancel') {
    await answerCallbackQuery(this.botToken, callbackQuery.id, 'Cancelled', false);
    await editMessageText(chatId, messageId, '❌ Cancelled by admin.');
    this.pendingRequests.delete(requestId);
  }
}
```

### Database Setting Baru
```
Key: notification.adminUserIds
Type: json
Value: [123456789, 987654321]     // array of Telegram user IDs
```

### Pending Request Storage
**Rekomendasi: In-memory Map** (TARIK DB request tidak perlu persist across restart)

```typescript
// Map<requestId, PendingRequest>
private pendingRequests = new Map<string, {
  accountName: string;
  usernames: string[];
  dateStart?: string;
  dateEnd?: string;
  mode: 'date_range' | 'old_user';
  requestedBy: { id: number; username: string; firstName: string };
  requestedAt: Date;
  messageId: number;
  chatId: number;
}>();
```

### Callback Data Format
Telegram callback_data max **64 bytes** (NOT 32). Format:
- `approve_tdb_{requestId}` (e.g. `approve_tdb_a1b2c3`)
- `cancel_tdb_{requestId}` (e.g. `cancel_tdb_a1b2c3`)
- requestId: `Date.now().toString(36)` (6-8 chars, simple, no extra dependency)

### Fungsi Baru di telegram.ts
```typescript
// 1. Kirim pesan dengan inline keyboard
export async function sendTelegramMessageWithKeyboard(
  text: string,
  inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>,
  chatId?: string | number,
  replyToMessageId?: number
): Promise<{ ok: boolean; messageId?: number }>

// 2. Answer callback query
export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string,
  showAlert?: boolean
): Promise<boolean>

// 3. Edit message text (+ optional keyboard update)
export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>
): Promise<boolean>
```

### Admin vs Non-Admin Detection
```
- Admin: user yang chat ID-nya ada di `notification.adminUserIds`
- Non-admin: semua user lain di group
- Jika admin kirim command → langsung execute (tanpa approval)
- Jika non-admin kirim command → minta approval
- Jika private chat (bukan group) → langsung execute (hanya admin punya bot token)
- Jika `notification.adminUserIds` kosong/tidak ada → semua user dianggap admin (no approval needed)
```

### Integration with Existing handleMessage (LINE 905)
```typescript
// Di handleMessage, setelah parse command:
if (isTarikDbCommand) {
  const fromUser = message.from;
  const adminIds = await this.getAdminUserIds();
  const isAdmin = adminIds.length === 0 || adminIds.includes(fromUser.id);
  const isPrivateChat = message.chat.type === 'private';

  if (isAdmin || isPrivateChat) {
    // Langsung execute (existing flow)
    await this.processTarikDbCommand(parsed, message);
  } else {
    // Non-admin: kirim approval request
    await this.sendApprovalRequest(parsed, message);
  }
}
```

---

## Fitur 2: Old User Targeting (Cari User tanpa Date Range)

### Konsep
Format Telegram command baru yang lebih simpel — hanya kirim nama account + daftar username, tanpa perlu tanggal. Bot langsung cari user berdasarkan username.

### Format Command Baru
```
HOLYPLAY TARIK DB

ID1
ID2
ID3
```

Tanpa baris tanggal `DD-MM-YYYY:DD-MM-YYYY` di akhir.

### Perubahan Parser (telegram-listener.ts LINE 202-250)

#### Current parseTarikDbCommand Logic (v1.1.0)
```typescript
// LINE 202: parseTarikDbCommand(text: string)
// LINE 206: headerRegex = /^(\S+)\s+TARIK\s*DB$/i
// LINE 211-215: splits lines, takes non-empty
// LINE 217-220: lastLine MUST match date regex → dateStart, dateEnd
// LINE 225-233: if lines between header and date → username = first line
// RETURNS: { accountName, username?, dateStart, dateEnd }
// CONSTRAINT: dateStart/dateEnd currently REQUIRED (no date = returns null)
```

#### New parseTarikDbCommand Logic (v1.2.0)
```typescript
function parseTarikDbCommand(text: string): ParsedTarikDbCommand | null {
  // ... existing header parse (line 206) ...

  const lastLine = nonEmptyLines[nonEmptyLines.length - 1];
  const dateMatch = lastLine.match(/(\d{2}-\d{2}-\d{4}):(\d{2}-\d{2}-\d{4})/);

  if (dateMatch) {
    // EXISTING FLOW: date range mode
    // Lines between header and date line = optional single username
    const username = nonEmptyLines.length > 2 ? nonEmptyLines[1] : undefined;
    return { accountName, username, dateStart, dateEnd, mode: 'date_range' };
  } else {
    // NEW FLOW: old user targeting mode (no dates)
    // ALL lines after header = usernames (one per line)
    const usernames = nonEmptyLines.slice(1);
    if (usernames.length === 0) return null; // Need at least 1 username
    return { accountName, usernames, mode: 'old_user' };
  }
}
```

#### Updated Interface
```typescript
interface ParsedTarikDbCommand {
  accountName: string;
  mode: 'date_range' | 'old_user';
  // date_range mode:
  username?: string;      // single optional username filter
  dateStart?: string;     // DD-MM-YYYY (required for date_range)
  dateEnd?: string;       // DD-MM-YYYY (required for date_range)
  // old_user mode:
  usernames?: string[];   // multiple usernames (required for old_user)
}
```

### NUKE: Old User Targeting

#### Confirmed: URL Works Without Date Params
```
// With dates (existing):
https://md77.nukepanel.com/management/member?page=0&size=40&roleUser.equals=true
  &createdDate.greaterThanOrEqual=2026-02-28T17:00:00.000Z
  &createdDate.lessThanOrEqual=2026-03-02T16:59:59.999Z
  &username.contains=katie123

// Without dates (OLD USER MODE - CONFIRMED WORKING):
https://md77.nukepanel.com/management/member?page=0&size=40&roleUser.equals=true
  &username.contains=katie123
```

**NUKE panel accepts `username.contains` without `createdDate` params!**

#### Perubahan di `nukeTarikDbCheckFlow` (nuke-tarikdb-check-flow.ts)

**Current options (LINE ~30):**
```typescript
options: {
  dateStart: string;    // REQUIRED
  dateEnd: string;      // REQUIRED
  username?: string;    // Optional single username
  maxPages?: number;
  twoFaSecret?: string;
}
```

**New options:**
```typescript
options: {
  dateStart?: string;    // NOW OPTIONAL (undefined for old_user mode)
  dateEnd?: string;      // NOW OPTIONAL
  username?: string;     // Single username (existing date_range mode)
  usernames?: string[];  // Multiple usernames (NEW old_user mode)
  maxPages?: number;
  twoFaSecret?: string;
}
```

**URL building change (LINE 61-66):**
```typescript
// BEFORE: dates always appended
const startDateUtc = toUtcIso(options.dateStart, false);
const endDateUtc = toUtcIso(options.dateEnd, true);
let memberUrl = `${baseUrl}/management/member?page=0&size=${PAGE_SIZE}&roleUser.equals=true` +
  `&createdDate.greaterThanOrEqual=${encodeURIComponent(startDateUtc)}` +
  `&createdDate.lessThanOrEqual=${encodeURIComponent(endDateUtc)}`;

// AFTER: dates conditional
let memberUrl = `${baseUrl}/management/member?page=0&size=${PAGE_SIZE}&roleUser.equals=true`;

if (options.dateStart && options.dateEnd) {
  const startDateUtc = toUtcIso(options.dateStart, false);
  const endDateUtc = toUtcIso(options.dateEnd, true);
  memberUrl += `&createdDate.greaterThanOrEqual=${encodeURIComponent(startDateUtc)}`;
  memberUrl += `&createdDate.lessThanOrEqual=${encodeURIComponent(endDateUtc)}`;
}

if (options.username) {
  memberUrl += `&username.contains=${encodeURIComponent(options.username)}`;
}
```

**Multi-Username Loop (NEW, replaces single-username logic for old_user mode):**
```typescript
if (options.usernames && options.usernames.length > 0) {
  // Old user mode: loop per username, each gets its own URL navigation
  for (const uname of options.usernames) {
    onLog(`Searching: ${uname}`);
    let url = `${baseUrl}/management/member?page=0&size=40&roleUser.equals=true` +
      `&username.contains=${encodeURIComponent(uname)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Handle mid-session OTP if needed
    await handleMidSessionOtp(page, onLog, options.twoFaSecret);

    // Scrape results
    const pageRows = await scrapeMemberPage(page, onLog, 1); // 1 page per username
    allRows.push(...pageRows);

    if (pageRows.length === 0) {
      allRows.push({ username: uname, wallet: '-', phone: '-', status: 'NOT FOUND', joinDate: '-' });
    }
  }
} else {
  // Existing flow: single URL with optional username filter
  // ... existing code ...
}
```

### VICTORY: Old User Targeting

#### Perubahan di `victoryTarikDbCheckFlow` (victory-tarikdb-check-flow.ts)

**Current `runFilterCycle` (LINES 114-118) — dates UNCONDITIONAL:**
```typescript
// These are ALWAYS called — need to be conditional for old_user mode
await setMuiDatePicker(page, S.startDate, options.dateStart, onLog);
await setMuiDatePicker(page, S.endDate, options.dateEnd, onLog);
```

**Updated `runFilterCycle`:**
```typescript
// Only set dates if provided
if (options.dateStart && options.dateEnd) {
  // Select "Registered Date" filter
  await page.click(S.filterDateBySelect);
  await page.waitForTimeout(500);
  await page.click(S.registeredDateOption);
  await page.waitForTimeout(500);

  await setMuiDatePicker(page, S.startDate, options.dateStart, onLog);
  await setMuiDatePicker(page, S.endDate, options.dateEnd, onLog);
}

// Username filter (always available)
if (currentUsername) {
  await page.fill(S.usernameInput, '');
  await page.fill(S.usernameInput, currentUsername);
}
```

**Multi-Username Loop (same pattern as NUKE):**
```typescript
if (options.usernames && options.usernames.length > 0) {
  for (const uname of options.usernames) {
    onLog(`Searching: ${uname}`);
    // Run 2-cycle for each username
    const cycle1 = await runFilterCycle(page, 'false', uname, options, onLog); // REGIS ONLY
    const cycle2 = await runFilterCycle(page, 'true', uname, options, onLog);  // REGIS+DEPO
    // Merge results
    allRows.push(...cycle2, ...cycle1); // DEPO first
  }
}
```

### Perubahan di AutomationService (index.ts LINE 398)

**Current `checkTarikDb` signature:**
```typescript
async checkTarikDb(accountId: number, options: {
  dateStart: string;      // REQUIRED
  dateEnd: string;        // REQUIRED
  username?: string;
  maxPages?: number;
}): Promise<TarikDbCheckResult>
```

**New signature:**
```typescript
async checkTarikDb(accountId: number, options: {
  dateStart?: string;      // NOW OPTIONAL
  dateEnd?: string;        // NOW OPTIONAL
  username?: string;       // Single username (existing)
  usernames?: string[];    // Multiple usernames (NEW)
  maxPages?: number;
}): Promise<TarikDbCheckResult>
```

### processTarikDbCommand Changes (telegram-listener.ts LINE 253)

```typescript
// Current flow (simplified):
// 1. Find account by name
// 2. Auto-start bot if not running
// 3. Wait for bot ready
// 4. Call automationService.checkTarikDb(accountId, { dateStart, dateEnd, username })
// 5. Format results + send Excel + Telegram
// 6. Auto-close browser

// New flow for old_user mode:
// 1. Find account by name
// 2. Auto-start bot if not running
// 3. Wait for bot ready
// 4. Call automationService.checkTarikDb(accountId, { usernames })  // no dates
// 5. Format results + send Excel + Telegram (with "Old User" label)
// 6. Auto-close browser
```

### Telegram Response Format

**Date Range Mode (existing):**
```
TARIK DB - HOLYPLAY
01-03-2026 s/d 05-03-2026

REGIS + DEPO: 2
REGIS ONLY: 1

Username  | Phone        | Status
ID1       | 628123456789 | REGIS + DEPO
ID2       | 628987654321 | REGIS + DEPO
ID3       | 628555666777 | REGIS ONLY
```

**Old User Mode (new):**
```
TARIK DB - HOLYPLAY (Old User)

REGIS + DEPO: 2
REGIS ONLY: 1
NOT FOUND: 1

Username  | Phone        | Status
ID1       | 628123456789 | REGIS + DEPO
ID2       | 628987654321 | REGIS + DEPO
ID3       | 628555666777 | REGIS ONLY
ID4       | -            | NOT FOUND
```

---

## Implementation Plan

### Phase 1: Telegram Infrastructure
1. Tambah `sendMessageWithKeyboard()`, `answerCallbackQuery()`, `editMessageText()` di `telegram.ts`
2. Update listener `allowed_updates` (LINE 878) ke `['message', 'callback_query']`
3. Tambah `handleCallbackQuery()` method di listener
4. Tambah `pendingRequests` Map di listener class
5. Tambah DB setting `notification.adminUserIds` (json array)
6. Panel: tambah input Admin User IDs di Settings

### Phase 2: Admin Approval Flow
1. Tambah `getAdminUserIds()` method — baca dari DB setting
2. Di `handleMessage()` (LINE 905): detect admin vs non-admin
3. Non-admin TARIK DB → `sendApprovalRequest()` — kirim pesan dengan inline keyboard
4. Store pending request di in-memory Map (requestId = `Date.now().toString(36)`)
5. `handleCallbackQuery()` — approve → execute, cancel → edit message
6. Edit original message setelah action (hapus tombol)

### Phase 3: Old User Targeting
1. Update `ParsedTarikDbCommand` interface — add `mode`, `usernames[]`
2. Update `parseTarikDbCommand()` (LINE 202) — support format tanpa tanggal
3. Update `nukeTarikDbCheckFlow()` — dateStart/dateEnd optional, multi-username loop
4. Update `victoryTarikDbCheckFlow()` — dateStart/dateEnd optional, multi-username loop
5. Update `AutomationService.checkTarikDb()` (LINE 398) — optional dates, usernames array
6. Update `processTarikDbCommand()` (LINE 253) — route date_range vs old_user mode
7. Update `formatTarikDbResultMessage()` (LINE 406) — "Old User" label, NOT FOUND status

### Phase 4: Testing
1. Test admin approval flow (approve + cancel + unauthorized)
2. Test old user NUKE (single + multi username)
3. Test old user VICTORY (single + multi username)
4. Test backward compatibility (existing date-range format masih jalan)
5. Test admin bypass (admin kirim command → langsung execute)
6. Test empty adminUserIds (semua user = admin)

---

## File yang Perlu Dimodifikasi

| File | Perubahan |
|------|-----------|
| `telegram.ts` | Tambah `sendMessageWithKeyboard`, `answerCallbackQuery`, `editMessageText` |
| `telegram-listener.ts` | `allowed_updates` L878, `handleCallbackQuery`, approval flow, updated parser L202, `pendingRequests` Map, admin detection |
| `nuke-tarikdb-check-flow.ts` | Optional dates L61-66, multi-username loop |
| `victory-tarikdb-check-flow.ts` | Optional dates L114-118, multi-username loop |
| `automation/index.ts` | Optional dates di `checkTarikDb` L398 |
| `routes/settings.ts` | Admin IDs CRUD endpoint |
| `utils/validation.ts` | Admin IDs validation schema |
| `panel/assets/js/app.js` | Admin User IDs input di Settings page |
| `panel/index.html` | Admin User IDs field |

## Database Setting Baru

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `notification.adminUserIds` | json | `[]` | Array of Telegram user IDs yang bisa approve request |

## Backward Compatibility
- Format lama (dengan tanggal) tetap didukung 100%
- Admin yang kirim command tetap langsung execute (tanpa approval)
- Setting `notification.adminUserIds` kosong = semua user dianggap admin (no approval needed)
- Private chat = langsung execute (hanya admin punya bot token)
- `processTarikDbCommand` existing flow unchanged for date_range mode

## Critical Constraints Discovered
1. **NUKE URL without dates**: CONFIRMED working — `username.contains` alone is sufficient
2. **Victory dates unconditional**: Lines 114-118 in `runFilterCycle` MUST be wrapped in `if (dateStart && dateEnd)`
3. **Parser returns null without dates**: Current `parseTarikDbCommand` REQUIRES date line — new format detection needed
4. **callback_data max 64 bytes**: Format `approve_tdb_XXXXXX` fits comfortably
5. **Single username in current parser**: `username = usernames[0]` at line 233 — new mode needs array
6. **processCommand auto-closes browser**: Lines 393-399 — this behavior stays for old_user mode too
7. **accountQueues per account name**: Promise chaining prevents concurrent commands on same account — approval flow must respect this
