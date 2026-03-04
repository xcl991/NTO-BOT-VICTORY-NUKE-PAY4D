import type { Page } from 'playwright';
import { VICTORY_SELECTORS } from '../selectors/victory-selectors';
import { clickWithFallback } from '../utils/retry-handler';
import logger from '../../utils/logger';
import type { NtoCheckResult, NtoRow } from './nto-check-flow';

const S = VICTORY_SELECTORS;

/**
 * Victory NTO Check Flow:
 *
 * 1. Navigate to /report/report-profit-loss/by-player
 * 2. Set start date (DD/MM/YYYY format) via MUI DatePicker
 * 3. Set end date (DD/MM/YYYY format) via MUI DatePicker
 * 4. For each username:
 *    a. Clear username search input
 *    b. Type username
 *    c. Press Enter to trigger search
 *    d. Wait for table to update
 *    e. Scrape all rows using data-testid pattern
 *    f. Handle pagination if exists
 * 5. Return collected rows
 *
 * Victory has NO game category filter - report shows all games combined.
 * Number format: Indonesian locale (2.705.760,00 = dot thousands, comma decimal)
 */
export async function victoryNtoCheckFlow(
  page: Page,
  panelUrl: string,
  onLog: (msg: string, level?: string) => void,
  options: {
    dateStart: string;     // DD-MM-YYYY format
    dateEnd: string;       // DD-MM-YYYY format
    usernames: string[];
    maxPages?: number;
  },
): Promise<NtoCheckResult> {
  const allRows: NtoRow[] = [];

  try {
    // === Step 1: Navigate to report page ===
    const baseUrl = panelUrl.replace(/\/+$/, '').replace(/\/login\/?$/, '');
    const reportUrl = `${baseUrl}/report/report-profit-loss/by-player`;

    onLog(`Navigating to report: ${options.dateStart} s/d ${options.dateEnd}`);
    await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    onLog('Report page loaded');

    // === Step 2: Set date range ===
    const startParts = parseDateParts(options.dateStart);
    const endParts = parseDateParts(options.dateEnd);

    onLog(`Setting date range: ${options.dateStart} - ${options.dateEnd}`);
    await setMuiDatePicker(page, S.report.startDate, S.report.startDateFallbacks, startParts, onLog);
    await setMuiDatePicker(page, S.report.endDate, S.report.endDateFallbacks, endParts, onLog);

    // Wait for dates to be fully committed before searching
    await page.waitForTimeout(500);

    // === Step 3: Loop through usernames ===
    const maxPages = options.maxPages ?? 5;

    for (let i = 0; i < options.usernames.length; i++) {
      const username = options.usernames[i];
      onLog(`[${i + 1}/${options.usernames.length}] Checking: ${username}`);

      try {
        // Clear username input
        await clearUsernameInput(page);
        await page.waitForTimeout(300);

        // Fill username
        const usernameInput = await findUsernameInput(page);
        if (!usernameInput) {
          throw new Error('Username input not found');
        }
        await usernameInput.fill(username);
        await page.waitForTimeout(300);

        // Click Filter button to trigger search
        onLog(`Clicking Filter for "${username}"...`);
        await clickWithFallback(page, S.report.filterButton, S.report.filterButtonFallbacks, { timeout: 5000 });

        // Wait for table to update
        await waitForTableLoad(page, onLog);

        // Scrape results (paginate if needed)
        const userRows = await scrapeAllPages(page, maxPages, onLog);

        if (userRows.length > 0) {
          allRows.push(...userRows);
          onLog(`"${username}": ${userRows.length} row(s) found`, 'success');
        } else {
          allRows.push({ username, betCount: '0', userTO: '0', userNTO: '0' });
          onLog(`"${username}": no data found`, 'warning');
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        onLog(`"${username}": error - ${errMsg}`, 'error');
        allRows.push({ username, betCount: '-', userTO: 'ERR', userNTO: 'ERR' });
      }
    }

    onLog(`NTO check complete! ${allRows.length} total rows from ${options.usernames.length} username(s)`, 'success');
    return { success: true, rows: allRows, totalItems: allRows.length };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`NTO check error: ${msg}`, 'error');
    return { success: false, rows: allRows, error: msg };
  }
}

// ============================================================
// Date Helpers
// ============================================================

/**
 * Parse DD-MM-YYYY into [dd, mm, yyyy] parts.
 */
function parseDateParts(ddmmyyyy: string): { dd: string; mm: string; yyyy: string } {
  const [dd, mm, yyyy] = ddmmyyyy.split('-');
  return { dd, mm, yyyy };
}

/**
 * Set a MUI DatePicker value using segment-based input.
 *
 * MUI DatePicker uses segmented date input (DD/MM/YYYY).
 * Each segment (day, month, year) is individually selectable.
 *
 * Strategy:
 * 1. Click on the far-left of the input (position x=5) to target the day segment
 * 2. Press Home to ensure cursor is on the day segment
 * 3. Double-click to select the day segment
 * 4. Type "DD" → auto-advances to month segment
 * 5. Type "MM" → auto-advances to year segment
 * 6. Type "YYYY"
 * 7. Escape → close any calendar popup
 * 8. Tab → blur to commit value
 */
async function setMuiDatePicker(
  page: Page,
  primary: string,
  fallbacks: readonly string[],
  dateParts: { dd: string; mm: string; yyyy: string },
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  const allSelectors = [primary, ...fallbacks];
  let input = null;

  for (const selector of allSelectors) {
    input = await page.$(selector);
    if (input) break;
  }

  if (!input) {
    onLog(`Date picker not found: ${primary}`, 'warning');
    return;
  }

  // Click on the far-left of the input to land on the day segment
  const box = await input.boundingBox();
  if (box) {
    await page.mouse.click(box.x + 5, box.y + box.height / 2);
  } else {
    await input.click();
  }
  // Wait 600ms then click again to select the day segment
  await page.waitForTimeout(600);
  if (box) {
    await page.mouse.click(box.x + 5, box.y + box.height / 2);
  } else {
    await input.click();
  }
  await page.waitForTimeout(300);

  // Type day → MUI auto-advances to month segment
  await page.keyboard.type(dateParts.dd, { delay: 50 });
  await page.waitForTimeout(200);

  // Type month → MUI auto-advances to year segment
  await page.keyboard.type(dateParts.mm, { delay: 50 });
  await page.waitForTimeout(200);

  // Type year
  await page.keyboard.type(dateParts.yyyy, { delay: 50 });
  await page.waitForTimeout(300);

  // Close any calendar popup
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Tab out to commit value
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);

  // Verify
  const actualValue = await input.inputValue().catch(() => 'unknown');
  const expected = `${dateParts.dd}/${dateParts.mm}/${dateParts.yyyy}`;
  onLog(`Date ${primary}: wanted "${expected}", got "${actualValue}"`);
}

// ============================================================
// Username Input Helpers
// ============================================================

/**
 * Find the username search input.
 */
async function findUsernameInput(page: Page) {
  const allSelectors = [S.report.usernameInput, ...S.report.usernameInputFallbacks];
  for (const selector of allSelectors) {
    const el = await page.$(selector);
    if (el) return el;
  }
  return null;
}

/**
 * Clear the username search input.
 */
async function clearUsernameInput(page: Page): Promise<void> {
  const input = await findUsernameInput(page);
  if (input) {
    await input.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    await input.fill('');
  }
}

// ============================================================
// Table Loading & Scraping
// ============================================================

/**
 * Wait for the MUI table to finish loading.
 */
async function waitForTableLoad(
  page: Page,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  // Wait for loading spinner to appear then disappear
  try {
    await page.waitForSelector(S.report.loadingSpinner, { state: 'attached', timeout: 3000 });
    onLog('Table loading...');
    await page.waitForSelector(S.report.loadingSpinner, { state: 'detached', timeout: 60000 });
  } catch {
    // No spinner seen, might already be loaded
  }

  // Wait for table body to appear
  await page.waitForTimeout(1000);
  try {
    await page.waitForSelector(S.report.tableBody, { timeout: 10000, state: 'visible' });
  } catch {
    onLog('Table body not visible, waiting more...', 'warning');
    await page.waitForTimeout(2000);
  }
}

/**
 * Scrape all pages of the current table view.
 */
async function scrapeAllPages(
  page: Page,
  maxPages: number,
  onLog: (msg: string, level?: string) => void,
): Promise<NtoRow[]> {
  const allRows: NtoRow[] = [];
  let currentPage = 1;

  while (currentPage <= maxPages) {
    const pageRows = await scrapeTablePage(page);

    if (pageRows.length === 0) break;

    allRows.push(...pageRows);

    // Check for next page
    if (!await hasNextPage(page)) break;

    await goToNextPage(page);
    await waitForTableLoad(page, onLog);
    currentPage++;
  }

  return allRows;
}

/**
 * Scrape a single page of the MUI table using data-testid attributes.
 *
 * Cells use pattern: data-testid="tablerow-{N}-{column}"
 * - username: link text inside the cell
 * - bet_count: text content
 * - valid_bet_amount: span.MuiTypography-amount text (= TO)
 * - player_winloss_amount: span.MuiTypography-amount text (= NTO)
 */
async function scrapeTablePage(page: Page): Promise<NtoRow[]> {
  const rows: NtoRow[] = [];

  // Try row indices 0..99 (stop when row doesn't exist)
  for (let n = 0; n < 100; n++) {
    const rowEl = await page.$(S.report.tableRow(n));
    if (!rowEl) break;

    try {
      // Username
      const usernameCell = await page.$(S.report.cellUsername(n));
      if (!usernameCell) continue;

      const usernameLink = await usernameCell.$('a');
      const username = usernameLink
        ? (await usernameLink.textContent())?.trim() || ''
        : (await usernameCell.textContent())?.trim() || '';

      if (!username) continue;

      // Bet Count
      const betCountCell = await page.$(S.report.cellBetCount(n));
      const betCount = betCountCell
        ? normalizeNumber((await betCountCell.textContent())?.trim() || '0')
        : '0';

      // Valid Bet Amount (= TO / Turnover)
      const validBetCell = await page.$(S.report.cellValidBet(n));
      const userTO = validBetCell
        ? normalizeNumber(await extractAmountText(validBetCell))
        : '0';

      // Player Win/Loss Amount (= NTO)
      const playerWinLossCell = await page.$(S.report.cellPlayerWinLoss(n));
      const userNTO = playerWinLossCell
        ? normalizeNumber(await extractAmountText(playerWinLossCell))
        : '0';

      rows.push({ username, betCount, userTO, userNTO });
    } catch (err) {
      logger.debug(`Error scraping Victory row ${n}: ${err}`);
    }
  }

  return rows;
}

/**
 * Extract amount text from a cell, preferring span.MuiTypography-amount if present.
 */
async function extractAmountText(cell: NonNullable<Awaited<ReturnType<Page['$']>>>): Promise<string> {
  // Try MuiTypography amount span first
  const amountSpan = await cell.$('span[class*="amount"]');
  if (amountSpan) {
    return (await amountSpan.textContent())?.trim() || '0';
  }

  // Fallback: direct text content
  return (await cell.textContent())?.trim() || '0';
}

/**
 * Normalize Indonesian number format to standard format.
 * Indonesian: 2.705.760,00 (dot = thousands, comma = decimal)
 * → Standard: 2705760.00
 */
function normalizeNumber(value: string): string {
  if (!value || value === '0') return '0';

  // Remove any whitespace
  let cleaned = value.trim();

  // Check if it uses Indonesian format (has dots as thousands separators)
  // Pattern: digits with dots and optional comma for decimals
  if (/^\-?[\d.]+,\d{2}$/.test(cleaned)) {
    // Indonesian format: remove dots (thousands), replace comma with dot (decimal)
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }

  return cleaned;
}

// ============================================================
// Pagination
// ============================================================

/**
 * Check if there's a next page available.
 */
async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const nextBtn = await page.$(S.report.paginationNextButton);
    if (!nextBtn) return false;

    const isDisabled = await nextBtn.isDisabled();
    return !isDisabled;
  } catch {
    return false;
  }
}

/**
 * Click the next page button.
 */
async function goToNextPage(page: Page): Promise<void> {
  const nextBtn = await page.$(S.report.paginationNextButton);
  if (nextBtn) {
    await nextBtn.click();
    await page.waitForTimeout(500);
  }
}

// ============================================================
// Screenshot
// ============================================================

/**
 * Take a screenshot of the Victory report table.
 */
export async function screenshotVictoryResults(
  page: Page,
  savePath: string,
): Promise<string> {
  const tableEl = await page.$(S.report.tableContainer);
  if (tableEl) {
    await tableEl.screenshot({ path: savePath });
  } else {
    await page.screenshot({ path: savePath, fullPage: false });
  }
  return savePath;
}
