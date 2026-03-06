import type { Page } from 'playwright';
import { PAY4D_SELECTORS } from '../selectors/pay4d-selectors';
import { clickWithFallback } from '../utils/retry-handler';
import logger from '../../utils/logger';
import type { NtoCheckResult, NtoRow } from './nto-check-flow';
import path from 'path';
import fs from 'fs';

/**
 * PAY4D game category labels as they appear in the multiselect dropdown.
 */
export type Pay4dGameCategory = 'Togel' | 'Slots' | 'Live Casino' | 'Sport' | 'Sabung' | 'Interactive';

const S = PAY4D_SELECTORS;

/**
 * PAY4D Win Lose All Check Flow:
 *
 * 1. Navigate to admin area
 * 2. Click "Win Lose All" menu button
 * 3. Open multiselect dropdown → deselect all → select desired category
 * 4. Set date range (From / To)
 * 5. Click Search
 * 6. Wait for summary table → click Download CSV
 * 7. Parse CSV → extract username + bet columns
 */
export async function pay4dNtoCheckFlow(
  page: Page,
  panelUrl: string,
  onLog: (msg: string, level?: string) => void,
  options: {
    dateStart: string;           // DD-MM-YYYY format (will be converted to YYYY-MM-DD)
    dateEnd: string;             // DD-MM-YYYY format
    gameCategory: Pay4dGameCategory;
    referal?: string;            // Optional referal filter
  },
): Promise<NtoCheckResult> {
  try {
    // === Step 1: Ensure we're on the admin page ===
    // After login + PIN, the page is already at /mimin/ with admin area loaded.
    // Only navigate if we're not already there.
    const currentUrl = page.url();
    if (!currentUrl.includes('/mimin/')) {
      const baseUrl = panelUrl.replace(/\/+$/, '');
      onLog(`Navigating to admin area...`);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    } else {
      onLog('Already on admin page');
    }

    // === Step 2: Click "Win Lose All" menu button ===
    onLog('Clicking "Win Lose All"...');
    await clickWithFallback(page, S.dashboard.winLoseAllButton, S.dashboard.winLoseAllButtonFallbacks, { timeout: 10000 });
    await page.waitForTimeout(1500);

    // Wait for Win Lose All content to appear
    try {
      await page.waitForSelector(S.winLoseAll.heading, { timeout: 10000, state: 'visible' });
    } catch {
      onLog('Win Lose All heading not found, continuing...', 'warning');
    }
    onLog('Win Lose All page loaded');

    // === Step 3: Select game category via multiselect ===
    onLog(`Selecting game category: ${options.gameCategory}`);
    await selectGameCategory(page, options.gameCategory, onLog);

    // === Step 4: Set date range ===
    const startDateFormatted = convertDdMmYyyyToYyyyMmDd(options.dateStart);
    const endDateFormatted = convertDdMmYyyyToYyyyMmDd(options.dateEnd);

    onLog(`Setting date range: ${startDateFormatted} to ${endDateFormatted}`);
    await setDateInput(page, S.winLoseAll.startDate, startDateFormatted);
    await setDateInput(page, S.winLoseAll.endDate, endDateFormatted);

    // === Step 5: Click Search ===
    onLog('Clicking Search...');
    await clickSearchButton(page);
    onLog('Search submitted, waiting for results...');

    // === Step 6: Wait for summary table to load ===
    await waitForResults(page, onLog);

    // === Step 7: Download CSV and parse ===
    onLog('Downloading CSV...');
    const csvPath = await downloadCsv(page, onLog);

    if (!csvPath) {
      onLog('CSV download failed, no data to parse', 'error');
      return { success: false, rows: [], error: 'CSV download failed' };
    }

    onLog(`CSV saved: ${csvPath}`);
    const rows = parseCsv(csvPath, onLog);

    onLog(`Win Lose All check complete! ${rows.length} rows parsed from CSV`, 'success');
    return { success: true, rows, totalItems: rows.length };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`Win Lose All check error: ${msg}`, 'error');
    return { success: false, rows: [], error: msg };
  }
}

// ============================================================
// Date Helpers
// ============================================================

/**
 * Convert DD-MM-YYYY to YYYY-MM-DD for PAY4D date inputs.
 */
function convertDdMmYyyyToYyyyMmDd(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('-');
  return `${yyyy}-${mm}-${dd}`;
}

// ============================================================
// Game Category Selection
// ============================================================

/**
 * Select a game category from the Bootstrap multiselect dropdown.
 *
 * Steps:
 * 1. Open the dropdown
 * 2. Click "Select All" to deselect everything (all are selected by default)
 * 3. Click the desired category group checkbox
 */
async function selectGameCategory(
  page: Page,
  category: Pay4dGameCategory,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  // Open the multiselect dropdown
  const dropdownBtn = await page.$(S.winLoseAll.multiselectButton);
  if (!dropdownBtn) {
    onLog('Multiselect dropdown button not found', 'warning');
    return;
  }

  await dropdownBtn.click();
  await page.waitForTimeout(800);

  // Wait for dropdown container to appear
  try {
    await page.waitForSelector(S.winLoseAll.multiselectContainer, { state: 'visible', timeout: 5000 });
  } catch {
    onLog('Multiselect dropdown did not open', 'warning');
    return;
  }

  // Click "Select All" to DESELECT all (since all are selected by default)
  onLog('Deselecting all game categories...');
  const selectAllBtn = await page.$(S.winLoseAll.selectAllButton);
  if (selectAllBtn) {
    await selectAllBtn.click();
    await page.waitForTimeout(500);
  } else {
    onLog('"Select All" button not found in dropdown', 'warning');
  }

  // Now click the desired category group to select only that one
  onLog(`Selecting "${category}"...`);
  const categorySelector = S.winLoseAll.groupButton(category);
  const categoryBtn = await page.$(categorySelector);

  if (categoryBtn) {
    await categoryBtn.click();
    await page.waitForTimeout(500);
    onLog(`"${category}" selected`);
  } else {
    // Fallback: try finding by title attribute
    const allGroupBtns = await page.$$('button.multiselect-group');
    let found = false;
    for (const btn of allGroupBtns) {
      const text = (await btn.getAttribute('title'))?.trim();
      if (text === category) {
        await btn.click();
        await page.waitForTimeout(500);
        found = true;
        onLog(`"${category}" selected (via fallback)`);
        break;
      }
    }
    if (!found) {
      onLog(`Category "${category}" not found in multiselect`, 'warning');
    }
  }

  // Close dropdown by clicking outside or pressing Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // If dropdown is still open, click the dropdown button again to close
  const dropdownStillOpen = await page.$(S.winLoseAll.multiselectContainer + '.show');
  if (dropdownStillOpen) {
    await dropdownBtn.click();
    await page.waitForTimeout(300);
  }
}

// ============================================================
// Date Input Helpers
// ============================================================

/**
 * Set a date input value by clearing and typing the new date.
 * PAY4D uses Bootstrap Datepicker with format YYYY-MM-DD.
 */
async function setDateInput(page: Page, selector: string, dateValue: string): Promise<void> {
  const input = await page.$(selector);
  if (!input) {
    const altSelectors = selector.includes('startDate')
      ? PAY4D_SELECTORS.winLoseAll.startDateFallbacks
      : PAY4D_SELECTORS.winLoseAll.endDateFallbacks;

    for (const alt of altSelectors) {
      const altInput = await page.$(alt);
      if (altInput) {
        await clearAndType(page, altInput, dateValue);
        return;
      }
    }
    throw new Error(`Date input not found: ${selector}`);
  }

  await clearAndType(page, input, dateValue);
}

/**
 * Clear an input and type a new value.
 */
async function clearAndType(
  page: Page,
  element: Awaited<ReturnType<Page['$']>>,
  value: string,
): Promise<void> {
  if (!element) return;

  // Triple-click to select all, then type to replace
  await element.click({ clickCount: 3 });
  await page.waitForTimeout(100);
  await page.keyboard.type(value, { delay: 50 });
  await page.waitForTimeout(200);

  // Press Escape to close any datepicker popup
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// ============================================================
// Search & Results
// ============================================================

/**
 * Click the Search button.
 */
async function clickSearchButton(page: Page): Promise<void> {
  const searchBtn = await page.$(S.winLoseAll.searchButton);
  if (searchBtn) {
    await searchBtn.click();
    return;
  }

  for (const alt of S.winLoseAll.searchButtonFallbacks) {
    const altBtn = await page.$(alt);
    if (altBtn) {
      await altBtn.click();
      return;
    }
  }

  // Last resort: call the JS function directly
  await page.evaluate('if (typeof menuWinLoseAllContent === "function") menuWinLoseAllContent();');
}

/**
 * Wait for the Win Lose All results (summary table) to load.
 */
async function waitForResults(
  page: Page,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  // Wait for the summary table (#result) to appear inside #winLoseAllContent
  try {
    await page.waitForSelector(S.winLoseAll.summaryTable, { state: 'visible', timeout: 30000 });
    onLog('Summary table loaded');
  } catch {
    // Fallback: wait for any content in the results container
    try {
      await page.waitForFunction(
        (sel) => {
          const el = (globalThis as any).document.querySelector(sel);
          return el && el.innerHTML.trim().length > 0;
        },
        S.winLoseAll.resultsContainer,
        { timeout: 15000 },
      );
      onLog('Results container has content');
    } catch {
      onLog('Timeout waiting for results', 'warning');
    }
  }

  // Extra wait for full render
  await page.waitForTimeout(1500);
}

// ============================================================
// CSV Download & Parse
// ============================================================

/**
 * Click the CSV download button and wait for the file to download.
 * Uses Playwright's download event to capture the file reliably.
 */
async function downloadCsv(
  page: Page,
  onLog: (msg: string, level?: string) => void,
): Promise<string | null> {
  // Prepare download directory
  const downloadDir = path.join(__dirname, '../../../../data/downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  // Find the download button
  let downloadBtn = await page.$(S.winLoseAll.downloadCsvButton);

  if (!downloadBtn) {
    // Fallback selectors
    for (const alt of S.winLoseAll.downloadCsvButtonFallbacks) {
      downloadBtn = await page.$(alt);
      if (downloadBtn) break;
    }
  }

  if (!downloadBtn) {
    // Last fallback: find by icon inside the results
    downloadBtn = await page.$(`${S.winLoseAll.resultsContainer} button:has(.glyphicon-download)`);
  }

  if (!downloadBtn) {
    onLog('CSV download button not found', 'error');
    return null;
  }

  try {
    // Set up download listener BEFORE clicking
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

    await downloadBtn.click();
    onLog('Download button clicked, waiting for file...');

    const download = await downloadPromise;

    // Save to our data directory with a timestamp
    const timestamp = Date.now();
    const suggestedName = download.suggestedFilename() || 'winloseall.csv';
    const savePath = path.join(downloadDir, `pay4d-${timestamp}-${suggestedName}`);

    await download.saveAs(savePath);
    onLog(`CSV downloaded: ${suggestedName}`);

    return savePath;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`CSV download error: ${msg}`, 'error');
    logger.error(`[PAY4D] Download error: ${msg}`);
    return null;
  }
}

/**
 * Parse a CSV file and extract username + bet columns into NtoRow[].
 *
 * Searches the CSV header row for columns named "username" (or "user")
 * and "bet" (case-insensitive), then extracts those values per row.
 */
function parseCsv(
  csvPath: string,
  onLog: (msg: string, level?: string) => void,
): NtoRow[] {
  const rows: NtoRow[] = [];

  try {
    const raw = fs.readFileSync(csvPath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);

    if (lines.length < 2) {
      onLog('CSV has no data rows', 'warning');
      return rows;
    }

    // Detect delimiter (comma, semicolon, or tab)
    const delimiter = detectDelimiter(lines[0]);

    // Parse header row
    const headers = parseCsvLine(lines[0], delimiter).map(h => h.toLowerCase().trim());

    // Find column indices for username and bet
    const usernameIdx = headers.findIndex(h =>
      h === 'username' || h === 'user' || h === 'user name' || h === 'member',
    );
    const betIdx = headers.findIndex(h =>
      h === 'bet' || h === 'total bet' || h === 'bet amount' || h === 'totalbet',
    );

    if (usernameIdx === -1) {
      onLog(`CSV header: [${headers.join(', ')}]`, 'warning');
      onLog('Could not find "username" column in CSV', 'error');
      return rows;
    }

    onLog(`CSV columns found - username: col ${usernameIdx}${betIdx >= 0 ? `, bet: col ${betIdx}` : ', bet: not found'}`);

    // Also try to find win column for userNTO (net win/lose)
    const winIdx = headers.findIndex(h =>
      h === 'win' || h === 'total win' || h === 'win amount' || h === 'w/l' || h === 'win/lose' || h === 'winlose',
    );

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i], delimiter);

      const username = values[usernameIdx]?.trim();
      if (!username) continue;

      // Skip total/summary rows
      if (username.toLowerCase() === 'total' || username.toLowerCase() === 'grand total') {
        continue;
      }

      const bet = betIdx >= 0 ? (values[betIdx]?.trim() || '0') : '0';
      const win = winIdx >= 0 ? (values[winIdx]?.trim() || '0') : '0';

      rows.push({
        username,
        betCount: bet,
        userTO: bet,     // turnover = bet
        userNTO: win,    // net = win/lose
      });
    }

    onLog(`Parsed ${rows.length} rows from CSV`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`CSV parse error: ${msg}`, 'error');
    logger.error(`[PAY4D] CSV parse error: ${msg}`);
  }

  return rows;
}

/**
 * Detect the CSV delimiter from the header line.
 */
function detectDelimiter(headerLine: string): string {
  const commas = (headerLine.match(/,/g) || []).length;
  const semicolons = (headerLine.match(/;/g) || []).length;
  const tabs = (headerLine.match(/\t/g) || []).length;

  if (tabs >= commas && tabs >= semicolons) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

/**
 * Parse a single CSV line respecting quoted fields.
 */
function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }

  result.push(current);
  return result;
}

// ============================================================
// Screenshot
// ============================================================

/**
 * Take a screenshot of the Win Lose All results area.
 */
export async function screenshotPay4dResults(
  page: Page,
  savePath: string,
): Promise<string> {
  const resultsEl = await page.$(S.winLoseAll.resultsContainer);
  if (resultsEl) {
    await resultsEl.screenshot({ path: savePath });
  } else {
    await page.screenshot({ path: savePath, fullPage: false });
  }
  return savePath;
}
