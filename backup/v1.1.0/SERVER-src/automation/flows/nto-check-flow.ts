import type { Page } from 'playwright';
import { NUKE_SELECTORS } from '../selectors/nuke-selectors';
import { clickWithFallback, fillWithFallback } from '../utils/retry-handler';
import { handleMidSessionOtp } from './nuke-tarikdb-check-flow';
import logger from '../../utils/logger';

export type GameCategory = 'SPORTS' | 'CASINO' | 'GAMES' | 'SLOT';

export interface NtoRow {
  username: string;
  betCount: string;
  userTO: string;
  userNTO: string;
}

export interface NtoCheckResult {
  success: boolean;
  rows: NtoRow[];
  summary?: NtoRow;
  totalItems?: number;
  error?: string;
}

/**
 * NUKE NTO Check Flow (v2):
 *
 * 1. Navigate to /report/overall? with date params in URL
 * 2. Wait for page load
 * 3. Select game category filter (SLOT/SPORTS/CASINO/GAMES)
 * 4. For each username:
 *    a. Clear username input
 *    b. Fill username
 *    c. Click Filter
 *    d. Wait for table
 *    e. Scrape rows
 * 5. Return all collected rows
 *
 * URL format:
 * /report/overall?page=0&size=40&startDate=2026-02-28T17:00:00.000Z&endDate=2026-03-02T16:59:59.999Z&summarized=true&summaryType=us2
 * Dates are WIB (UTC+7) converted to UTC ISO strings.
 */
export async function nukeNtoCheckFlow(
  page: Page,
  panelUrl: string,
  onLog: (msg: string, level?: string) => void,
  options: {
    dateStart: string;     // DD-MM-YYYY format
    dateEnd: string;       // DD-MM-YYYY format
    usernames: string[];   // usernames to check one by one
    gameCategory: GameCategory;
    maxPages?: number;     // max pages to scrape per username, default 5
    twoFaSecret?: string;  // TOTP secret for auto-OTP if 2FA modal appears
  },
): Promise<NtoCheckResult> {
  const allRows: NtoRow[] = [];

  try {
    // === Step 1: Build URL with date params ===
    const baseUrl = panelUrl.replace(/\/+$/, '');
    const startDateUtc = toUtcIso(options.dateStart, false);
    const endDateUtc = toUtcIso(options.dateEnd, true);

    const reportUrl = `${baseUrl}/report/overall?page=0&size=40` +
      `&startDate=${encodeURIComponent(startDateUtc)}` +
      `&endDate=${encodeURIComponent(endDateUtc)}` +
      `&summarized=true&summaryType=us2`;

    onLog(`Navigating to report: ${options.dateStart} s/d ${options.dateEnd}`);
    await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    onLog('Report page loaded');

    // Handle 2FA/OTP modal if it appears
    const otpHandled = await handleMidSessionOtp(page, onLog, options.twoFaSecret);
    if (otpHandled === 'needs_otp') {
      return { success: false, rows: [], error: 'OTP 2FA diperlukan. Tambahkan 2FA Secret di account settings atau submit OTP manual.' };
    }
    if (otpHandled === 'handled') {
      // OTP was handled, re-navigate to report page to ensure filters apply
      onLog('OTP handled, re-navigating to report page...');
      await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);

      // Check OTP again just in case
      const otpAgain = await handleMidSessionOtp(page, onLog, options.twoFaSecret);
      if (otpAgain === 'needs_otp') {
        return { success: false, rows: [], error: 'OTP 2FA diperlukan setelah re-navigate.' };
      }
    }

    // === Step 2: Select game category filter ===
    onLog(`Selecting game: ${options.gameCategory}`);
    await selectGameCategory(page, options.gameCategory, onLog);

    // === Step 3: Click Filter first (apply game filter, close dropdown) ===
    const S = NUKE_SELECTORS.report;
    onLog('Applying game filter...');
    await clickWithFallback(page, S.filterButton, S.filterButtonFallbacks, { timeout: 5000 });
    await waitForTableLoad(page, onLog);
    onLog('Game filter applied, table loaded');

    // === Step 4: Loop through usernames one by one ===
    const maxPages = options.maxPages ?? 5;

    for (let i = 0; i < options.usernames.length; i++) {
      const username = options.usernames[i];
      onLog(`[${i + 1}/${options.usernames.length}] Checking: ${username}`);

      try {
        // Clear the username input field
        await clearUsernameInput(page);
        await page.waitForTimeout(300);

        // Fill with current username
        await fillWithFallback(page, S.usernameInput, S.usernameInputFallbacks, username, { timeout: 5000 });
        await page.waitForTimeout(300);

        // Click Filter button
        onLog(`Clicking Filter for "${username}"...`);
        await clickWithFallback(page, S.filterButton, S.filterButtonFallbacks, { timeout: 5000 });

        // Wait for table to load
        await waitForTableLoad(page, onLog);

        // Scrape results (paginate if needed)
        const userRows = await scrapeAllPages(page, maxPages, onLog);

        if (userRows.length > 0) {
          allRows.push(...userRows);
          onLog(`"${username}": ${userRows.length} row(s) found`, 'success');
        } else {
          // No data - add empty row so we still show this username
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
// Date Conversion Helpers
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
    // 23:59:59.999 WIB → same day 16:59:59.999 UTC
    return `${yyyy}-${pad(mm)}-${pad(dd)}T16:59:59.999Z`;
  } else {
    // 00:00:00 WIB → previous day 17:00:00 UTC
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T17:00:00.000Z`;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ============================================================
// Game Category Selection
// ============================================================

/**
 * Select a game category from the Ant Design multiple select dropdown.
 */
async function selectGameCategory(
  page: Page,
  category: GameCategory,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  const S = NUKE_SELECTORS.report;

  // Wait for game filter to be present, then click to open dropdown
  try {
    let opened = false;

    // Wait for the game filter element to render (up to 10s)
    try {
      await page.waitForSelector(S.gameFilter, { timeout: 10000, state: 'visible' });
    } catch {
      // Fallback: wait for any ant-select with "Game" placeholder
      onLog('Primary game filter selector not found, trying fallback...', 'warning');
    }

    // Try primary selector
    const gameSelect = await page.$(S.gameFilter);
    if (gameSelect) {
      await gameSelect.click();
      opened = true;
    }

    // Fallback: find select by placeholder text "Filter by Game Name"
    if (!opened) {
      const selects = await page.$$('.ant-select');
      for (const sel of selects) {
        const placeholder = await sel.$('.ant-select-search__field__placeholder');
        if (placeholder) {
          const text = await placeholder.textContent();
          if (text?.toLowerCase().includes('game')) {
            await sel.click();
            opened = true;
            break;
          }
        }
      }
    }

    // Fallback 2: click the selection area directly
    if (!opened) {
      const multiSelect = await page.$('.ant-select-selection--multiple');
      if (multiSelect) {
        await multiSelect.click();
        opened = true;
      }
    }

    if (!opened) {
      onLog('Could not find game filter dropdown', 'warning');
      return;
    }

    await page.waitForTimeout(800);
  } catch (e) {
    onLog(`Could not open game filter: ${e}`, 'warning');
    return;
  }

  // Wait for tree dropdown to appear
  try {
    await page.waitForSelector(S.gameTreeTitle, { timeout: 5000, state: 'visible' });
  } catch {
    onLog('Game tree dropdown not visible after click', 'warning');
    return;
  }

  // Find the matching tree node and click its checkbox
  try {
    const titles = await page.$$(S.gameTreeTitle);
    onLog(`Found ${titles.length} game options in tree`);

    let selected = false;
    for (const titleEl of titles) {
      const text = (await titleEl.textContent())?.trim().toUpperCase();
      if (text === category.toUpperCase()) {
        // Navigate up to the <li> and click its checkbox
        const checkbox = await titleEl.evaluateHandle(el => {
          const li = el.closest('li');
          return li?.querySelector('.ant-select-tree-checkbox') || null;
        });

        if (checkbox && (checkbox as any).asElement()) {
          await (checkbox as any).asElement().click();
        } else {
          // Fallback: click the title itself
          await titleEl.click();
        }

        onLog(`Game "${category}" selected`);
        selected = true;
        break;
      }
    }

    if (!selected) {
      const available: string[] = [];
      for (const t of titles) {
        const text = (await t.textContent())?.trim();
        if (text) available.push(text);
      }
      onLog(`Game "${category}" not found. Available: ${available.join(', ')}`, 'warning');
    }
  } catch (e) {
    onLog(`Error selecting game: ${e}`, 'warning');
  }

  await page.waitForTimeout(500);

  // Close dropdown with Escape (don't click body - it may trigger navigation)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

// ============================================================
// Username Input Helpers
// ============================================================

/**
 * Clear the username search input field.
 */
async function clearUsernameInput(page: Page): Promise<void> {
  const S = NUKE_SELECTORS.report;

  const input = await page.$(S.usernameInput)
    || await page.$('input#userUsername')
    || await page.$('input[placeholder*="Search username"]');

  if (input) {
    await input.click({ clickCount: 3 }); // Select all
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    // Double-check it's empty
    await input.fill('');
  }
}

// ============================================================
// Table Loading & Scraping
// ============================================================

/**
 * Wait for the table to finish loading.
 */
async function waitForTableLoad(
  page: Page,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  const S = NUKE_SELECTORS.report;

  // Wait for loading spinner to appear then disappear
  try {
    await page.waitForSelector(S.tableLoading, { state: 'attached', timeout: 3000 });
    onLog('Table loading...');
    await page.waitForSelector(S.tableLoading, { state: 'detached', timeout: 60000 });
  } catch {
    // No spinner seen, might already be loaded
  }

  // Wait for either table body or "No Data" placeholder
  await page.waitForTimeout(1000);
  try {
    await Promise.race([
      page.waitForSelector(S.tableBody, { timeout: 10000, state: 'visible' }),
      page.waitForSelector('.ant-empty-description', { timeout: 10000, state: 'visible' }),
    ]);
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
 * Scrape a single page of the table.
 * Extracts: Username, Bet Count, User TO, User NTO
 */
async function scrapeTablePage(page: Page): Promise<NtoRow[]> {
  const S = NUKE_SELECTORS.report;
  const rows: NtoRow[] = [];

  const tableRows = await page.$$(S.tableRows);
  for (const row of tableRows) {
    try {
      const rowKey = await row.getAttribute('data-row-key');
      if (rowKey === 'SUMMARY') continue;

      const cells = await row.$$('td');
      if (cells.length < 4) continue;

      // Col 0 = Username
      const usernameEl = await cells[0].$('a');
      const username = usernameEl
        ? (await usernameEl.textContent())?.trim() || ''
        : (await cells[0].textContent())?.trim() || '';

      // Col 1 = Bet Count
      const betCountEl = await cells[1].$('a');
      const betCount = betCountEl
        ? (await betCountEl.textContent())?.trim() || '0'
        : (await cells[1].textContent())?.trim() || '0';

      // Col 2 = User TO
      const toEl = await cells[2].$('span.custom-color-bordered > span')
        || await cells[2].$('span > span');
      const userTO = toEl
        ? (await toEl.textContent())?.trim() || '0'
        : (await cells[2].textContent())?.trim() || '0';

      // Col 3 = User NTO
      const ntoEl = await cells[3].$('span.custom-color-bordered > span')
        || await cells[3].$('span > span');
      const userNTO = ntoEl
        ? (await ntoEl.textContent())?.trim() || '0'
        : (await cells[3].textContent())?.trim() || '0';

      if (username) {
        rows.push({ username, betCount, userTO, userNTO });
      }
    } catch (err) {
      logger.debug(`Error scraping row: ${err}`);
    }
  }

  return rows;
}

/**
 * Check if there's a next page.
 */
async function hasNextPage(page: Page): Promise<boolean> {
  const S = NUKE_SELECTORS.report;
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

/**
 * Click next page button.
 */
async function goToNextPage(page: Page): Promise<void> {
  const S = NUKE_SELECTORS.report;
  const nextBtn = await page.$(S.paginationNext);
  if (nextBtn) {
    await nextBtn.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Take a screenshot of the report table area.
 */
export async function screenshotReportTable(
  page: Page,
  savePath: string,
): Promise<string> {
  const tableEl = await page.$('.ant-table-wrapper');
  if (tableEl) {
    await tableEl.screenshot({ path: savePath });
  } else {
    await page.screenshot({ path: savePath, fullPage: false });
  }
  return savePath;
}
