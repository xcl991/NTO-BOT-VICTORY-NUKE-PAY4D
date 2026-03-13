import type { Page } from 'playwright';
import { VICTORY_SELECTORS } from '../selectors/victory-selectors';
import { setMuiDatePicker, parseDateParts } from './victory-nto-check-flow';
import { clickWithFallback } from '../utils/retry-handler';
import logger from '../../utils/logger';

const S = VICTORY_SELECTORS;

type LogCallback = (msg: string, level?: string) => void;

export interface VictorySPRow {
  date: string;
  dpCount: number;
  dpAmount: number;
  validBet: number;
}

export interface VictorySPResult {
  success: boolean;
  today?: VictorySPRow;
  yesterday?: VictorySPRow;
  error?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Parse Victory Indonesian amount format: "60.180.606,00" → 60180606
 */
function parseAmount(text: string): number {
  if (!text || text.trim() === '' || text.trim() === '-') return 0;
  // Remove dots (thousands), replace comma with dot (decimal)
  const cleaned = text.trim().replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : Math.round(val);
}

/**
 * Parse plain integer: "551" → 551
 */
function parseInt2(text: string): number {
  if (!text || text.trim() === '') return 0;
  const cleaned = text.trim().replace(/[^0-9\-]/g, '');
  const val = parseInt(cleaned, 10);
  return isNaN(val) ? 0 : val;
}

/**
 * Get today and yesterday dates in DD-MM-YYYY format.
 */
function getTodayYesterday(): { today: string; yesterday: string } {
  const now = new Date();
  const todayStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
  const yday = new Date(now);
  yday.setDate(yday.getDate() - 1);
  const yesterdayStr = `${pad(yday.getDate())}-${pad(yday.getMonth() + 1)}-${yday.getFullYear()}`;
  return { today: todayStr, yesterday: yesterdayStr };
}

/**
 * Build date variants for matching table date cell.
 * Input: "13-03-2026" → ["13 March 2026", "13/03/2026", "13 Mar 2026"]
 */
function buildDateVariants(ddmmyyyy: string): string[] {
  const [dd, mm, yyyy] = ddmmyyyy.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return [
    `${dd} ${months[mm - 1]} ${yyyy}`,           // "13 March 2026"
    `${pad(dd)} ${months[mm - 1]} ${yyyy}`,       // "13 March 2026" (padded)
    `${dd}/${pad(mm)}/${yyyy}`,                    // "13/03/2026"
    `${pad(dd)}/${pad(mm)}/${yyyy}`,               // "13/03/2026" (padded)
    `${dd} ${monthsShort[mm - 1]} ${yyyy}`,        // "13 Mar 2026"
  ];
}

/**
 * Victory Summary Performance Flow:
 *
 * Navigates to /report/report-profit-loss/by-company, sets date range
 * (yesterday → today), scrapes both rows using data-testid selectors,
 * extracts DP Count, DP Amount, and Valid Bet.
 */
export async function victorySummaryPerformanceFlow(
  page: Page,
  panelUrl: string,
  onLog: LogCallback,
): Promise<VictorySPResult> {
  try {
    const baseUrl = panelUrl.replace(/\/+$/, '').replace(/\/login\/?$/, '');
    const reportUrl = `${baseUrl}/report/report-profit-loss/by-company`;
    const { today, yesterday } = getTodayYesterday();

    onLog(`Navigating to by-company page...`);
    onLog(`URL: ${reportUrl}`);
    await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Set large viewport
    await page.setViewportSize({ width: 2560, height: 1440 });

    // Set date range: yesterday → today
    const startParts = parseDateParts(yesterday);
    const endParts = parseDateParts(today);

    onLog(`Setting date range: ${yesterday} - ${today}`);
    await setMuiDatePicker(page, S.report.startDate, S.report.startDateFallbacks, startParts, onLog);
    await setMuiDatePicker(page, S.report.endDate, S.report.endDateFallbacks, endParts, onLog);
    await page.waitForTimeout(500);

    // Click Filter
    onLog('Clicking Filter...');
    await clickWithFallback(page, S.report.filterButton, S.report.filterButtonFallbacks, { timeout: 5000 });

    // Wait for loading spinner to disappear
    onLog('Waiting for table to load...');
    try {
      await page.waitForSelector('.MuiCircularProgress-root', { state: 'visible', timeout: 3000 });
      await page.waitForSelector('.MuiCircularProgress-root', { state: 'hidden', timeout: 30000 });
    } catch {
      // Spinner may not appear, continue
    }
    await page.waitForTimeout(1500);

    // Wait for at least one data row
    try {
      await page.waitForSelector('[data-testid="tablerow-0-trx_date"]', { timeout: 15000 });
    } catch {
      return { success: false, error: 'No data rows loaded in by-company table' };
    }

    // Build date variants for matching
    const todayVariants = buildDateVariants(today);
    const yesterdayVariants = buildDateVariants(yesterday);

    onLog('Scraping table rows...');

    // Scrape rows using data-testid selectors
    const scrapeResult = await page.evaluate((args: { todayVars: string[]; yesterdayVars: string[] }) => {
      const results: { today: any; yesterday: any } = { today: null, yesterday: null };

      for (let i = 0; i < 10; i++) {
        const dateCell = document.querySelector(`[data-testid="tablerow-${i}-trx_date"]`);
        if (!dateCell) break;

        const dateText = (dateCell.textContent || '').trim().toLowerCase();

        // Get DP Count (plain number)
        const dpCountCell = document.querySelector(`[data-testid="tablerow-${i}-total_deposit_count"]`);
        const dpCount = (dpCountCell?.textContent || '0').trim();

        // Get DP Amount (in span.MuiTypography-amount or plain text)
        const dpAmountCell = document.querySelector(`[data-testid="tablerow-${i}-total_deposit_amount"]`);
        const dpAmountSpan = dpAmountCell?.querySelector('span.MuiTypography-amount');
        const dpAmount = (dpAmountSpan?.textContent || dpAmountCell?.textContent || '0').trim();

        // Get Valid Bet
        const validBetCell = document.querySelector(`[data-testid="tablerow-${i}-total_valid_bet_amount"]`);
        const validBetSpan = validBetCell?.querySelector('span.MuiTypography-amount');
        const validBet = (validBetSpan?.textContent || validBetCell?.textContent || '0').trim();

        const rowData = { date: (dateCell.textContent || '').trim(), dpCount, dpAmount, validBet };

        // Match today
        if (args.todayVars.some(v => dateText.includes(v.toLowerCase()))) {
          results.today = rowData;
        }
        // Match yesterday
        if (args.yesterdayVars.some(v => dateText.includes(v.toLowerCase()))) {
          results.yesterday = rowData;
        }
      }

      return results;
    }, { todayVars: todayVariants, yesterdayVars: yesterdayVariants });

    // Parse results
    let todayRow: VictorySPRow | undefined;
    let yesterdayRow: VictorySPRow | undefined;

    if (scrapeResult.today) {
      todayRow = {
        date: scrapeResult.today.date,
        dpCount: parseInt2(scrapeResult.today.dpCount),
        dpAmount: parseAmount(scrapeResult.today.dpAmount),
        validBet: parseAmount(scrapeResult.today.validBet),
      };
      onLog(`Today (${todayRow.date}): DP Count=${todayRow.dpCount}, DP Amount=${todayRow.dpAmount.toLocaleString('id-ID')}, Valid Bet=${todayRow.validBet.toLocaleString('id-ID')}`);
    } else {
      onLog('Today row not found in table', 'warning');
    }

    if (scrapeResult.yesterday) {
      yesterdayRow = {
        date: scrapeResult.yesterday.date,
        dpCount: parseInt2(scrapeResult.yesterday.dpCount),
        dpAmount: parseAmount(scrapeResult.yesterday.dpAmount),
        validBet: parseAmount(scrapeResult.yesterday.validBet),
      };
      onLog(`Yesterday (${yesterdayRow.date}): DP Count=${yesterdayRow.dpCount}, DP Amount=${yesterdayRow.dpAmount.toLocaleString('id-ID')}, Valid Bet=${yesterdayRow.validBet.toLocaleString('id-ID')}`);
    } else {
      onLog('Yesterday row not found in table', 'warning');
    }

    if (!todayRow && !yesterdayRow) {
      return { success: false, error: 'No matching date rows found in by-company table' };
    }

    onLog('Victory Summary Performance data scraped successfully', 'success');
    return { success: true, today: todayRow, yesterday: yesterdayRow };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[SP-VICTORY] Flow error: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Format number with Indonesian locale.
 */
export function formatIDR(num: number): string {
  if (num === 0) return '0';
  return num.toLocaleString('id-ID');
}

/**
 * Build HTML for Victory SP report (same layout as NUKE SP).
 */
export function buildVictorySPReportHtml(
  accountName: string,
  today?: VictorySPRow,
  yesterday?: VictorySPRow,
): string {
  const now = new Date();
  const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const fields: { label: string; key: keyof VictorySPRow }[] = [
    { label: 'DP Count', key: 'dpCount' },
    { label: 'DP Amount', key: 'dpAmount' },
    { label: 'Valid Bet', key: 'validBet' },
  ];

  const getVal = (row: VictorySPRow | undefined, key: keyof VictorySPRow): number => {
    if (!row) return 0;
    const v = row[key];
    return typeof v === 'number' ? v : 0;
  };

  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let rows = '';

  if (yesterday) {
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const val = getVal(yesterday, f.key);
      rows += `<tr>
        ${i === 0 ? `<td rowspan="${fields.length}" style="padding:10px 16px;border:1px solid #CBD5E1;font-weight:bold;font-size:14px;text-align:center;background:#FEF3C7;vertical-align:middle;">Kemarin<br><span style="font-size:11px;font-weight:normal;color:#92400E;">${escapeHtml(yesterday.date)}</span></td>` : ''}
        <td style="padding:8px 14px;border:1px solid #CBD5E1;font-size:13px;font-weight:600;">${f.label}</td>
        <td style="padding:8px 14px;border:1px solid #CBD5E1;font-size:13px;text-align:right;">${formatIDR(val)}</td>
      </tr>`;
    }
  }

  if (today) {
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const val = getVal(today, f.key);
      rows += `<tr>
        ${i === 0 ? `<td rowspan="${fields.length}" style="padding:10px 16px;border:1px solid #CBD5E1;font-weight:bold;font-size:14px;text-align:center;background:#DBEAFE;vertical-align:middle;">Hari Ini<br><span style="font-size:11px;font-weight:normal;color:#1E40AF;">${escapeHtml(today.date)}</span></td>` : ''}
        <td style="padding:8px 14px;border:1px solid #CBD5E1;font-size:13px;font-weight:600;">${f.label}</td>
        <td style="padding:8px 14px;border:1px solid #CBD5E1;font-size:13px;text-align:right;">${formatIDR(val)}</td>
      </tr>`;
    }
  }

  if (today && yesterday) {
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const todayVal = getVal(today, f.key);
      const yesterdayVal = getVal(yesterday, f.key);
      const diff = todayVal - yesterdayVal;
      const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '•';
      const sign = diff > 0 ? '+' : '';
      const color = diff > 0 ? '#059669' : diff < 0 ? '#DC2626' : '#6B7280';
      rows += `<tr style="background:#F0FDF4;">
        ${i === 0 ? `<td rowspan="${fields.length}" style="padding:10px 16px;border:1px solid #CBD5E1;font-weight:bold;font-size:14px;text-align:center;background:#0F766E;color:#fff;vertical-align:middle;">Selisih</td>` : ''}
        <td style="padding:8px 14px;border:1px solid #CBD5E1;font-size:13px;font-weight:600;">${f.label}</td>
        <td style="padding:8px 14px;border:1px solid #CBD5E1;font-size:13px;text-align:right;color:${color};font-weight:bold;">${arrow} ${sign}${formatIDR(diff)}</td>
      </tr>`;
    }
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background: #fff; }
  #report-container { padding: 24px; display: inline-block; min-width: 500px; }
  table { border-collapse: collapse; width: 100%; }
</style></head><body>
<div id="report-container">
  <div style="text-align:center;margin-bottom:16px;">
    <div style="font-size:20px;font-weight:bold;color:#1E3A5F;">SUMMARY PERFORMANCE VICTORY</div>
    <div style="font-size:16px;font-weight:600;color:#374151;margin-top:4px;">${escapeHtml(accountName)}</div>
    <div style="font-size:12px;color:#6B7280;margin-top:4px;">${escapeHtml(dateStr)}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="background:#E0E7FF;font-weight:bold;padding:10px 14px;border:1px solid #CBD5E1;font-size:13px;text-align:center;">Periode</th>
        <th style="background:#E0E7FF;font-weight:bold;padding:10px 14px;border:1px solid #CBD5E1;font-size:13px;text-align:center;">Metric</th>
        <th style="background:#E0E7FF;font-weight:bold;padding:10px 14px;border:1px solid #CBD5E1;font-size:13px;text-align:center;">Value</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div></body></html>`;
}
