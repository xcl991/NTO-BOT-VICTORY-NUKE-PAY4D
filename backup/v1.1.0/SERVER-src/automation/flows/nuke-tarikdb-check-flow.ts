import type { Page } from 'playwright';
import { NUKE_SELECTORS } from '../selectors/nuke-selectors';
import { clickWithFallback, fillWithFallback } from '../utils/retry-handler';
import { generateTOTP, getClockOffsetSeconds } from '../utils/totp';
import logger from '../../utils/logger';

type LogCallback = (msg: string, level?: string) => void;

export interface TarikDbRow {
  username: string;
  wallet: string;
  phone: string;
  status: string;    // "REGIS + DEPO" or "REGIS ONLY"
  joinDate: string;  // e.g. "2026-03-01 10:30:00"
}

export interface TarikDbCheckResult {
  success: boolean;
  rows: TarikDbRow[];
  totalItems?: number;
  error?: string;
}

/**
 * NUKE TARIK DB Check Flow:
 *
 * Scrapes the member management page to extract member data
 * (Username, Wallet, Phone, Status, JoinDate) filtered by join date range.
 *
 * Two modes:
 * - Targeted: specific username via &username.contains=xxx
 * - General: all members in date range
 *
 * URL format:
 * /management/member?page=0&size=100&roleUser.equals=true
 *   &createdDate.greaterThanOrEqual={startISO}
 *   &createdDate.lessThanOrEqual={endISO}
 *   &username.contains={username}   (optional)
 */
export async function nukeTarikDbCheckFlow(
  page: Page,
  panelUrl: string,
  onLog: LogCallback,
  options: {
    dateStart: string;     // DD-MM-YYYY
    dateEnd: string;       // DD-MM-YYYY
    username?: string;     // Optional: specific username to search
    maxPages?: number;     // Default 10
    twoFaSecret?: string;  // TOTP secret for auto-OTP if 2FA modal appears
  },
): Promise<TarikDbCheckResult> {
  const allRows: TarikDbRow[] = [];

  try {
    // === Step 1: Build member management URL ===
    const baseUrl = panelUrl.replace(/\/+$/, '');
    const startDateUtc = toUtcIso(options.dateStart, false);
    const endDateUtc = toUtcIso(options.dateEnd, true);

    const PAGE_SIZE = 100;
    let memberUrl = `${baseUrl}/management/member?page=0&size=${PAGE_SIZE}&roleUser.equals=true` +
      `&createdDate.greaterThanOrEqual=${encodeURIComponent(startDateUtc)}` +
      `&createdDate.lessThanOrEqual=${encodeURIComponent(endDateUtc)}`;

    if (options.username) {
      memberUrl += `&username.contains=${encodeURIComponent(options.username)}`;
      onLog(`Navigating to member page (username: ${options.username})`);
    } else {
      onLog(`Navigating to member page (all members)`);
    }

    onLog(`Date range: ${options.dateStart} s/d ${options.dateEnd}`);
    onLog(`URL: ${memberUrl}`);

    // === Step 1: First load (initializes SPA + handles OTP if needed) ===
    await page.goto(memberUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    onLog('Member page loaded (1st load)');

    // Handle 2FA/OTP modal if it appears
    const otpHandled = await handleMidSessionOtp(page, onLog, options.twoFaSecret);
    if (otpHandled === 'needs_otp') {
      return { success: false, rows: [], error: 'OTP 2FA diperlukan. Tambahkan 2FA Secret di account settings atau submit OTP manual.' };
    }

    // === Step 1b: Second load of page=0 — ensures SPA properly applies date filters ===
    // NUKE SPA often ignores URL date params on first load (especially after OTP redirect).
    onLog('Re-loading page=0 to ensure date filters apply...');
    await navigateToMemberPage(page, memberUrl, onLog);

    // Handle OTP again just in case
    const otpAgain = await handleMidSessionOtp(page, onLog, options.twoFaSecret);
    if (otpAgain === 'needs_otp') {
      return { success: false, rows: [], error: 'OTP 2FA diperlukan setelah re-navigate.' };
    }

    // === Step 2: Wait for table ===
    await waitForMemberTableLoad(page, onLog);

    // === Step 3: Check for empty results ===
    const emptyEl = await page.$(NUKE_SELECTORS.member.tablePlaceholder);
    if (emptyEl) {
      const emptyText = await emptyEl.textContent();
      onLog(`No members found: ${emptyText?.trim() || 'No Data'}`, 'warning');
      return { success: true, rows: [], totalItems: 0 };
    }

    // === Step 4: Scrape all pages via direct URL navigation ===
    const maxPages = options.maxPages ?? 10;
    let currentPage = 0; // 0-indexed

    // Parse date range for post-scrape filtering (DD-MM-YYYY → Date objects)
    const filterStartDate = parseDdMmYyyy(options.dateStart);
    const filterEndDate = parseDdMmYyyy(options.dateEnd);
    // End date is inclusive (end of day)
    if (filterEndDate) filterEndDate.setHours(23, 59, 59, 999);

    while (currentPage < maxPages) {
      const pageRows = await scrapeMemberPage(page);

      if (pageRows.length === 0) break;

      // Filter rows: only include rows with JoinDate within the requested date range
      const filtered = filterRowsByDate(pageRows, filterStartDate, filterEndDate);
      allRows.push(...filtered);

      if (filtered.length < pageRows.length) {
        onLog(`Page ${currentPage + 1}: scraped ${pageRows.length}, kept ${filtered.length} in date range (total: ${allRows.length})`);
      } else {
        onLog(`Page ${currentPage + 1}: scraped ${pageRows.length} row(s) (total: ${allRows.length})`);
      }

      // Less than PAGE_SIZE rows = last page
      if (pageRows.length < PAGE_SIZE) break;

      // Navigate to next page via URL (not click) to preserve date params
      currentPage++;
      const nextUrl = memberUrl.replace('page=0', `page=${currentPage}`);
      onLog(`Page ${currentPage + 1} URL: ${nextUrl}`);
      await navigateToMemberPage(page, nextUrl, onLog);
      await waitForMemberTableLoad(page, onLog);
    }

    onLog(`TARIK DB complete! ${allRows.length} member(s) found`, 'success');
    return { success: true, rows: allRows, totalItems: allRows.length };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`TARIK DB error: ${msg}`, 'error');
    return { success: false, rows: allRows, error: msg };
  }
}

// ============================================================
// Navigation Helper
// ============================================================

/**
 * Navigate to member page URL and wait for the API data to load.
 * Uses waitForResponse to ensure the actual member API call completes.
 */
async function navigateToMemberPage(page: Page, url: string, onLog: LogCallback): Promise<void> {
  // Wait for both navigation AND the member API response
  await Promise.all([
    page.waitForResponse(
      resp => resp.url().includes('/management/member') && resp.request().resourceType() === 'xhr' || resp.request().resourceType() === 'fetch',
      { timeout: 30000 },
    ).catch(() => {
      // Fallback: API response pattern might differ, just wait
    }),
    page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }),
  ]);
  await page.waitForTimeout(2000);

  // Verify URL contains date filters
  const currentUrl = page.url();
  onLog(`Loaded URL: ${currentUrl.substring(currentUrl.indexOf('?'))}`);
}

// ============================================================
// Date Filtering Helpers
// ============================================================

/**
 * Parse DD-MM-YYYY string to Date object (local time, start of day).
 */
function parseDdMmYyyy(ddmmyyyy: string): Date | null {
  const parts = ddmmyyyy.split('-');
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1; // 0-indexed month
  const y = parseInt(parts[2], 10);
  return new Date(y, m, d, 0, 0, 0, 0);
}

/**
 * Filter scraped rows to only include those with JoinDate within the specified range.
 * Handles various date formats from the NUKE panel (e.g. "2026-03-01 10:30:00", "01/03/2026", etc.)
 */
function filterRowsByDate(rows: TarikDbRow[], startDate: Date | null, endDate: Date | null): TarikDbRow[] {
  if (!startDate && !endDate) return rows;

  return rows.filter(row => {
    if (!row.joinDate || row.joinDate === '-') return true; // keep rows without date

    const rowDate = parseJoinDate(row.joinDate);
    if (!rowDate) return true; // can't parse → keep it

    if (startDate && rowDate < startDate) return false;
    if (endDate && rowDate > endDate) return false;
    return true;
  });
}

/**
 * Parse JoinDate from NUKE panel table. Handles:
 * - "2026-03-01 10:30:00" (ISO-like)
 * - "01/03/2026 10:30:00" (DD/MM/YYYY)
 * - "01-03-2026 10:30:00" (DD-MM-YYYY)
 */
function parseJoinDate(dateStr: string): Date | null {
  const trimmed = dateStr.trim();
  if (!trimmed || trimmed === '-') return null;

  // Try ISO-like format: "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm:ss"
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (isoMatch) {
    return new Date(
      parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]),
      parseInt(isoMatch[4]), parseInt(isoMatch[5]), parseInt(isoMatch[6]),
    );
  }

  // Try DD/MM/YYYY or DD-MM-YYYY format
  const dmyMatch = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (dmyMatch) {
    return new Date(parseInt(dmyMatch[3]), parseInt(dmyMatch[2]) - 1, parseInt(dmyMatch[1]));
  }

  return null;
}

// ============================================================
// Mid-Session OTP Handler
// ============================================================

/**
 * Detect and handle 2FA/OTP modal that appears when navigating to sensitive pages.
 * Returns 'handled' if OTP was auto-filled, 'no_otp' if no modal, 'needs_otp' if manual OTP needed.
 *
 * Retries up to 3 times (matching Python reference behavior).
 */
export async function handleMidSessionOtp(
  page: Page,
  onLog: LogCallback,
  twoFaSecret?: string,
): Promise<'handled' | 'no_otp' | 'needs_otp'> {
  const S = NUKE_SELECTORS;
  const MAX_OTP_ATTEMPTS = 3;

  // Check for OTP modal (6-digit or single-input)
  let otpDetected = false;

  // Check 6-digit inputs
  let sixDigitInputs = await page.$$(S.otpSixDigit.inputs);
  if (sixDigitInputs.length < 6) {
    sixDigitInputs = await page.$$(S.otpSixDigit.inputsFallback);
  }
  if (sixDigitInputs.length >= 6) {
    otpDetected = true;
  }

  // Check single-input OTP modal
  if (!otpDetected) {
    const hasModal = await page.$(S.otpInput.modal);
    if (hasModal) {
      const otpInputEl = await page.$(S.otpInput.input);
      if (otpInputEl) otpDetected = true;
    }
  }

  if (!otpDetected) return 'no_otp';

  onLog('2FA/OTP modal detected on member page', 'warning');

  if (!twoFaSecret) {
    onLog('No 2FA secret configured — cannot auto-fill OTP', 'error');
    return 'needs_otp';
  }

  for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt++) {
    // Generate time-corrected TOTP code (compensates for PC clock drift)
    const otpCode = await generateTOTP(twoFaSecret);
    onLog(`Generated TOTP code: ${otpCode} (attempt ${attempt}/${MAX_OTP_ATTEMPTS}, clock offset: ${getClockOffsetSeconds()}s)`);

    // Re-detect inputs (modal may have been refreshed)
    sixDigitInputs = await page.$$(S.otpSixDigit.inputs);
    if (sixDigitInputs.length < 6) {
      sixDigitInputs = await page.$$(S.otpSixDigit.inputsFallback);
    }

    if (sixDigitInputs.length >= 6) {
      // Fill via pressSequentially — most user-like keyboard approach
      onLog('Filling 6-digit OTP inputs via pressSequentially...');
      await fillOtpDigitsViaKeyboard(page, sixDigitInputs.slice(0, 6), otpCode, onLog);
    } else {
      onLog('Filling single OTP input...');
      await fillWithFallback(page, S.otpInput.input, S.otpInput.inputFallbacks, otpCode, { timeout: 10000 });
    }

    await page.waitForTimeout(500);

    // Intercept the OTP API request to log body + response status
    const reqPromise = page.waitForRequest(
      req => req.method() === 'POST' && req.url().includes('/validation/otp'),
      { timeout: 10000 },
    ).catch(() => null);
    const resPromise = page.waitForResponse(
      res => res.request().method() === 'POST' && res.url().includes('/validation/otp'),
      { timeout: 10000 },
    ).catch(() => null);

    // Click submit
    try {
      await clickWithFallback(page, S.otpSixDigit.submitButton, S.otpSixDigit.submitButtonFallbacks, { timeout: 5000 });
    } catch {
      await clickWithFallback(page, S.otpInput.submitButton, S.otpInput.submitButtonFallbacks, { timeout: 5000 });
    }

    onLog('OTP submitted, waiting for response...');

    const req = await reqPromise;
    if (req) {
      onLog(`OTP request: POST ${req.url()} | body: ${req.postData()}`);
    }

    // Wait for API response
    const res = await resPromise;
    let apiStatus = 0;
    let apiBody = '';
    if (res) {
      apiStatus = res.status();
      try { apiBody = await res.text(); } catch {}
      onLog(`OTP response: ${apiStatus} ${apiBody.substring(0, 200)}`);
    }

    await page.waitForTimeout(1000);

    // NUKE panel quirk: server may return 418 "Otp Token Invalid" but STILL accept the OTP.
    // Verify by navigating to member page and checking if OTP modal reappears.
    onLog('Verifying OTP by re-navigating to member page...');
    const baseUrl = page.url().replace(/\/(management|homepage|dashboard).*$/, '');
    const memberUrl = `${baseUrl}/management/member`;
    await page.goto(memberUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    // Check if OTP modal reappears
    const recheckInputs = await page.$$('.ant-modal-content input[maxlength="1"]');
    const modalReappeared = recheckInputs.length >= 6;

    if (!modalReappeared) {
      onLog('OTP verified! Modal did not reappear — OTP was accepted by server.', 'success');
      return 'handled';
    }

    // Modal reappeared = OTP was truly rejected
    onLog(`OTP truly rejected (modal reappeared). Attempt ${attempt}/${MAX_OTP_ATTEMPTS}`, 'warning');

    if (attempt >= MAX_OTP_ATTEMPTS) {
      onLog(`OTP failed after ${MAX_OTP_ATTEMPTS} attempts`, 'error');
      return 'needs_otp';
    }

    // Re-detect inputs for next attempt
    sixDigitInputs = recheckInputs;
  }

  return 'needs_otp';
}

// ============================================================
// Date Conversion Helpers (same pattern as nto-check-flow)
// ============================================================

/**
 * Convert DD-MM-YYYY to UTC ISO string for the NUKE panel URL.
 * The panel uses WIB timezone (UTC+7).
 *
 * Start of day: 00:00:00 WIB = previous day 17:00:00 UTC
 * End of day:   23:59:59.999 WIB = same day 16:59:59.999 UTC
 */
function toUtcIso(ddmmyyyy: string, isEndOfDay: boolean): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('-').map(Number);

  if (isEndOfDay) {
    return `${yyyy}-${pad(mm)}-${pad(dd)}T16:59:59.999Z`;
  } else {
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T17:00:00.000Z`;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ============================================================
// Table Loading & Scraping
// ============================================================

async function waitForMemberTableLoad(
  page: Page,
  onLog: LogCallback,
): Promise<void> {
  const S = NUKE_SELECTORS.member;

  // Wait for loading spinner to appear then disappear
  try {
    await page.waitForSelector(S.tableLoading, { state: 'attached', timeout: 3000 });
    onLog('Table loading...');
    await page.waitForSelector(S.tableLoading, { state: 'detached', timeout: 60000 });
  } catch {
    // No spinner seen, might already be loaded
  }

  // Wait for table body or "No Data"
  await page.waitForTimeout(1000);
  try {
    await Promise.race([
      page.waitForSelector(S.tableBody, { timeout: 10000, state: 'visible' }),
      page.waitForSelector(S.tablePlaceholder, { timeout: 10000, state: 'visible' }),
    ]);
  } catch {
    onLog('Table body not visible, waiting more...', 'warning');
    await page.waitForTimeout(2000);
  }
}

/**
 * Scrape a single page of the member table.
 * Extracts: Username (col 2), Wallet (col 6), Phone (col 7), JoinDate (col 10), Status (green color on ID cell)
 *
 * Status detection (from Python reference):
 * - Check ID cell (col 0) for green color rgb(3, 170, 20) or #03aa14
 * - If green → "REGIS + DEPO", else → "REGIS ONLY"
 */
async function scrapeMemberPage(page: Page): Promise<TarikDbRow[]> {
  const S = NUKE_SELECTORS.member;
  const rows: TarikDbRow[] = [];

  const tableRows = await page.$$(S.tableRows);
  for (const row of tableRows) {
    try {
      const cells = await row.$$('td');
      if (cells.length < 10) continue;

      // Col index 1 = Username
      const username = (await cells[1].textContent())?.trim() || '';

      // Col index 5 = Wallet
      const wallet = (await cells[5].textContent())?.trim() || '0';

      // Col index 6 = Phone
      const phone = (await cells[6].textContent())?.trim() || '-';

      // Col index 9 = Join Date
      const joinDate = (await cells[9].textContent())?.trim() || '-';

      // Status: check green color on ID cell (col 0)
      let status = 'REGIS ONLY';
      try {
        const isGreen = await cells[0].evaluate((el) => {
          const style = el.getAttribute('style') || '';
          if (style.includes('rgb(3, 170, 20)') || style.toLowerCase().includes('#03aa14') || style.toLowerCase().includes('green')) {
            return true;
          }
          const greenSpans = el.querySelectorAll("span[style*='rgb(3, 170, 20)'], span[style*='#03aa14']");
          return greenSpans.length > 0;
        });
        if (isGreen) status = 'REGIS + DEPO';
      } catch {
        // Default to REGIS ONLY if color detection fails
      }

      if (username) {
        rows.push({ username, wallet, phone, status, joinDate });
      }
    } catch (err) {
      logger.debug(`Error scraping member row: ${err}`);
    }
  }

  return rows;
}

/**
 * Fill 6-digit OTP inputs using cascade of strategies.
 * Each strategy is tried in order; if submit button stays disabled, next strategy is attempted.
 *
 * Strategy 1: Clipboard paste (Ctrl+V) — OTP components often have onPaste handler
 * Strategy 2: React _valueTracker reset + native setter — forces React to recognize value change
 * Strategy 3: Direct CDP Input.dispatchKeyEvent — explicit event properties
 * Strategy 4: pressSequentially — Playwright keyboard typing (previous approach, kept as fallback)
 */
async function fillOtpDigitsViaKeyboard(
  page: Page,
  _inputs: Awaited<ReturnType<Page['$$']>>,
  otpCode: string,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  const strategies = [
    { name: 'valueTracker-reset', fn: () => strategyValueTrackerReset(page, otpCode, onLog) },
    { name: 'clipboard-paste', fn: () => strategyClipboardPaste(page, otpCode, onLog) },
    { name: 'direct-cdp', fn: () => strategyDirectCDP(page, otpCode, onLog) },
    { name: 'pressSequentially', fn: () => strategyPressSequentially(page, otpCode, onLog) },
  ];

  for (let si = 0; si < strategies.length; si++) {
    const strategy = strategies[si];
    onLog(`Trying OTP strategy: ${strategy.name}...`);

    // Clear all inputs before each strategy to avoid state pollution
    if (si > 0) {
      await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const inputs = doc.querySelectorAll('.ant-modal-content input[maxlength="1"]');
        const ns = Object.getOwnPropertyDescriptor((globalThis as any).HTMLInputElement.prototype, 'value')?.set;
        for (const input of Array.from(inputs) as any[]) {
          if (ns) ns.call(input, '');
          if (input._valueTracker) input._valueTracker.setValue('x'); // force React to see change
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await page.waitForTimeout(300);
    }

    try {
      await strategy.fn();
    } catch (err) {
      onLog(`Strategy ${strategy.name} threw: ${err instanceof Error ? err.message : err}`, 'warning');
      continue;
    }

    await page.waitForTimeout(800);

    // Check if submit button became enabled (proves form state was updated)
    const submitEnabled = await checkSubmitEnabled(page);
    const filledValues = await readOtpInputValues(page);
    onLog(`[${strategy.name}] Submit: ${submitEnabled} | Inputs: "${filledValues}" (expected: ${otpCode})`);

    if (submitEnabled) {
      onLog(`Strategy "${strategy.name}" succeeded!`, 'success');
      return;
    }

    onLog(`Strategy "${strategy.name}" did not enable submit, trying next...`, 'warning');
  }

  onLog('All OTP strategies exhausted', 'error');
}

// ---- Strategy 1: Clipboard Paste ----
async function strategyClipboardPaste(
  page: Page,
  otpCode: string,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  // Grant clipboard permissions
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  } catch { /* may already be granted or not supported */ }

  // Write OTP to clipboard
  await page.evaluate(async (code: string) => {
    // Try Clipboard API
    if ((globalThis as any).navigator?.clipboard?.writeText) {
      await (globalThis as any).navigator.clipboard.writeText(code);
    } else {
      // Fallback: create temporary textarea
      const ta = (globalThis as any).document.createElement('textarea');
      ta.value = code;
      (globalThis as any).document.body.appendChild(ta);
      ta.select();
      (globalThis as any).document.execCommand('copy');
      (globalThis as any).document.body.removeChild(ta);
    }
  }, otpCode);

  // Click first input to focus
  const firstInput = page.locator('.ant-modal-content input[maxlength="1"]').first();
  await firstInput.click();
  await page.waitForTimeout(300);

  // Paste (Ctrl+V)
  await page.keyboard.press('Control+KeyV');
  await page.waitForTimeout(1000);

  onLog('Clipboard paste executed');
}

// ---- Strategy 2: React _valueTracker reset + native setter ----
async function strategyValueTrackerReset(
  page: Page,
  otpCode: string,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  const result = await page.evaluate((code: string) => {
    const doc = (globalThis as any).document;
    const inputs = doc.querySelectorAll('.ant-modal-content input[maxlength="1"]');
    if (inputs.length < 6) return `only ${inputs.length} inputs`;

    const nativeSetter = Object.getOwnPropertyDescriptor(
      (globalThis as any).HTMLInputElement.prototype, 'value',
    )?.set;
    if (!nativeSetter) return 'no native setter';

    for (let i = 0; i < 6 && i < code.length; i++) {
      const input = inputs[i] as any;
      input.focus();

      // Reset React's internal _valueTracker so it sees value as "changed"
      const tracker = input._valueTracker;
      if (tracker) tracker.setValue('');

      // Set via native setter (bypasses React's overloaded setter)
      nativeSetter.call(input, code[i]);

      // Dispatch events React listens to
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return 'ok';
  }, otpCode);

  onLog(`valueTracker reset result: ${result}`);
  await page.waitForTimeout(500);
}

// ---- Strategy 3: Direct CDP Input.dispatchKeyEvent with ALL properties ----
async function strategyDirectCDP(
  page: Page,
  otpCode: string,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  const client = await page.context().newCDPSession(page);

  // Focus first input
  const firstInput = page.locator('.ant-modal-content input[maxlength="1"]').first();
  await firstInput.click();
  await page.waitForTimeout(300);

  for (const digit of otpCode) {
    const keyCode = digit.charCodeAt(0);

    await client.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: digit,
      code: `Digit${digit}`,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      text: digit,
      unmodifiedText: digit,
    });

    await client.send('Input.dispatchKeyEvent', {
      type: 'char',
      key: digit,
      code: `Digit${digit}`,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      text: digit,
      unmodifiedText: digit,
    });

    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: digit,
      code: `Digit${digit}`,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });

    await page.waitForTimeout(250);
  }

  await client.detach();
  onLog('Direct CDP events dispatched');
  await page.waitForTimeout(500);
}

// ---- Strategy 4: pressSequentially (fallback) ----
async function strategyPressSequentially(
  page: Page,
  otpCode: string,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  const firstInput = page.locator('.ant-modal-content input[maxlength="1"]').first();
  await firstInput.click();
  await page.waitForTimeout(500);
  await firstInput.pressSequentially(otpCode, { delay: 300 });
  onLog('pressSequentially completed');
  await page.waitForTimeout(500);
}

// ---- Helpers ----
async function checkSubmitEnabled(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const btns = (globalThis as any).document.querySelectorAll('.ant-modal-footer button');
    for (const btn of Array.from(btns) as any[]) {
      if (btn.classList.contains('ant-btn-primary') || btn.textContent?.trim().toLowerCase() === 'submit') {
        return !btn.disabled;
      }
    }
    return false;
  });
}

async function readOtpInputValues(page: Page): Promise<string> {
  return page.evaluate(() => {
    const inputs = (globalThis as any).document.querySelectorAll('.ant-modal-content input[maxlength="1"]');
    return Array.from(inputs).map((el: any) => el.value).join('');
  });
}

async function hasMemberNextPage(page: Page): Promise<boolean> {
  const S = NUKE_SELECTORS.member;
  try {
    const nextBtn = await page.$(S.paginationNext);
    if (!nextBtn) return false;
    const isDisabled = await nextBtn.getAttribute('aria-disabled');
    const hasDisabledClass = await nextBtn.evaluate(
      el => el.classList.contains('ant-pagination-disabled'),
    );
    return isDisabled !== 'true' && !hasDisabledClass;
  } catch {
    return false;
  }
}

