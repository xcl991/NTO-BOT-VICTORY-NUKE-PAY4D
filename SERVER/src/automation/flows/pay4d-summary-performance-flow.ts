import type { Page } from 'playwright';
import { PAY4D_SELECTORS } from '../selectors/pay4d-selectors';
import { clickWithFallback } from '../utils/retry-handler';
import logger from '../../utils/logger';

type LogCallback = (msg: string, level?: string) => void;

export interface Pay4dSPRow {
  date: string;            // "12 Mar 2026 (Thu)"
  dpCount: number;         // Total Deposit Form (col 7)
  dpAmount: number;        // Total Deposit Jumlah (col 8)
  nto: number;             // Bet Jumlah (col 12)
}

export interface Pay4dSPResult {
  success: boolean;
  today?: Pay4dSPRow;
  yesterday?: Pay4dSPRow;
  error?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Parse PAY4D number format: commas as thousands separators.
 * E.g. "228,378,716" → 228378716, "-191,194,221" → -191194221
 */
function parsePay4dNumber(text: string): number {
  if (!text || text.trim() === '' || text.trim() === '-') return 0;
  const cleaned = text.trim().replace(/,/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

/**
 * Match date string from table row against target date.
 * Table format: "12 Mar 2026 (Thu)" — we match day and month+year.
 */
function matchDate(cellText: string, targetDay: number, targetMonth: number, targetYear: number): boolean {
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const m = cellText.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!m) return false;
  const day = parseInt(m[1], 10);
  const mon = months[m[2].toLowerCase()] || 0;
  const year = parseInt(m[3], 10);
  return day === targetDay && mon === targetMonth && year === targetYear;
}

/**
 * Clear an input and type a new value (Bootstrap Datepicker compatible).
 * Uses triple-click to select all + keyboard type + Escape to close popup.
 */
async function clearAndType(page: Page, element: any, value: string): Promise<void> {
  if (!element) return;
  await element.click({ clickCount: 3 });
  await page.waitForTimeout(100);
  await page.keyboard.type(value, { delay: 50 });
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

/**
 * Set a Bootstrap Datepicker input with fallback selectors.
 */
async function setDateInput(page: Page, selector: string, fallbacks: readonly string[], dateValue: string): Promise<void> {
  const input = await page.$(selector);
  if (input) {
    await clearAndType(page, input, dateValue);
    return;
  }
  for (const alt of fallbacks) {
    const altInput = await page.$(alt);
    if (altInput) {
      await clearAndType(page, altInput, dateValue);
      return;
    }
  }
  throw new Error(`Date input not found: ${selector}`);
}

/**
 * PAY4D Summary Performance Flow:
 *
 * Navigates to Performance Review page via menu button click,
 * sets date range (yesterday → today) via Bootstrap Datepicker (triple-click + type),
 * clicks Search, then scrapes the Bootstrap table.
 *
 * Table columns per data row (14 total):
 *   0: No, 1: Date (Day), 2: Total Daftar,
 *   3: New Deposit Form, 4: New Deposit Jumlah,
 *   5: Re-Deposit Form, 6: Re-Deposit Jumlah,
 *   7: Total Deposit Form (DP COUNT), 8: Total Deposit Jumlah (DP AMOUNT),
 *   9: Withdraw Form, 10: Withdraw Jumlah,
 *   11: Deposit-Withdraw, 12: Bet (NTO), 13: WinLose
 */
export async function pay4dSummaryPerformanceFlow(
  page: Page,
  panelUrl: string,
  onLog: LogCallback,
): Promise<Pay4dSPResult> {
  const S = PAY4D_SELECTORS.performanceReview;

  try {
    // Step 1: Ensure we're on the admin page
    const currentUrl = page.url();
    if (!currentUrl.includes('/mimin/')) {
      const baseUrl = panelUrl.replace(/\/+$/, '');
      onLog('Navigating to PAY4D admin area...');
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    } else {
      onLog('Already on admin page');
    }

    // Step 2: Click Performance Review menu button
    onLog('Clicking "Performance Review"...');
    await clickWithFallback(page, S.menuButton, S.menuButtonFallbacks, { timeout: 10000 });
    await page.waitForTimeout(1500);

    // Wait for Performance Review heading/alert to appear
    try {
      await page.waitForSelector(S.alertHeading, { timeout: 10000, state: 'visible' });
      onLog('Performance Review page loaded');
    } catch {
      onLog('Performance Review heading not found, continuing...', 'warning');
    }

    // Step 3: Set date range via Bootstrap Datepicker (triple-click + type)
    const now = new Date();
    const today = now;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const yesterdayStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

    onLog(`Setting date range: ${yesterdayStr} → ${todayStr}`);
    await setDateInput(page, S.startDate, S.startDateFallbacks, yesterdayStr);
    await setDateInput(page, S.endDate, S.endDateFallbacks, todayStr);

    // Step 4: Click Search button
    onLog('Clicking Search...');
    const searchBtn = await page.$(S.searchButton);
    if (searchBtn) {
      await searchBtn.click();
    } else {
      for (const fb of S.searchButtonFallbacks) {
        const el = await page.$(fb);
        if (el) { await el.click(); break; }
      }
    }

    // Step 5: Wait for table to load with results
    onLog('Waiting for Performance Review table...');

    // Wait for table to appear and have rows — look for any visible table inside the page
    let tableLoaded = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(1000);
      const rowCount = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        // Find all visible tables on the page that have tbody with rows
        const allTables = doc.querySelectorAll('table.table-striped tbody');
        let maxRows = 0;
        for (const tbody of Array.from(allTables) as any[]) {
          const rows = tbody.querySelectorAll('tr');
          if (rows.length > maxRows) maxRows = rows.length;
        }
        return maxRows;
      });
      if (rowCount > 0) {
        tableLoaded = true;
        onLog(`Table loaded with ${rowCount} rows`);
        break;
      }
    }

    if (!tableLoaded) {
      const pageTitle = await page.title();
      onLog(`Debug: title="${pageTitle}"`, 'warning');
      return { success: false, error: 'Performance Review table did not load within 20s' };
    }

    // Wait extra for all data rows to appear (AJAX may load in stages)
    await page.waitForTimeout(3000);

    // Step 6: Debug — dump ALL rows from ALL visible tables to understand structure
    const debugInfo = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const allTables = doc.querySelectorAll('table.table-striped');
      const tables: { tableIndex: number; rows: { cellCount: number; style: string; firstCells: string[] }[] }[] = [];
      let tIdx = 0;
      for (const table of Array.from(allTables) as any[]) {
        const tbody = table.querySelector('tbody');
        if (!tbody) { tIdx++; continue; }
        const rowsInfo: any[] = [];
        for (const tr of Array.from(tbody.querySelectorAll('tr')) as any[]) {
          const tds = tr.querySelectorAll('td');
          const cells: string[] = [];
          for (const td of Array.from(tds).slice(0, 4) as any[]) {
            cells.push((td.textContent || '').trim().substring(0, 30));
          }
          rowsInfo.push({
            cellCount: tds.length,
            style: (tr.getAttribute('style') || '').substring(0, 60),
            firstCells: cells,
          });
        }
        if (rowsInfo.length > 0) {
          tables.push({ tableIndex: tIdx, rows: rowsInfo });
        }
        tIdx++;
      }
      return tables;
    });

    for (const t of debugInfo) {
      onLog(`Table #${t.tableIndex}: ${t.rows.length} rows`);
      for (const r of t.rows) {
        onLog(`  → ${r.cellCount} cells, style="${r.style}", data=[${r.firstCells.join(' | ')}]`);
      }
    }

    // Step 7: Scrape data rows from the correct table
    // Find the table that has Performance Review data (rows with date patterns like "12 Mar 2026")
    const rows = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const allTables = doc.querySelectorAll('table.table-striped');
      const allRows: { cells: string[] }[] = [];
      for (const table of Array.from(allTables) as any[]) {
        const tbody = table.querySelector('tbody');
        if (!tbody) continue;
        for (const tr of Array.from(tbody.querySelectorAll('tr')) as any[]) {
          // Skip total row
          const style = tr.getAttribute('style') || '';
          if (style.includes('border-top') && style.includes('double')) continue;
          const tds = tr.querySelectorAll('td');
          const cells: string[] = [];
          for (const td of Array.from(tds) as any[]) {
            cells.push((td.textContent || '').trim());
          }
          // Data rows should have at least 10 cells and a date pattern in cell[1]
          if (cells.length >= 10 && /\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/.test(cells[1] || '')) {
            allRows.push({ cells });
          }
        }
      }
      return allRows;
    });

    onLog(`Found ${rows.length} data rows (date-matched)`);

    if (rows.length === 0) {
      return { success: false, error: 'No data rows found in Performance Review table' };
    }

    // Step 7: Parse rows and match to today/yesterday
    const todayDay = today.getDate();
    const todayMonth = today.getMonth() + 1;
    const todayYear = today.getFullYear();
    const ydayDay = yesterday.getDate();
    const ydayMonth = yesterday.getMonth() + 1;
    const ydayYear = yesterday.getFullYear();

    let todayRow: Pay4dSPRow | undefined;
    let yesterdayRow: Pay4dSPRow | undefined;

    for (const row of rows) {
      const dateCell = row.cells[1]; // "12 Mar 2026 (Thu)"
      // Log all cell values for debugging column indices
      onLog(`Row: ${row.cells.length} cells — [${row.cells.map((c: string, i: number) => `${i}:${c.substring(0, 15)}`).join(', ')}]`);

      const parseRow = (): Pay4dSPRow => ({
        date: dateCell,
        dpCount: parsePay4dNumber(row.cells[7]),    // Total Deposit Form
        dpAmount: parsePay4dNumber(row.cells[8]),    // Total Deposit Jumlah
        nto: parsePay4dNumber(row.cells[12]),         // Bet Jumlah
      });

      if (matchDate(dateCell, todayDay, todayMonth, todayYear)) {
        todayRow = parseRow();
        onLog(`Today: DP Count=${todayRow.dpCount}, DP Amount=${todayRow.dpAmount}, NTO=${todayRow.nto}`);
      } else if (matchDate(dateCell, ydayDay, ydayMonth, ydayYear)) {
        yesterdayRow = parseRow();
        onLog(`Yesterday: DP Count=${yesterdayRow.dpCount}, DP Amount=${yesterdayRow.dpAmount}, NTO=${yesterdayRow.nto}`);
      }
    }

    if (!todayRow && !yesterdayRow) {
      return { success: false, error: 'No matching date rows found for today or yesterday' };
    }

    onLog('PAY4D Performance Review scraped successfully', 'success');
    return { success: true, today: todayRow, yesterday: yesterdayRow };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[SP-PAY4D] Flow error: ${msg}`);
    return { success: false, error: msg };
  }
}
