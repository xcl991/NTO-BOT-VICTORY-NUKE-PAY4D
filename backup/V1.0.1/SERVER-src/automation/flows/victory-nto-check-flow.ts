import type { Page } from 'playwright';
import { VICTORY_SELECTORS } from '../selectors/victory-selectors';
import { clickWithFallback } from '../utils/retry-handler';
import logger from '../../utils/logger';
import type { NtoCheckResult, NtoRow } from './nto-check-flow';

const S = VICTORY_SELECTORS;

/**
 * Game category mapping: command keyword → text pattern to match in provider_name column.
 * Provider names look like "Pragmatic: Slots", "NLC: Slots", "PGSoft: Slots",
 * "Evolution: Casino", "Pragmatic: Casino", etc.
 */
export type VictoryGameCategory = 'SLOT' | 'SPORTS' | 'CASINO' | 'GAMES';

const CATEGORY_MATCH: Record<string, string> = {
  'SLOT': 'Slots',
  'SPORTS': 'Sport',
  'CASINO': 'Casino',
  'GAMES': 'Games',
};

/**
 * Victory NTO Check Flow (2-tab approach):
 *
 * 1. Navigate to /report/report-profit-loss/by-player
 * 2. Set start & end date via MUI DatePicker
 * 3. For each username:
 *    a. Clear & fill username input, click Filter
 *    b. Wait for table to load
 *    c. Find row with matching username in results
 *    d. Click username link → opens NEW tab with provider/category breakdown
 *    e. In new tab: filter rows by game category, sum bet_amount
 *    f. Close new tab, switch back to original tab
 * 4. Return collected rows
 *
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
    gameCategory: VictoryGameCategory;
    maxPages?: number;
  },
): Promise<NtoCheckResult> {
  const allRows: NtoRow[] = [];
  const categoryMatch = CATEGORY_MATCH[options.gameCategory] || 'Slots';

  try {
    // === Step 1: Navigate to report page ===
    const baseUrl = panelUrl.replace(/\/+$/, '').replace(/\/login\/?$/, '');
    const reportUrl = `${baseUrl}/report/report-profit-loss/by-player`;

    onLog(`Navigating to report: ${options.dateStart} s/d ${options.dateEnd}`);
    await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Set large viewport to show more content (like zoom out)
    await page.setViewportSize({ width: 2560, height: 1440 });
    onLog('Report page loaded (viewport 2560x1440)');

    // === Step 2: Set date range ===
    const startParts = parseDateParts(options.dateStart);
    const endParts = parseDateParts(options.dateEnd);

    onLog(`Setting date range: ${options.dateStart} - ${options.dateEnd}`);
    await setMuiDatePicker(page, S.report.startDate, S.report.startDateFallbacks, startParts, onLog);
    await setMuiDatePicker(page, S.report.endDate, S.report.endDateFallbacks, endParts, onLog);

    // Wait for dates to be fully committed before searching
    await page.waitForTimeout(500);

    // === Step 3: Loop through usernames ===
    for (let i = 0; i < options.usernames.length; i++) {
      const username = options.usernames[i];
      onLog(`[${i + 1}/${options.usernames.length}] Checking: ${username} (${options.gameCategory})`);

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

        // Find the username in the result table and click it
        const rowIndex = await findUsernameRowIndex(page, username);

        if (rowIndex === -1) {
          onLog(`"${username}": not found in results`, 'warning');
          allRows.push({ username, betCount: '0', userTO: '0', userNTO: '0' });
          continue;
        }

        // Click username link → opens new tab
        onLog(`Found "${username}" at row ${rowIndex}, clicking to open detail...`);
        const detailResult = await openDetailAndScrape(page, rowIndex, categoryMatch, onLog);

        if (detailResult) {
          allRows.push({
            username,
            betCount: String(detailResult.matchingProviders),
            userTO: detailResult.totalBetAmount,
            userNTO: '0',
          });
          onLog(`"${username}": ${options.gameCategory} bet_amount = ${detailResult.totalBetAmount} (${detailResult.matchingProviders} provider(s))`, 'success');
        } else {
          allRows.push({ username, betCount: '0', userTO: '0', userNTO: '0' });
          onLog(`"${username}": no ${options.gameCategory} data found`, 'warning');
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
// Detail Page (New Tab) — Provider/Game Category Breakdown
// ============================================================

interface DetailResult {
  totalBetAmount: string;    // Summed bet_amount from matching category rows
  matchingProviders: number; // Number of rows that matched the category
}

/**
 * Click a username link to open detail tab, scrape matching category rows,
 * then close the tab and return to the original page.
 */
async function openDetailAndScrape(
  page: Page,
  rowIndex: number,
  categoryMatch: string,
  onLog: (msg: string, level?: string) => void,
): Promise<DetailResult | null> {
  const context = page.context();
  const originalPages = context.pages();

  // Click the username link (should open a new tab)
  const usernameCell = await page.$(S.report.cellUsername(rowIndex));
  if (!usernameCell) return null;

  const usernameLink = await usernameCell.$('a');
  if (!usernameLink) {
    onLog('Username is not a clickable link, skipping detail', 'warning');
    return null;
  }

  // Listen for new page (tab) before clicking
  const newPagePromise = context.waitForEvent('page', { timeout: 15000 });
  await usernameLink.click();

  let detailPage: Page;
  try {
    detailPage = await newPagePromise;
  } catch {
    onLog('New tab did not open after clicking username', 'warning');
    return null;
  }

  try {
    // Wait for the detail page to load
    await detailPage.waitForLoadState('domcontentloaded', { timeout: 15000 });
    await detailPage.waitForTimeout(3000);

    // Set large viewport on detail tab
    await detailPage.setViewportSize({ width: 2560, height: 1440 });

    // Wait for detail table to load
    await waitForDetailTableLoad(detailPage, onLog);

    // Scrape matching rows
    const result = await scrapeDetailTable(detailPage, categoryMatch, onLog);
    return result;

  } finally {
    // Always close the detail tab and switch back
    try {
      await detailPage.close();
    } catch {
      // Tab might already be closed
    }
    // Bring focus back to original page
    await page.bringToFront();
    await page.waitForTimeout(500);
  }
}

/**
 * Wait for the detail page table to finish loading.
 */
async function waitForDetailTableLoad(
  page: Page,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  // Wait for loading spinner to appear then disappear
  try {
    await page.waitForSelector(S.detail.loadingSpinner, { state: 'attached', timeout: 3000 });
    onLog('Detail table loading...');
    await page.waitForSelector(S.detail.loadingSpinner, { state: 'detached', timeout: 60000 });
  } catch {
    // No spinner seen, might already be loaded
  }

  // Wait for table body
  await page.waitForTimeout(1000);
  try {
    await page.waitForSelector(S.detail.tableBody, { timeout: 10000, state: 'visible' });
  } catch {
    onLog('Detail table body not visible', 'warning');
    await page.waitForTimeout(2000);
  }
}

/**
 * Scrape the detail table for rows matching the game category.
 *
 * Each row has a provider_name like "Pragmatic: Slots", "NLC: Slots", "Evolution: Casino".
 * We match rows where provider_name contains the categoryMatch string (e.g., "Slots").
 * Then sum bet_amount from all matching rows.
 */
async function scrapeDetailTable(
  page: Page,
  categoryMatch: string,
  onLog: (msg: string, level?: string) => void,
): Promise<DetailResult | null> {
  let totalBet = 0;
  let matchingProviders = 0;
  const categoryLower = categoryMatch.toLowerCase();

  // Iterate through rows until no more found
  for (let n = 0; n < 100; n++) {
    const rowEl = await page.$(S.detail.tableRow(n));
    if (!rowEl) break;

    try {
      // Read provider_name
      const providerCell = await page.$(S.detail.cellProviderName(n));
      if (!providerCell) continue;

      const providerText = ((await providerCell.textContent()) || '').trim();

      // Check if this row's category matches
      if (!providerText.toLowerCase().includes(categoryLower)) continue;

      // Read valid_bet_amount
      const validBetCell = await page.$(S.detail.cellValidBetAmount(n));
      if (!validBetCell) continue;

      const validBetText = await extractAmountText(validBetCell);
      const betAmount = parseIndonesianNumber(validBetText);

      onLog(`  ${providerText}: valid_bet = ${validBetText} (${betAmount})`);
      totalBet += betAmount;
      matchingProviders++;
    } catch (err) {
      logger.debug(`Error scraping Victory detail row ${n}: ${err}`);
    }
  }

  if (matchingProviders === 0) return null;

  return {
    totalBetAmount: totalBet.toLocaleString('id-ID'),
    matchingProviders,
  };
}

// ============================================================
// Find Username in First Table
// ============================================================

/**
 * Find the row index of a username in the by-player table.
 * Returns -1 if not found.
 */
async function findUsernameRowIndex(page: Page, targetUsername: string): Promise<number> {
  const targetLower = targetUsername.toLowerCase();

  for (let n = 0; n < 100; n++) {
    const rowEl = await page.$(S.report.tableRow(n));
    if (!rowEl) break;

    const usernameCell = await page.$(S.report.cellUsername(n));
    if (!usernameCell) continue;

    const usernameLink = await usernameCell.$('a');
    const cellText = usernameLink
      ? ((await usernameLink.textContent()) || '').trim()
      : ((await usernameCell.textContent()) || '').trim();

    if (cellText.toLowerCase() === targetLower) {
      return n;
    }
  }

  return -1;
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
 * 2. Double-click to select the day segment
 * 3. Type "DD" → auto-advances to month segment
 * 4. Type "MM" → auto-advances to year segment
 * 5. Type "YYYY"
 * 6. Escape → close any calendar popup
 * 7. Tab → blur to commit value
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
// Table Loading
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

// ============================================================
// Number Parsing
// ============================================================

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
 * Parse Indonesian number format to a float.
 * Indonesian: 2.705.760,00 (dot = thousands, comma = decimal)
 * Also handles plain numbers without formatting.
 */
function parseIndonesianNumber(value: string): number {
  if (!value || value === '0') return 0;

  let cleaned = value.trim();

  // Check if it uses Indonesian format (has dots as thousands separators)
  if (/^\-?[\d.]+,\d{2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
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
