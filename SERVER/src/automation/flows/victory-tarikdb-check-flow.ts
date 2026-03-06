import type { Page } from 'playwright';
import { VICTORY_SELECTORS } from '../selectors/victory-selectors';
import { setMuiDatePicker, parseDateParts } from './victory-nto-check-flow';
import type { TarikDbCheckResult, TarikDbRow } from './nuke-tarikdb-check-flow';
import logger from '../../utils/logger';

const S = VICTORY_SELECTORS;
const PAGE_SIZE = 1000;

type LogCallback = (msg: string, level?: string) => void;

/**
 * Victory TARIK DB Check Flow (2-Cycle approach matching Python reference):
 *
 * Scrapes /player/contact-data page with TWO filter cycles:
 * - Cycle 1: deposit_status=false → "REGIS ONLY"
 * - Cycle 2: deposit_status=true  → "REGIS + DEPO"
 * Then merges results (REGIS+DEPO first, then REGIS ONLY).
 */
export async function victoryTarikDbCheckFlow(
  page: Page,
  panelUrl: string,
  onLog: LogCallback,
  options: {
    dateStart?: string;    // DD-MM-YYYY (optional for old_user mode)
    dateEnd?: string;      // DD-MM-YYYY (optional for old_user mode)
    username?: string;     // Optional: specific username filter (date_range mode)
    usernames?: string[];  // Multiple usernames (old_user mode)
    maxPages?: number;     // Default 10
  },
): Promise<TarikDbCheckResult> {
  const isOldUser = !options.dateStart || !options.dateEnd;

  try {
    // === Navigate to contact-data page ===
    const baseUrl = panelUrl.replace(/\/+$/, '').replace(/\/login\/?$/, '');
    const contactUrl = `${baseUrl}/player/contact-data`;

    onLog(`Navigating to contact-data${isOldUser ? ' (Old User mode)' : `: ${options.dateStart} s/d ${options.dateEnd}`}`);
    await page.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.setViewportSize({ width: 2560, height: 1440 });
    onLog('Contact data page loaded (viewport 2560x1440)');

    // === OLD USER MODE: Loop per username ===
    if (isOldUser && options.usernames && options.usernames.length > 0) {
      const allRows: TarikDbRow[] = [];

      for (let i = 0; i < options.usernames.length; i++) {
        const uname = options.usernames[i];
        onLog(`[${i + 1}/${options.usernames.length}] Searching: ${uname}`);

        // Run 2-cycle for each username
        const cycleOpts = { ...options, username: uname };

        onLog(`--- Cycle 1 (${uname}): NON DEPOSIT ---`);
        const regisOnly = await runFilterCycle(page, onLog, cycleOpts, false);

        onLog(`--- Cycle 2 (${uname}): DEPOSIT ---`);
        const regisDepo = await runFilterCycle(page, onLog, cycleOpts, true);

        if (regisDepo.length > 0 || regisOnly.length > 0) {
          allRows.push(...regisDepo, ...regisOnly);
          onLog(`"${uname}": ${regisDepo.length} REGIS+DEPO, ${regisOnly.length} REGIS ONLY`, 'success');
        } else {
          allRows.push({ username: uname, wallet: '-', phone: '-', status: 'NOT FOUND', joinDate: '-' });
          onLog(`"${uname}": not found`, 'warning');
        }
      }

      onLog(`Old User TARIK DB complete! ${allRows.length} result(s) from ${options.usernames.length} username(s)`, 'success');
      return { success: true, rows: allRows, totalItems: allRows.length };
    }

    // === DATE RANGE MODE (existing flow) ===
    onLog('--- CYCLE 1: Fetching NON DEPOSIT (REGIS ONLY) ---');
    const regisOnlyRows = await runFilterCycle(page, onLog, options, false);
    onLog(`Cycle 1 result: ${regisOnlyRows.length} REGIS ONLY`);

    onLog('--- CYCLE 2: Fetching DEPOSIT (REGIS + DEPO) ---');
    const regisDepoRows = await runFilterCycle(page, onLog, options, true);
    onLog(`Cycle 2 result: ${regisDepoRows.length} REGIS + DEPO`);

    const allRows = [...regisDepoRows, ...regisOnlyRows];

    onLog(`TARIK DB complete! ${allRows.length} member(s) (${regisDepoRows.length} REGIS+DEPO, ${regisOnlyRows.length} REGIS ONLY)`, 'success');
    return { success: true, rows: allRows, totalItems: allRows.length };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`TARIK DB error: ${msg}`, 'error');
    return { success: false, rows: [], error: msg };
  }
}

// ============================================================
// Filter Cycle — sets deposit_status, dates, then scrapes
// ============================================================

async function runFilterCycle(
  page: Page,
  onLog: LogCallback,
  options: { dateStart?: string; dateEnd?: string; username?: string; maxPages?: number },
  isDeposit: boolean,
): Promise<TarikDbRow[]> {
  const statusLabel = isDeposit ? 'REGIS + DEPO' : 'REGIS ONLY';
  const hasDates = !!(options.dateStart && options.dateEnd);

  // 1. Set deposit_status dropdown
  try {
    const depositDropdown = await page.$(S.contactData.depositStatusSelect);
    if (depositDropdown) {
      await depositDropdown.click();
      await page.waitForTimeout(500);
      const optionSelector = isDeposit ? S.contactData.depositStatusTrue : S.contactData.depositStatusFalse;
      await page.click(optionSelector, { timeout: 5000 });
      await page.waitForTimeout(500);
      onLog(`Deposit status set to: ${isDeposit ? 'YES' : 'NO'}`);
    } else {
      onLog('Deposit status dropdown not found', 'warning');
    }
  } catch (err) {
    onLog(`Deposit status set failed: ${err instanceof Error ? err.message : err}`, 'warning');
  }

  // 2. Set "Filter Date By" to "Registered Date" (only if we have dates)
  if (hasDates) {
    try {
      const filterDateEl = await page.$(S.contactData.filterDateBySelect);
      if (filterDateEl) {
        const currentText = await filterDateEl.textContent();
        if (!currentText?.includes('Registered Date')) {
          await filterDateEl.click();
          await page.waitForTimeout(500);
          await page.click(S.contactData.registeredDateOption, { timeout: 5000 });
          await page.waitForTimeout(500);
          await page.keyboard.press('Escape');
          onLog('Filter date by: Registered Date');
        }
      }
    } catch (err) {
      onLog(`Filter date by set failed: ${err instanceof Error ? err.message : err}`, 'warning');
    }

    // 3. Fill date range
    const startParts = parseDateParts(options.dateStart!);
    const endParts = parseDateParts(options.dateEnd!);
    await setMuiDatePicker(page, S.contactData.startDate, S.contactData.startDateFallbacks, startParts, onLog);
    await setMuiDatePicker(page, S.contactData.endDate, S.contactData.endDateFallbacks, endParts, onLog);
    await page.waitForTimeout(500);
  }

  // 4. Username filter (clear + fill)
  if (options.username) {
    try {
      const usernameInput = await page.$(S.contactData.usernameInput);
      if (usernameInput) {
        await usernameInput.fill('');
        await page.waitForTimeout(200);
        await usernameInput.fill(options.username);
        await page.waitForTimeout(300);
      }
    } catch {}
  }

  // 5. Set page size to 1000
  try {
    const pageSizeEl = await page.$(S.contactData.pageSizeSelect);
    if (pageSizeEl) {
      await pageSizeEl.click();
      await page.waitForTimeout(500);
      await page.click(S.contactData.pageSizeOption1000, { timeout: 5000 });
      await page.waitForTimeout(500);
    }
  } catch {}

  // 6. Click Filter
  onLog(`Clicking Filter (${statusLabel})...`);
  await page.click(S.contactData.filterButton, { timeout: 5000 });

  // 7. Wait for loading
  await waitForContactDataLoad(page, onLog);

  // 8. Scrape rows with pagination
  const allRows: TarikDbRow[] = [];
  const maxPages = options.maxPages ?? 10;
  let currentPage = 0;

  while (currentPage < maxPages) {
    const pageRows = await scrapeContactDataPage(page, statusLabel, onLog);

    if (pageRows.length === 0) {
      if (currentPage === 0) onLog(`No rows found for ${statusLabel}`, 'warning');
      break;
    }

    allRows.push(...pageRows);
    onLog(`Page ${currentPage + 1}: ${pageRows.length} row(s) (total: ${allRows.length})`);

    if (pageRows.length < PAGE_SIZE) break;
    const canGoNext = await hasNextPage(page);
    if (!canGoNext) break;

    currentPage++;
    await page.click(S.contactData.nextPageButton, { timeout: 5000 });
    await waitForContactDataLoad(page, onLog);
  }

  return allRows;
}

// ============================================================
// Table Loading
// ============================================================

async function waitForContactDataLoad(page: Page, onLog: LogCallback): Promise<void> {
  try {
    await page.waitForSelector(S.contactData.loadingSpinner, { state: 'attached', timeout: 3000 });
    onLog('Table loading...');
    await page.waitForSelector(S.contactData.loadingSpinner, { state: 'detached', timeout: 60000 });
  } catch {}

  await page.waitForTimeout(1500);
  try {
    await page.waitForSelector(S.contactData.tableRow(0), { timeout: 10000, state: 'visible' });
  } catch {
    onLog('Table rows not visible after wait', 'warning');
    await page.waitForTimeout(2000);
  }
}

// ============================================================
// Row Scraping
// ============================================================

async function scrapeContactDataPage(
  page: Page,
  statusLabel: string,
  onLog: LogCallback,
): Promise<TarikDbRow[]> {
  const rows: TarikDbRow[] = [];

  for (let n = 0; n < PAGE_SIZE; n++) {
    const rowEl = await page.$(S.contactData.tableRow(n));
    if (!rowEl) break;

    try {
      const usernameCell = await page.$(S.contactData.cellUsername(n));
      let username = '';
      if (usernameCell) {
        const btn = await usernameCell.$('button');
        username = btn
          ? ((await btn.textContent()) || '').trim()
          : ((await usernameCell.textContent()) || '').trim();
      }

      const phoneCell = await page.$(S.contactData.cellPhone(n));
      const phone = phoneCell ? ((await phoneCell.textContent()) || '').trim() : '-';

      if (username) {
        rows.push({
          username,
          wallet: '-',
          phone: phone || '-',
          status: statusLabel,
          joinDate: '-',
        });
      }
    } catch (err) {
      logger.debug(`Error scraping Victory contact-data row ${n}: ${err}`);
    }
  }

  return rows;
}

// ============================================================
// Pagination
// ============================================================

async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const nextBtn = await page.$(S.contactData.nextPageButton);
    if (!nextBtn) return false;
    const isDisabled = await nextBtn.getAttribute('disabled');
    if (isDisabled !== null) return false;
    const ariaDisabled = await nextBtn.getAttribute('aria-disabled');
    if (ariaDisabled === 'true') return false;
    const hasMuiDisabled = await nextBtn.evaluate(el => el.classList.contains('Mui-disabled'));
    return !hasMuiDisabled;
  } catch {
    return false;
  }
}
