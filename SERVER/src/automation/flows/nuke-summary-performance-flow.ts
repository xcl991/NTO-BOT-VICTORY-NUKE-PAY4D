import type { Page } from 'playwright';
import { NUKE_SELECTORS } from '../selectors/nuke-selectors';
import { handleMidSessionOtp } from './nuke-tarikdb-check-flow';
import logger from '../../utils/logger';

type LogCallback = (msg: string, level?: string) => void;

export interface SummaryPerformanceRow {
  date: string;               // "2026-03-12"
  activeUser: number;
  registerCount: number;
  firstDpCount: number;
  firstDpAmount: number;
  overallDpCount: number;
  overallDpAmount: number;
  overallWdCount: number;
  overallWdAmount: number;
  withdrawDifference: number;
  betCount: number;
  nto: number;
  userWL: number;
  agentWL: number;
}

export interface SummaryPerformanceResult {
  success: boolean;
  today?: SummaryPerformanceRow;
  yesterday?: SummaryPerformanceRow;
  summary?: SummaryPerformanceRow;
  error?: string;
}

/**
 * Parse Indonesian number format: dots as thousands separators.
 * E.g. "2.037" → 2037, "611.709.841" → 611709841, "-83.627.434" → -83627434
 */
function parseIdNumber(text: string): number {
  if (!text || text.trim() === '' || text.trim() === '-') return 0;
  // Remove dots (thousands separator) and trim
  const cleaned = text.trim().replace(/\./g, '').replace(/,/g, '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Convert DD-MM-YYYY to ISO date for URL: YYYY-MM-DDT00:00:00.000Z
 * Note: NUKE summary-performance uses startDate/endDate in URL query.
 * The URL uses UTC midnight directly (not WIB offset).
 */
function toIsoDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('-').map(Number);
  return `${yyyy}-${pad(mm)}-${pad(dd)}T00:00:00.000Z`;
}

/**
 * Get today and yesterday dates in DD-MM-YYYY format.
 */
function getTodayYesterday(): { today: string; yesterday: string; todayIso: string; yesterdayIso: string } {
  const now = new Date();
  const todayStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
  const yday = new Date(now);
  yday.setDate(yday.getDate() - 1);
  const yesterdayStr = `${pad(yday.getDate())}-${pad(yday.getMonth() + 1)}-${yday.getFullYear()}`;

  // ISO date for URL
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const yesterdayIso = `${yday.getFullYear()}-${pad(yday.getMonth() + 1)}-${pad(yday.getDate())}`;

  return { today: todayStr, yesterday: yesterdayStr, todayIso, yesterdayIso };
}

/**
 * NUKE Summary Performance Flow:
 *
 * Navigates to /report/summary-performance with date range (yesterday → today),
 * scrapes the Ant Design table with 14 columns, and returns structured data
 * for both days plus the SUMMARY row.
 *
 * URL format:
 * /report/summary-performance?page=0&size=10&startDate=YYYY-MM-DDT00:00:00.000Z&endDate=YYYY-MM-DDT00:00:00.000Z
 */
export async function nukeSummaryPerformanceFlow(
  page: Page,
  panelUrl: string,
  onLog: LogCallback,
  options: {
    twoFaSecret?: string;
  },
): Promise<SummaryPerformanceResult> {
  const S = NUKE_SELECTORS.summaryPerformance;

  try {
    const baseUrl = panelUrl.replace(/\/+$/, '');
    const { todayIso, yesterdayIso } = getTodayYesterday();

    // Build URL with date range: yesterday to today
    const url = `${baseUrl}/report/summary-performance?page=0&size=10&startDate=${yesterdayIso}T00:00:00.000Z&endDate=${todayIso}T00:00:00.000Z`;
    onLog(`Navigating to Summary Performance page...`);
    onLog(`URL: ${url}`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    // Handle mid-session OTP if 2FA modal appears
    const otpResult = await handleMidSessionOtp(page, onLog, options.twoFaSecret);
    if (otpResult === 'needs_otp') {
      return { success: false, error: 'OTP required but no twoFaSecret configured' };
    }
    if (otpResult === 'handled') {
      onLog('OTP handled, re-navigating to Summary Performance page...');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    }

    // Wait for table to load
    onLog('Waiting for table to load...');
    try {
      await page.waitForSelector(`${S.tableRows}, ${S.tablePlaceholder}`, { timeout: 15000 });
    } catch {
      return { success: false, error: 'Table did not load within timeout' };
    }

    // Wait for loading spinner to disappear
    try {
      await page.waitForSelector(S.tableLoading, { state: 'hidden', timeout: 10000 });
    } catch {
      // May not have appeared at all, continue
    }

    await page.waitForTimeout(1000);

    // Check for empty table
    const placeholder = await page.$(S.tablePlaceholder);
    if (placeholder) {
      return { success: false, error: 'No data found in summary performance table' };
    }

    // Scrape all data rows from the main table
    onLog('Scraping table data...');
    const dataRows: { key: string; values: string[] }[] = await page.evaluate((selector: string) => {
      const doc = (globalThis as any).document;
      const rows = doc.querySelectorAll(selector);
      const result: { key: string; values: string[] }[] = [];
      for (const row of Array.from(rows) as any[]) {
        const cells = row.querySelectorAll('td');
        const values: string[] = [];
        for (const cell of Array.from(cells) as any[]) {
          const span = cell.querySelector('span[style]');
          values.push((span?.textContent || cell.textContent || '').trim());
        }
        result.push({ key: row.getAttribute('data-row-key') || '', values });
      }
      return result;
    }, S.tableRows);

    onLog(`Found ${dataRows.length} data rows`);

    // Also scrape the SUMMARY row from the footer table
    let summaryValues: string[] = [];
    try {
      const summaryExists = await page.$(S.summaryRow);
      if (summaryExists) {
        summaryValues = await page.evaluate((selector: string) => {
          const doc = (globalThis as any).document;
          const row = doc.querySelector(selector);
          if (!row) return [];
          const cells = row.querySelectorAll('td');
          const values: string[] = [];
          for (const cell of Array.from(cells) as any[]) {
            const span = cell.querySelector('span[style]');
            values.push((span?.textContent || cell.textContent || '').trim());
          }
          return values;
        }, S.summaryRow);
      }
    } catch {
      onLog('Could not find SUMMARY row in footer', 'warning');
    }

    // Parse rows into structured data
    const parseRow = (values: string[], dateKey: string): SummaryPerformanceRow => ({
      date: dateKey || values[0] || '',
      activeUser: parseIdNumber(values[1]),
      registerCount: parseIdNumber(values[2]),
      firstDpCount: parseIdNumber(values[3]),
      firstDpAmount: parseIdNumber(values[4]),
      overallDpCount: parseIdNumber(values[5]),
      overallDpAmount: parseIdNumber(values[6]),
      overallWdCount: parseIdNumber(values[7]),
      overallWdAmount: parseIdNumber(values[8]),
      withdrawDifference: parseIdNumber(values[9]),
      betCount: parseIdNumber(values[10]),
      nto: parseIdNumber(values[11]),
      userWL: parseIdNumber(values[12]),
      agentWL: parseIdNumber(values[13]),
    });

    // Identify today and yesterday rows by data-row-key (date format: YYYY-MM-DD)
    const { todayIso: tIso, yesterdayIso: yIso } = getTodayYesterday();
    let todayRow: SummaryPerformanceRow | undefined;
    let yesterdayRow: SummaryPerformanceRow | undefined;

    for (const row of dataRows) {
      if (row.key === tIso) {
        todayRow = parseRow(row.values, row.key);
        onLog(`Today (${tIso}): Active=${todayRow.activeUser}, DP Count=${todayRow.overallDpCount}, NTO=${todayRow.nto}`);
      } else if (row.key === yIso) {
        yesterdayRow = parseRow(row.values, row.key);
        onLog(`Yesterday (${yIso}): Active=${yesterdayRow.activeUser}, DP Count=${yesterdayRow.overallDpCount}, NTO=${yesterdayRow.nto}`);
      }
    }

    // Parse SUMMARY row if available
    let summaryRow: SummaryPerformanceRow | undefined;
    if (summaryValues.length >= 14) {
      summaryRow = parseRow(summaryValues, 'SUMMARY');
    }

    if (!todayRow && !yesterdayRow) {
      return { success: false, error: `No data rows found for ${tIso} or ${yIso}` };
    }

    onLog('Summary Performance data scraped successfully', 'success');

    return {
      success: true,
      today: todayRow,
      yesterday: yesterdayRow,
      summary: summaryRow,
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[SP-NUKE] Flow error: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Format a number with Indonesian locale (dots as thousands separator).
 */
export function formatIDR(num: number): string {
  if (num === 0) return '0';
  return num.toLocaleString('id-ID');
}

/**
 * Build HTML for SP report table (Yesterday vs Today vs Selisih) → rendered as PNG.
 * Only shows: DP Count, DP Amount, NTO.
 */
export function buildSPReportHtml(
  accountName: string,
  today?: SummaryPerformanceRow,
  yesterday?: SummaryPerformanceRow,
): string {
  const now = new Date();
  const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const fields: { label: string; key: keyof SummaryPerformanceRow }[] = [
    { label: 'DP Count', key: 'overallDpCount' },
    { label: 'DP Amount', key: 'overallDpAmount' },
    { label: 'NTO', key: 'nto' },
  ];

  const getVal = (row: SummaryPerformanceRow | undefined, key: keyof SummaryPerformanceRow): number => {
    if (!row) return 0;
    const v = row[key];
    return typeof v === 'number' ? v : 0;
  };

  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Build table rows
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

  // Selisih section
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
    <div style="font-size:20px;font-weight:bold;color:#1E3A5F;">SUMMARY PERFORMANCE NUKE</div>
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
