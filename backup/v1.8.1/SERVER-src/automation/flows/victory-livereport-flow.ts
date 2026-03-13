import type { Page } from 'playwright';
import { VICTORY_SELECTORS } from '../selectors/victory-selectors';
import { setMuiDatePicker, parseDateParts } from './victory-nto-check-flow';
import logger from '../../utils/logger';

const S = VICTORY_SELECTORS;

export interface LiveReportRawRow {
  /** All cell values from the table row (up to 24 columns) */
  cells: string[];
}

export interface LiveReportScrapeResult {
  success: boolean;
  rows: LiveReportRawRow[];
  error?: string;
}

/** Company report row data from by-company page */
export interface CompanyReportRow {
  date: string;
  regCount: number;
  loginCount: number;
  firstDpCount: number;
  firstDpAmount: number;
  dpCount: number;
  dpAmount: number;
  dpUser: number;
  wdCount: number;
  wdAmount: number;
  wdUser: number;
  dpWdDiff: number;
  adjustmentCount: number;
  adjustmentAmount: number;
  betCount: number;
  betAmount: number;
  validBet: number;
  playerWinloss: number;
  promo: number;
  rebate: number;
  commission: number;
  totalWinloss: number;
  frb: number;
  jpc: number;
}

export interface CompanyReportResult {
  success: boolean;
  row?: CompanyReportRow;
  error?: string;
}

/**
 * Victory Live Report Flow:
 * 1. Navigate to /report/report-profit-loss/by-referral
 * 2. Set Upline Username input
 * 3. Set date range
 * 4. Click Filter, set page size 1000
 * 5. Scroll-scrape all rows from MUI virtual table
 * 6. Return raw row data
 */
export async function victoryLiveReportFlow(
  page: Page,
  panelUrl: string,
  onLog: (msg: string, level?: string) => void,
  options: {
    uplineUsername: string;
    dateStart: string; // DD/MM/YYYY format
    dateEnd?: string;  // DD/MM/YYYY format (optional)
  },
): Promise<LiveReportScrapeResult> {
  try {
    const baseUrl = panelUrl.replace(/\/+$/, '').replace(/\/login\/?$/, '');
    const reportUrl = `${baseUrl}/report/report-profit-loss/by-referral`;

    onLog(`Navigating to by-referral report...`);
    await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.setViewportSize({ width: 2560, height: 1440 });

    // Check if we landed on login page
    if (page.url().includes('/login')) {
      return { success: false, rows: [], error: 'Session expired, redirected to login' };
    }

    onLog('Report page loaded');

    // === Set Upline Username ===
    onLog(`Setting upline: ${options.uplineUsername}`);
    const uplineSet = await setUplineUsername(page, options.uplineUsername, onLog);
    if (!uplineSet) {
      onLog('Failed to set upline username, continuing anyway...', 'warning');
    }

    // === Set date range ===
    onLog(`Setting start date: ${options.dateStart}`);
    // Parse DD/MM/YYYY to parts
    const startParts = parseDateFromSlash(options.dateStart);
    await setMuiDatePicker(
      page,
      S.liveReport.startDate,
      [S.report.startDate, ...S.report.startDateFallbacks],
      startParts,
      onLog,
    );

    if (options.dateEnd) {
      onLog(`Setting end date: ${options.dateEnd}`);
      const endParts = parseDateFromSlash(options.dateEnd);
      await setMuiDatePicker(
        page,
        S.liveReport.endDate,
        [S.report.endDate, ...S.report.endDateFallbacks],
        endParts,
        onLog,
      );
    }

    await page.waitForTimeout(500);

    // === Click Filter ===
    onLog('Clicking Filter...');
    await clickFilter(page);

    // === Wait for table to load ===
    await waitForTableLoad(page, onLog);

    // === Set page size to 1000 ===
    onLog('Setting page size to 1000...');
    await setPageSize1000(page, onLog);

    // Wait for data to reload after page size change
    await waitForTableLoad(page, onLog);

    // === Scroll-scrape all rows ===
    onLog('Scraping table data...');
    const rows = await scrollScrapeRows(page, onLog);

    onLog(`Scraped ${rows.length} row(s)`, 'success');
    return { success: true, rows };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`Live report error: ${msg}`, 'error');
    return { success: false, rows: [], error: msg };
  }
}

/**
 * Parse DD/MM/YYYY to date parts for MUI DatePicker
 */
function parseDateFromSlash(ddmmyyyy: string): { dd: string; mm: string; yyyy: string } {
  const [dd, mm, yyyy] = ddmmyyyy.split('/');
  return { dd, mm, yyyy };
}

/**
 * Set the "Upline Username" MUI input field.
 * The input has a complex MUI OutlinedInput structure with label "Upline Username".
 */
async function setUplineUsername(
  page: Page,
  value: string,
  onLog: (msg: string, level?: string) => void,
): Promise<boolean> {
  // Try CSS selectors first
  let input = await page.$(S.liveReport.uplineInput);

  // Fallback to XPath selectors
  if (!input) {
    for (const xp of S.liveReport.uplineInputFallbacks) {
      try {
        input = await page.$(xp);
        if (input) break;
      } catch { /* ignore */ }
    }
  }

  // Last resort: find all Search placeholder inputs and match by parent label
  if (!input) {
    try {
      const inputs = await page.$$("input[placeholder='Search']");
      for (const inp of inputs) {
        const parent = await inp.evaluateHandle(el => {
          let p = el.closest('.MuiOutlinedInput-root');
          return p ? p.textContent : '';
        });
        const parentText = await parent.jsonValue() as string;
        if (parentText && parentText.includes('Upline Username')) {
          input = inp;
          break;
        }
      }
    } catch { /* ignore */ }
  }

  if (!input) {
    onLog('Upline Username input not found', 'warning');
    return false;
  }

  try {
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await page.waitForTimeout(300);

    // Select all + delete existing text
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);

    // Type character by character (MUI input needs this)
    for (const char of value) {
      await page.keyboard.type(char, { delay: 100 });
    }
    await page.waitForTimeout(500);

    // Verify input value
    const currentVal = await input.inputValue().catch(() => '');
    if (currentVal.trim().toLowerCase() !== value.trim().toLowerCase()) {
      onLog(`Upline input mismatch: got "${currentVal}", forcing JS...`, 'warning');
      await input.evaluate((el: any, v: string) => {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, value);
      await page.waitForTimeout(300);
    }

    // Press Enter to confirm
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    onLog(`Upline set to "${value}"`, 'success');
    return true;

  } catch (err) {
    onLog(`Error setting upline: ${err}`, 'error');
    return false;
  }
}

/**
 * Click the Filter button
 */
async function clickFilter(page: Page): Promise<void> {
  const selectors = [S.liveReport.filterButton, ...S.liveReport.filterButtonFallbacks];
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
        await page.waitForTimeout(1500);
        return;
      }
    } catch { /* try next */ }
  }

  // Fallback: find by text
  try {
    await page.click('button:has-text("Filter")');
    await page.waitForTimeout(1500);
  } catch {
    logger.warn('Filter button not found');
  }
}

/**
 * Wait for the MUI table to finish loading
 */
async function waitForTableLoad(
  page: Page,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  try {
    await page.waitForSelector(S.liveReport.loadingSpinner, { state: 'attached', timeout: 3000 });
    onLog('Table loading...');
    await page.waitForSelector(S.liveReport.loadingSpinner, { state: 'detached', timeout: 60000 });
  } catch { /* no spinner */ }

  await page.waitForTimeout(1000);
  try {
    await page.waitForSelector(S.liveReport.tableBody, { timeout: 10000, state: 'visible' });
  } catch {
    onLog('Table body not visible, waiting more...', 'warning');
    await page.waitForTimeout(2000);
  }
}

/**
 * Set MUI Select combobox page size to 1000
 */
async function setPageSize1000(
  page: Page,
  onLog: (msg: string, level?: string) => void,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Find the page size combobox (MUI Select)
      const combos = await page.$$("div[role='combobox'].MuiSelect-select, div[role='combobox'][class*='MuiSelect']");
      let target = null;

      for (const el of combos) {
        const text = await el.textContent() || '';
        if (['10', '25', '50', '100', '1000'].some(v => text.trim() === v)) {
          target = el;
        }
      }
      if (!target && combos.length > 0) {
        target = combos[combos.length - 1];
      }
      if (!target) continue;

      const currentVal = (await target.textContent() || '').trim();
      if (currentVal === '1000') {
        onLog('Page size already 1000');
        return true;
      }

      await target.scrollIntoViewIfNeeded();
      await target.click();
      await page.waitForTimeout(500);

      // Click the 1000 option
      const opt = await page.waitForSelector(
        "li[role='option']:has-text('1000'), ul[role='listbox'] li:has-text('1000'), li:has-text('1000')",
        { timeout: 5000 },
      );
      if (opt) {
        await opt.click();
        await page.waitForTimeout(1000);
        onLog('Page size set to 1000', 'success');
        return true;
      }
    } catch {
      await page.waitForTimeout(400);
    }
  }
  onLog('Could not set page size to 1000', 'warning');
  return false;
}

/**
 * Scroll-scrape all rows from the MUI virtual table.
 * MUI tables may use virtualization, so we scroll to load all rows.
 */
async function scrollScrapeRows(
  page: Page,
  onLog: (msg: string, level?: string) => void,
): Promise<LiveReportRawRow[]> {
  // Force page size to 1000 before scraping
  await setPageSize1000(page, onLog);
  await page.waitForTimeout(500);

  const dataByUser = new Map<string, string[]>();

  // Find scrollable container
  const hasScrollContainer = await page.evaluate(() => {
    const tb = document.querySelector('table tbody');
    if (!tb) return false;
    let p: HTMLElement | null = tb.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      const oy = cs.overflowY || cs.overflow;
      if (oy && (oy.includes('auto') || oy.includes('scroll'))) return true;
      p = p.parentElement;
    }
    return false;
  });

  // Initial scrape
  const getRows = async () => {
    return page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map((tr: any) =>
        Array.from(tr.querySelectorAll('td')).map((td: any) => td.innerText.trim())
      );
    });
  };

  // Scroll to top first
  if (hasScrollContainer) {
    await page.evaluate(() => {
      const tb = document.querySelector('table tbody');
      if (!tb) return;
      let p: HTMLElement | null = tb.parentElement;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        const oy = cs.overflowY || cs.overflow;
        if (oy && (oy.includes('auto') || oy.includes('scroll'))) {
          p.scrollTop = 0;
          return;
        }
        p = p.parentElement;
      }
    });
    await page.waitForTimeout(300);
  }

  let lastSize = -1;

  for (let i = 0; i < 600; i++) {
    const rowsData = await getRows();
    for (const vals of rowsData) {
      if (!vals || vals.length < 2) continue;
      const user = (vals[0] || '').trim();
      if (!user || user.toLowerCase() === 'total') continue;
      dataByUser.set(user, vals.slice(0, 24));
    }

    if (!hasScrollContainer) break;

    // Scroll down
    await page.evaluate(() => {
      const tb = document.querySelector('table tbody');
      if (!tb) return;
      let p: HTMLElement | null = tb.parentElement;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        const oy = cs.overflowY || cs.overflow;
        if (oy && (oy.includes('auto') || oy.includes('scroll'))) {
          p.scrollTop += p.clientHeight;
          return;
        }
        p = p.parentElement;
      }
    });
    await page.waitForTimeout(250);

    if (dataByUser.size === lastSize) {
      // Scroll to absolute bottom
      await page.evaluate(() => {
        const tb = document.querySelector('table tbody');
        if (!tb) return;
        let p: HTMLElement | null = tb.parentElement;
        while (p && p !== document.body) {
          const cs = getComputedStyle(p);
          const oy = cs.overflowY || cs.overflow;
          if (oy && (oy.includes('auto') || oy.includes('scroll'))) {
            p.scrollTop = p.scrollHeight;
            return;
          }
          p = p.parentElement;
        }
      });
      await page.waitForTimeout(300);

      // Final scrape
      const finalRows = await getRows();
      for (const vals of finalRows) {
        if (!vals || vals.length < 2) continue;
        const user = (vals[0] || '').trim();
        if (!user || user.toLowerCase() === 'total') continue;
        dataByUser.set(user, vals.slice(0, 24));
      }
      break;
    }
    lastSize = dataByUser.size;
  }

  onLog(`Collected ${dataByUser.size} unique row(s) after scroll-scraping`);
  return Array.from(dataByUser.values()).map(cells => ({ cells }));
}

// ============================================================
// Company Report Flow (/report/report-profit-loss/by-company)
// ============================================================

/**
 * Parse amount string like "1.822.619.167,10" or "-36.077.579,90" to number.
 */
function parseCompanyAmount(s: string): number {
  if (!s) return 0;
  // Remove HTML tags (in case innerText still has spans)
  const clean = s.replace(/<[^>]+>/g, '').trim();
  if (!clean) return 0;
  // Format: 1.234.567,89 (dot = thousands, comma = decimal)
  const normalized = clean.replace(/\./g, '').replace(',', '.');
  return parseFloat(normalized) || 0;
}

/**
 * Parse integer string like "8358" or "1196"
 */
function parseCompanyInt(s: string): number {
  if (!s) return 0;
  return parseInt(s.replace(/[^\d-]/g, ''), 10) || 0;
}

/**
 * Scrape Victory by-company report for a specific target date.
 * Navigates to /report/report-profit-loss/by-company, sets date range, clicks Filter,
 * then finds the row matching the target date and extracts all columns.
 */
export async function victoryCompanyReportFlow(
  page: Page,
  panelUrl: string,
  onLog: (msg: string, level?: string) => void,
  options: {
    dateStart: string; // DD/MM/YYYY format
    dateEnd?: string;  // DD/MM/YYYY format
    targetDate: string; // e.g., "9 March 2026" or "08/03/2026" — we match flexibly
  },
): Promise<CompanyReportResult> {
  try {
    const baseUrl = panelUrl.replace(/\/+$/, '').replace(/\/login\/?$/, '');
    const companyUrl = `${baseUrl}/report/report-profit-loss/by-company`;

    onLog('[Company] Navigating to by-company report...');
    await page.goto(companyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    if (page.url().includes('/login')) {
      return { success: false, error: 'Session expired, redirected to login' };
    }

    onLog('[Company] Report page loaded');

    // === Set date range ===
    onLog(`[Company] Setting start date: ${options.dateStart}`);
    const startParts = parseDateFromSlash(options.dateStart);
    await setMuiDatePicker(
      page,
      S.liveReport.startDate,
      [S.report.startDate, ...S.report.startDateFallbacks],
      startParts,
      onLog,
    );

    if (options.dateEnd) {
      onLog(`[Company] Setting end date: ${options.dateEnd}`);
      const endParts = parseDateFromSlash(options.dateEnd);
      await setMuiDatePicker(
        page,
        S.liveReport.endDate,
        [S.report.endDate, ...S.report.endDateFallbacks],
        endParts,
        onLog,
      );
    }

    await page.waitForTimeout(500);

    // === Click Filter ===
    onLog('[Company] Clicking Filter...');
    await clickFilter(page);

    // === Wait for table to load ===
    await waitForTableLoad(page, onLog);

    // === Scrape all rows and find target date ===
    onLog('[Company] Scraping company table...');

    // Build target date variants for flexible matching
    const targetVariants = buildDateVariants(options.targetDate);
    onLog(`[Company] Looking for date matching: ${targetVariants.join(' / ')}`);

    const rowData = await page.evaluate((variants: string[]) => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      for (const tr of rows) {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 5) continue;
        const dateCell = (tds[0]?.innerText || '').trim();
        // Check if any variant matches
        const dateLower = dateCell.toLowerCase();
        const found = variants.some(v => dateLower.includes(v.toLowerCase()));
        if (found) {
          return tds.map(td => td.innerText.trim());
        }
      }
      return null;
    }, targetVariants);

    if (!rowData) {
      onLog(`[Company] Target date not found in table`, 'warning');
      return { success: false, error: `Target date "${options.targetDate}" not found in company table` };
    }

    onLog(`[Company] Found row with ${rowData.length} columns for date: ${rowData[0]}`);

    // Map columns to CompanyReportRow
    // Column order from HTML: Date, RegCount, LoginCount, 1stDP, 1stDPAmt, #DP, DPAmt, DPUser,
    //   #WD, WDAmt, WDUser, DP/WDDiff, #Adj, AdjAmt, #Bet, BetAmt, ValidBet, PlayerWL,
    //   Promo, Rebate, Commission, TotalWL, FRB, JPC, LastUpdated, Currency
    const row: CompanyReportRow = {
      date: rowData[0] || '',
      regCount: parseCompanyInt(rowData[1]),
      loginCount: parseCompanyInt(rowData[2]),
      firstDpCount: parseCompanyInt(rowData[3]),
      firstDpAmount: parseCompanyAmount(rowData[4]),
      dpCount: parseCompanyInt(rowData[5]),
      dpAmount: parseCompanyAmount(rowData[6]),
      dpUser: parseCompanyInt(rowData[7]),
      wdCount: parseCompanyInt(rowData[8]),
      wdAmount: parseCompanyAmount(rowData[9]),
      wdUser: parseCompanyInt(rowData[10]),
      dpWdDiff: parseCompanyAmount(rowData[11]),
      adjustmentCount: parseCompanyInt(rowData[12]),
      adjustmentAmount: parseCompanyAmount(rowData[13]),
      betCount: parseCompanyInt(rowData[14]),
      betAmount: parseCompanyAmount(rowData[15]),
      validBet: parseCompanyAmount(rowData[16]),
      playerWinloss: parseCompanyAmount(rowData[17]),
      promo: parseCompanyAmount(rowData[18]),
      rebate: parseCompanyAmount(rowData[19]),
      commission: parseCompanyAmount(rowData[20]),
      totalWinloss: parseCompanyAmount(rowData[21]),
      frb: parseCompanyAmount(rowData[22]),
      jpc: parseCompanyAmount(rowData[23]),
    };

    onLog(`[Company] Data scraped: Reg=${row.regCount}, DP=${row.dpCount}, WL=${formatNum(row.totalWinloss)}`);
    return { success: true, row };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`[Company] Error: ${msg}`, 'error');
    return { success: false, error: msg };
  }
}

function formatNum(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

/**
 * Build multiple date string variants for flexible matching.
 * Input can be DD/MM/YYYY or "9 March 2026" etc.
 */
function buildDateVariants(dateStr: string): string[] {
  const variants: string[] = [dateStr];

  // If DD/MM/YYYY format
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, dd, mm, yyyy] = slashMatch;
    const day = parseInt(dd, 10);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[parseInt(mm, 10) - 1] || '';
    // "9 March 2026" and "09 March 2026"
    variants.push(`${day} ${monthName} ${yyyy}`);
    variants.push(`${dd.padStart(2, '0')} ${monthName} ${yyyy}`);
  }

  // If "D Month YYYY" format, also add DD/MM/YYYY
  const textMatch = dateStr.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (textMatch) {
    const [, dd, monthText, yyyy] = textMatch;
    const day = parseInt(dd, 10);
    variants.push(`${day} ${monthText} ${yyyy}`);
    variants.push(`${dd.padStart(2, '0')} ${monthText} ${yyyy}`);
  }

  return [...new Set(variants)];
}
