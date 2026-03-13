import type { Page } from 'playwright';
import type { LiveReportRawRow, CompanyReportRow } from '../flows/victory-livereport-flow';
import logger from '../../utils/logger';

// ============================================================
// Types
// ============================================================

export type LiveReportMode = 'MKT' | 'REBORN';

interface MemberData {
  REGIS: number;
  FIRST_DP: number;
  FIRST_DP_AMT: number;
  DP: number;
  DP_AMT: number;
  VALID_BET: number;
  WINLOSE: number;
}

/** team number → { memberName → data, SUM → data } */
export type TeamSummary = Record<number, Record<string, MemberData>>;

export interface TableRow {
  label: string;
  regis: number;
  firstDp: number;
  closingPct: number;
  firstDpAmt: number;
  avgPerform: number;
  dp: number;
  dpAmt: number;
  avgDpPerform: number;
  validBet: number;
  winlose: number;
  isTeamTotal: boolean;
  isGrandTotal: boolean;
  isMemberCount: boolean;
}

export interface LiveReportResult {
  tableRows: TableRow[];
  summary: TeamSummary;
  memberCount: number;
  mode: LiveReportMode;
}

export interface Top5Rankings {
  ndp: string[];
  closingRate: string[];
  turnover: string[];
  tx: string[];
  dpAmt: string[];
  bottom5Ndp: string[];
}

// ============================================================
// Constants
// ============================================================

const AVG_THRESH = 100_000;
const CLOSING_GREEN = 70.0;

const MOTIVATIONAL_QUOTES = [
  "YOKK GAS LAGI, SEMANGATIN ANAK2 NYA!",
  "JANGAN NGANTUK DULU, TARGETNYA BELUM KEJAR! KOPI UDAH SIAP NIH",
  "NDP MASIH SEGITU? HMM... SEPERTINYA PERLU DICOLEK SEDIKIT BIAR NAIK",
  "KASIH BENSIN PERTAMAX DULU BIAR TANCAP GAS ANGKA NDP NYA!",
  "TARGETNYA NGGA TAKUT SAMA KAMU TUH, YUK KITA TAKUT-TAKUTIN DIA BARENG-BARUAN!",
  "UDAH JAM SEGINI, NDP MASIH SEGITU? AYO DONG DIKASIH TENAGA DALAM",
  "KALAU TARGETNYA LARI, YA KITA KEJAR! JANGAN MALAH SCROLL TIKTOK",
  "SEMANGATTT!!! INGAT, NDP TIDAK AKAN NAIK KALAU CUMA DITATAP",
  "GAS POL REM BLONG! TAPI JANGAN NABRAK TARGET LAIN YAH, FOKUS SAMA NDP SENDIRI!",
  "JANGAN CUMA BACAIN PESAN INI, SEKARANG GILIRAN NGEGAS NDP NYA!",
  "KALAU CAPEK, MINUM KOPI DULU. HABIS ITU LANGSUNG GAS LAGI NDP NYA!",
  "YANG LAMBAT, GUE PANGGILIN TARGETNYA BUAT NGINGETIN",
  "YUK DONG DI PUSH LAGI, JANGAN KASIH KENDOR ABANGKUH",
  "CAPEK SEDIKIT GAPAPA, YANG PENTING NDP NAIK DAN BOS TERSENYUM",
  "INGATTT... YANG NGASIH BONUS ITU BUKAN SEMANGAT, TAPI HASIL",
  "JANGAN NGALAH SAMA ANGKA, KITA YANG HARUS BIKIN ANGKANYA TAKUT",
  "TARGET MASIH UDH LARI DULUAN TUH! AYO DIKEJAR !!",
  "AYOOO... BUKAN SAATNYA REBAHAN, SAATNYA NDP NANJAKKK!",
  "KATA NDP: 'KALAU BUKAN SEKARANG, KAPAN LAGI NIH BOS?'",
  "YANG BELUM NAIK NDP, CEPET DEH! TAKUTNYA NANTI DITINGGAL BONUS",
];

// ============================================================
// Number Parsing
// ============================================================

function parseInt2(s: string): number {
  if (!s) return 0;
  const m = s.replace(/,/g, '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function parseAmount(s: string): number {
  if (!s) return 0;
  let cleaned = s.replace(/[^0-9,.\-]/g, '').replace(/\./g, '').replace(',', '.');
  try {
    return parseFloat(cleaned) || 0;
  } catch {
    return 0;
  }
}

function formatIdr(v: number): string {
  const neg = v < 0;
  const n = Math.round(Math.abs(v));
  const s = n.toLocaleString('id-ID');
  return (neg ? '-' : '') + 'Rp' + s;
}

function formatPct(v: number): string {
  return `${Math.round(v)}%`;
}

// ============================================================
// Username Parsing
// ============================================================

/**
 * MKT mode: teammkt1glen → [1, "GLEN"]
 * Dynamic prefix: uses uplineUsername as prefix (e.g., "teammkt")
 */
function usernameKeyMkt(u: string, prefix: string): [number, string] | null {
  const clean = u.toLowerCase().replace(/_/g, '').trim();
  const escaped = prefix.toLowerCase().replace(/_/g, '');
  const re = new RegExp(`^${escaped}(\\d+)([a-z]*)`, 'i');
  const m = clean.match(re);
  if (m) return [parseInt(m[1], 10), (m[2] || '').toUpperCase()];
  return null;
}

/**
 * REBORN mode: teamreborn1a → [1, "A"]
 * Dynamic prefix: uses uplineUsername as prefix (e.g., "teamreborn", "superalx")
 */
function usernameKeyReborn(u: string, prefix: string): [number, string] | null {
  const clean = u.replace(/_/g, '');
  const escaped = prefix.replace(/_/g, '');
  const re = new RegExp(`^${escaped}\\s*(\\d+)\\s*([a-zA-Z])?`, 'i');
  const m = clean.match(re);
  if (m) return [parseInt(m[1], 10), (m[2] || '').toUpperCase()];
  return null;
}

// ============================================================
// Summarize
// ============================================================

function blankData(): MemberData {
  return { REGIS: 0, FIRST_DP: 0, FIRST_DP_AMT: 0, DP: 0, DP_AMT: 0, VALID_BET: 0, WINLOSE: 0 };
}

/**
 * Summarize raw rows by team/member.
 * Column indices match Python's scrape_rows output.
 * @param uplinePrefix - the upline username prefix (e.g., "teammkt", "teamreborn", "superalx")
 */
export function summarize(rows: LiveReportRawRow[], mode: LiveReportMode, uplinePrefix?: string): TeamSummary {
  const out: TeamSummary = {};
  const prefix = uplinePrefix || (mode === 'MKT' ? 'teammkt' : 'teamreborn');

  for (const row of rows) {
    const vals = row.cells;
    const user = (vals[0] || '').trim();

    const key = mode === 'MKT' ? usernameKeyMkt(user, prefix) : usernameKeyReborn(user, prefix);
    if (!key) continue;

    const [n, letter] = key;
    const m = blankData();
    m.REGIS = parseInt2(vals[2] || '');
    m.FIRST_DP = parseInt2(vals[3] || '');
    m.FIRST_DP_AMT = parseAmount(vals[4] || '');
    m.DP = parseInt2(vals[5] || '');
    m.DP_AMT = parseAmount(vals[6] || '');
    m.VALID_BET = parseAmount(vals[14] || '');
    m.WINLOSE = parseAmount(vals[19] || '');

    if (!out[n]) out[n] = {};
    out[n][letter] = m;
  }

  // Compute SUM per team
  for (const n of Object.keys(out).map(Number)) {
    const d = out[n];
    const s = blankData();
    for (const [letter, mm] of Object.entries(d)) {
      if (letter === 'SUM') continue;
      s.REGIS += mm.REGIS;
      s.FIRST_DP += mm.FIRST_DP;
      s.FIRST_DP_AMT += mm.FIRST_DP_AMT;
      s.DP += mm.DP;
      s.DP_AMT += mm.DP_AMT;
      s.VALID_BET += mm.VALID_BET;
      s.WINLOSE += mm.WINLOSE;
    }
    d['SUM'] = s;
  }

  return out;
}

/**
 * Count total team members (excluding SUM keys).
 */
export function countMembers(summary: TeamSummary): number {
  let c = 0;
  for (const d of Object.values(summary)) {
    c += Object.keys(d).filter(k => k !== 'SUM').length;
  }
  return c;
}

/**
 * Build table rows from summary.
 */
export function buildTableRows(summary: TeamSummary, mode: LiveReportMode, uplinePrefix?: string): TableRow[] {
  const rows: TableRow[] = [];
  const sortedTeams = Object.keys(summary).map(Number).sort((a, b) => a - b);

  for (const n of sortedTeams) {
    const d = summary[n];
    const names = Object.keys(d).filter(k => k !== 'SUM');

    // Check if this team has only unnamed members (no letter suffix — e.g., superalx1)
    const hasNoLetterMembers = names.length === 1 && names[0] === '';

    // Sort names
    const sortedNames = mode === 'REBORN'
      ? names.sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0))
      : names.sort();

    // Member rows
    for (const name of sortedNames) {
      const m = d[name];
      let label: string;
      if (hasNoLetterMembers && uplinePrefix) {
        // Use original username: e.g., "superalx1", "superalx10"
        label = `${uplinePrefix}${n}`;
      } else {
        label = mode === 'MKT' ? `TEAM ${n} - ${name}` : `${n}${name}`;
      }
      const closingPct = m.REGIS ? (m.FIRST_DP / m.REGIS) * 100 : 0;
      const avgPerform = m.FIRST_DP ? m.FIRST_DP_AMT / m.FIRST_DP : 0;
      const avgDpPerform = m.DP ? m.DP_AMT / m.DP : 0;

      rows.push({
        label, regis: m.REGIS, firstDp: m.FIRST_DP, closingPct,
        firstDpAmt: m.FIRST_DP_AMT, avgPerform, dp: m.DP, dpAmt: m.DP_AMT,
        avgDpPerform, validBet: m.VALID_BET, winlose: m.WINLOSE,
        isTeamTotal: false, isGrandTotal: false, isMemberCount: false,
      });
    }

    // Skip team total when team has only 1 unnamed member (redundant)
    if (hasNoLetterMembers) continue;

    // Team total row
    if (d['SUM']) {
      const m = d['SUM'];
      const subLabel = mode === 'MKT' ? `TOTAL TEAM ${n}` : `${n} TOTAL`;
      const closingPct = m.REGIS ? (m.FIRST_DP / m.REGIS) * 100 : 0;
      const avgPerform = m.FIRST_DP ? m.FIRST_DP_AMT / m.FIRST_DP : 0;
      const avgDpPerform = m.DP ? m.DP_AMT / m.DP : 0;

      rows.push({
        label: subLabel, regis: m.REGIS, firstDp: m.FIRST_DP, closingPct,
        firstDpAmt: m.FIRST_DP_AMT, avgPerform, dp: m.DP, dpAmt: m.DP_AMT,
        avgDpPerform, validBet: m.VALID_BET, winlose: m.WINLOSE,
        isTeamTotal: true, isGrandTotal: false, isMemberCount: false,
      });
    }
  }

  // Grand total
  const allSum = blankData();
  for (const d of Object.values(summary)) {
    const s = d['SUM'];
    if (s) {
      allSum.REGIS += s.REGIS;
      allSum.FIRST_DP += s.FIRST_DP;
      allSum.FIRST_DP_AMT += s.FIRST_DP_AMT;
      allSum.DP += s.DP;
      allSum.DP_AMT += s.DP_AMT;
      allSum.VALID_BET += s.VALID_BET;
      allSum.WINLOSE += s.WINLOSE;
    }
  }

  if (Object.values(allSum).some(v => v !== 0)) {
    const closingPct = allSum.REGIS ? (allSum.FIRST_DP / allSum.REGIS) * 100 : 0;
    const avgPerform = allSum.FIRST_DP ? allSum.FIRST_DP_AMT / allSum.FIRST_DP : 0;
    const avgDpPerform = allSum.DP ? allSum.DP_AMT / allSum.DP : 0;

    rows.push({
      label: 'ALL TOTAL', regis: allSum.REGIS, firstDp: allSum.FIRST_DP, closingPct,
      firstDpAmt: allSum.FIRST_DP_AMT, avgPerform, dp: allSum.DP, dpAmt: allSum.DP_AMT,
      avgDpPerform, validBet: allSum.VALID_BET, winlose: allSum.WINLOSE,
      isTeamTotal: false, isGrandTotal: true, isMemberCount: false,
    });

    const memberCount = countMembers(summary);
    rows.push({
      label: `TOTAL ${memberCount} ORANG`, regis: 0, firstDp: 0, closingPct: 0,
      firstDpAmt: 0, avgPerform: 0, dp: 0, dpAmt: 0,
      avgDpPerform: 0, validBet: 0, winlose: 0,
      isTeamTotal: false, isGrandTotal: true, isMemberCount: true,
    });
  }

  return rows;
}

// ============================================================
// Top 5 Rankings
// ============================================================

export function computeTop5(tableRows: TableRow[]): Top5Rankings {
  const members = tableRows.filter(r => !r.isTeamTotal && !r.isGrandTotal && !r.isMemberCount);
  if (members.length === 0) {
    return { ndp: [], closingRate: [], turnover: [], tx: [], dpAmt: [], bottom5Ndp: [] };
  }

  const byNdp = [...members].sort((a, b) => b.firstDp - a.firstDp);
  const byClosing = [...members].sort((a, b) => b.closingPct - a.closingPct);
  const byTO = [...members].sort((a, b) => b.validBet - a.validBet);
  const byTx = [...members].sort((a, b) => b.dp - a.dp);
  const byDpAmt = [...members].sort((a, b) => b.dpAmt - a.dpAmt);

  const fmt = (arr: TableRow[], valFn: (r: TableRow) => string) =>
    arr.slice(0, 5).map((r, i) => `${i + 1}) ${r.label} — ${valFn(r)}`);

  return {
    ndp: fmt(byNdp, r => String(r.firstDp)),
    closingRate: fmt(byClosing, r => formatPct(r.closingPct)),
    turnover: fmt(byTO, r => formatIdr(r.validBet)),
    tx: fmt(byTx, r => String(r.dp)),
    dpAmt: fmt(byDpAmt, r => formatIdr(r.dpAmt)),
    bottom5Ndp: byNdp.slice(-5).reverse().map((r, i) => `${i + 1}) ${r.label} — ${r.firstDp}`),
  };
}

export function getRandomQuote(): string {
  return MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
}

// ============================================================
// Telegram Caption Builder
// ============================================================

export function buildTelegramCaption(
  title: string,
  tableRows: TableRow[],
  includeTopBottom: boolean = false,
): string {
  let caption = title;

  if (includeTopBottom) {
    const top5 = computeTop5(tableRows);
    if (top5.ndp.length > 0) {
      caption += '\n\nTOP 5 - NDP\n' + top5.ndp.join('\n');
      caption += '\n\nBOTTOM 5 - NDP\n' + top5.bottom5Ndp.join('\n');
      caption += '\n\n' + getRandomQuote();
    }
  }

  return caption;
}

// ============================================================
// HTML Table Renderer → PNG via Playwright
// ============================================================

/**
 * Render the live report table as an HTML page and screenshot it to PNG.
 * Uses the browser page to render styled HTML and take a screenshot.
 */
export async function renderTableToPng(
  page: Page,
  tableRows: TableRow[],
  title: string,
  top5: Top5Rankings,
): Promise<Buffer> {
  const html = buildHtmlTable(tableRows, title, top5);

  // Navigate to a blank page and set content
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // Screenshot the report container
  const container = await page.$('#report-container');
  let pngBuffer: Buffer;
  if (container) {
    pngBuffer = await container.screenshot({ type: 'png' });
  } else {
    pngBuffer = await page.screenshot({ type: 'png', fullPage: true });
  }

  return pngBuffer;
}

/**
 * Build HTML table string for rendering.
 */
function buildHtmlTable(tableRows: TableRow[], title: string, top5: Top5Rankings): string {
  const columns = [
    'Team', 'REGIS', '1st DP', 'Closing %', '1st DP Amt', 'AVG PERFORM',
    'DP', 'DP Amt', 'AVG DP PERFORM', 'Valid Bet', 'Winlose',
  ];

  let tableBody = '';
  for (const row of tableRows) {
    let rowClass = '';
    let rowStyle = '';

    if (row.isGrandTotal) {
      rowStyle = 'background-color:#0F766E;color:#fff;font-weight:bold;';
    } else if (row.isTeamTotal) {
      rowStyle = 'background-color:#FEF3C7;font-weight:bold;';
    }

    const cells = [
      { val: row.label, align: 'left', fmt: row.label },
      { val: row.regis, align: 'center', fmt: row.isMemberCount ? '' : String(row.regis) },
      { val: row.firstDp, align: 'center', fmt: row.isMemberCount ? '' : String(row.firstDp) },
      { val: row.closingPct, align: 'center', fmt: row.isMemberCount ? '' : formatPct(row.closingPct) },
      { val: row.firstDpAmt, align: 'right', fmt: row.isMemberCount ? '' : formatIdr(row.firstDpAmt) },
      { val: row.avgPerform, align: 'right', fmt: row.isMemberCount ? '' : formatIdr(row.avgPerform) },
      { val: row.dp, align: 'center', fmt: row.isMemberCount ? '' : String(row.dp) },
      { val: row.dpAmt, align: 'right', fmt: row.isMemberCount ? '' : formatIdr(row.dpAmt) },
      { val: row.avgDpPerform, align: 'right', fmt: row.isMemberCount ? '' : formatIdr(row.avgDpPerform) },
      { val: row.validBet, align: 'right', fmt: row.isMemberCount ? '' : formatIdr(row.validBet) },
      { val: row.winlose, align: 'right', fmt: row.isMemberCount ? '' : formatIdr(row.winlose) },
    ];

    let cellsHtml = '';
    for (let i = 0; i < cells.length; i++) {
      let cellStyle = `text-align:${cells[i].align};padding:6px 10px;border:1px solid #CBD5E1;font-size:13px;`;

      // Conditional coloring for plain rows only
      const isPlainRow = !row.isGrandTotal && !row.isTeamTotal && !row.isMemberCount;

      // AVG PERFORM (index 5) and AVG DP PERFORM (index 8)
      if ((i === 5 || i === 8) && isPlainRow && typeof cells[i].val === 'number') {
        const v = cells[i].val as number;
        if (v >= AVG_THRESH) {
          cellStyle += 'background-color:#D1FAE5;color:#065F46;';
        } else {
          cellStyle += 'background-color:#FEE2E2;color:#991B1B;';
        }
      }

      // Closing % (index 3)
      if (i === 3 && isPlainRow && typeof cells[i].val === 'number') {
        const v = cells[i].val as number;
        if (v >= CLOSING_GREEN) {
          cellStyle += 'background-color:#D1FAE5;color:#065F46;';
        } else {
          cellStyle += 'background-color:#FEE2E2;color:#991B1B;';
        }
      }

      cellsHtml += `<td style="${cellStyle}">${cells[i].fmt}</td>`;
    }

    tableBody += `<tr style="${rowStyle}">${cellsHtml}</tr>`;
  }

  // Top 5 boxes
  const top5Sections = [
    { title: 'TOP NDP', items: top5.ndp },
    { title: 'TOP CLOSING RATE', items: top5.closingRate },
    { title: 'TOP TURNOVER', items: top5.turnover },
    { title: 'TOP TX', items: top5.tx },
    { title: 'TOP DP AMT', items: top5.dpAmt },
  ];

  let top5Html = '';
  for (const section of top5Sections) {
    const items = section.items.length > 0
      ? section.items.map(s => `<div style="font-size:14px;margin:3px 0;">${escapeHtml(s)}</div>`).join('')
      : '<div style="font-size:14px;">-</div>';
    top5Html += `
      <div style="flex:1;border:2px solid #94A3B8;border-radius:8px;padding:12px;min-width:180px;">
        <div style="font-weight:bold;font-size:16px;margin-bottom:8px;">${section.title}</div>
        ${items}
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background: #fff; }
    #report-container { padding: 20px; display: inline-block; min-width: 1200px; }
    h1 { font-size: 20px; margin: 0 0 16px 0; text-align: center; }
    table { border-collapse: collapse; width: 100%; }
    th { background-color: #E0E7FF; font-weight: bold; padding: 8px 10px; border: 1px solid #CBD5E1; font-size: 13px; text-align: center; }
  </style>
</head>
<body>
  <div id="report-container">
    <h1>${escapeHtml(title)}</h1>
    <table>
      <thead>
        <tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr>
      </thead>
      <tbody>${tableBody}</tbody>
    </table>
    <div style="display:flex;gap:12px;margin-top:20px;flex-wrap:wrap;">
      ${top5Html}
    </div>
  </div>
</body>
</html>`;
}

/**
 * Render company report data as a standalone PNG image.
 */
export async function renderCompanyReportToPng(
  page: Page,
  data: CompanyReportRow,
  title: string,
): Promise<Buffer> {
  const html = buildCompanyHtmlPage(data, title);
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const container = await page.$('#report-container');
  if (container) {
    return await container.screenshot({ type: 'png' });
  }
  return await page.screenshot({ type: 'png', fullPage: true });
}

function buildCompanyHtmlPage(data: CompanyReportRow, title: string): string {
  const fmtIdr = (n: number) => n.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const fmtInt = (n: number) => n.toLocaleString('id-ID');
  const wlColor = (n: number) => n < 0 ? 'color:#DC2626;font-weight:bold;' : n > 0 ? 'color:#059669;font-weight:bold;' : '';

  const rows: [string, string, string, string?][] = [
    ['Date', data.date, 'left'],
    ['Reg. Count', fmtInt(data.regCount), 'right'],
    ['Unique Login Count', fmtInt(data.loginCount), 'right'],
    ['1st #DP', fmtInt(data.firstDpCount), 'right'],
    ['1st #DP Amount', fmtIdr(data.firstDpAmount), 'right'],
    ['#DP', fmtInt(data.dpCount), 'right'],
    ['DP Amount', fmtIdr(data.dpAmount), 'right'],
    ['DP User', fmtInt(data.dpUser), 'right'],
    ['#WD', fmtInt(data.wdCount), 'right'],
    ['WD Amount', fmtIdr(data.wdAmount), 'right'],
    ['WD User', fmtInt(data.wdUser), 'right'],
    ['DP/WD Diff', fmtIdr(data.dpWdDiff), 'right', wlColor(data.dpWdDiff)],
    ['#Adjustment', fmtInt(data.adjustmentCount), 'right'],
    ['Adjustment Amount', fmtIdr(data.adjustmentAmount), 'right'],
    ['#Bet', fmtInt(data.betCount), 'right'],
    ['Bet Amount', fmtIdr(data.betAmount), 'right'],
    ['Valid Bet', fmtIdr(data.validBet), 'right'],
    ['Player Win/Loss', fmtIdr(data.playerWinloss), 'right', wlColor(data.playerWinloss)],
    ['Promo', fmtIdr(data.promo), 'right'],
    ['Rebate', fmtIdr(data.rebate), 'right'],
    ['Referral Commission', fmtIdr(data.commission), 'right'],
    ['Total Win/Loss', fmtIdr(data.totalWinloss), 'right', wlColor(data.totalWinloss)],
    ['FRB', fmtIdr(data.frb), 'right'],
    ['JPC', fmtIdr(data.jpc), 'right'],
  ];

  let rowsHtml = '';
  for (const [label, value, align, extraStyle] of rows) {
    const style = extraStyle || '';
    rowsHtml += `<tr>
      <td style="text-align:left;font-weight:bold;background-color:#F8FAFC;padding:8px 14px;border:1px solid #CBD5E1;font-size:14px;">${label}</td>
      <td style="text-align:${align};padding:8px 14px;border:1px solid #CBD5E1;font-size:14px;${style}">${value}</td>
    </tr>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background: #fff; }
    #report-container { padding: 24px; display: inline-block; min-width: 500px; }
    h1 { font-size: 20px; margin: 0 0 16px 0; text-align: center; color: #1E40AF; }
    table { border-collapse: collapse; width: 100%; }
    th { background-color: #DBEAFE; font-weight: bold; padding: 10px 14px; border: 1px solid #CBD5E1; font-size: 14px; text-align: center; }
  </style>
</head>
<body>
  <div id="report-container">
    <h1>${escapeHtml(title)}</h1>
    <table>
      <thead>
        <tr><th style="width:220px;">Metric</th><th>Value</th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
