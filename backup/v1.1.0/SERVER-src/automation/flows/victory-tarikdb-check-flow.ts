import type { Page } from 'playwright';
import { VICTORY_SELECTORS } from '../selectors/victory-selectors';
import { setMuiDatePicker, parseDateParts } from './victory-nto-check-flow';
import type { TarikDbCheckResult, TarikDbRow } from './nuke-tarikdb-check-flow';
import logger from '../../utils/logger';

const S = VICTORY_SELECTORS;
const PAGE_SIZE = 1000;

type LogCallback = (msg: string, level?: string) => void;

/**
 * Victory TARIK DB Check Flow:
 *
 * Scrapes the /player/contact-data page (MUI) to extract contact data
 * (Username, Phone) filtered by Registered Date range.
 *
 * Steps:
 * 1. Navigate to /player/contact-data
 * 2. Set page size to 1000
 * 3. Set "Filter Date By" to "Registered Date"
 * 4. Fill start/end date via MUI DatePicker
 * 5. (Optional) Fill username filter
 * 6. Click Filter
 * 7. Scrape Username + Phone from table rows
 * 8. Paginate if needed (> 1000 rows)
 */
export async function victoryTarikDbCheckFlow(
  page: Page,
  panelUrl: string,
  onLog: LogCallback,
  options: {
    dateStart: string;     // DD-MM-YYYY
    dateEnd: string;       // DD-MM-YYYY
    username?: string;     // Optional: specific username filter
    maxPages?: number;     // Default 10
  },
): Promise<TarikDbCheckResult> {
  const allRows: TarikDbRow[] = [];

  try {
    // === Step 1: Navigate to contact-data page ===
    const baseUrl = panelUrl.replace(/\/+$/, '').replace(/\/login\/?$/, '');
    const contactUrl = `${baseUrl}/player/contact-data`;

    onLog(`Navigating to contact-data: ${options.dateStart} s/d ${options.dateEnd}`);
    await page.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Set large viewport for MUI
    await page.setViewportSize({ width: 2560, height: 1440 });
    onLog('Contact data page loaded (viewport 2560x1440)');

    // === Step 2: Set page size to 1000 ===
    onLog('Setting page size to 1000...');
    try {
      const pageSizeEl = await page.$(S.contactData.pageSizeSelect);
      if (pageSizeEl) {
        await pageSizeEl.click();
        await page.waitForTimeout(500);
        await page.click(S.contactData.pageSizeOption1000, { timeout: 5000 });
        await page.waitForTimeout(500);
        onLog('Page size set to 1000');
      } else {
        onLog('Page size selector not found, using default', 'warning');
      }
    } catch (err) {
      onLog(`Page size set failed: ${err instanceof Error ? err.message : err}`, 'warning');
    }

    // === Step 3: Set "Filter Date By" to "Registered Date" ===
    onLog('Setting filter date by: Registered Date...');
    try {
      const filterDateEl = await page.$(S.contactData.filterDateBySelect);
      if (filterDateEl) {
        await filterDateEl.click();
        await page.waitForTimeout(500);
        await page.click(S.contactData.registeredDateOption, { timeout: 5000 });
        await page.waitForTimeout(500);
        onLog('Filter date by: Registered Date selected');
      } else {
        onLog('Filter date by selector not found', 'warning');
      }
    } catch (err) {
      onLog(`Filter date by set failed: ${err instanceof Error ? err.message : err}`, 'warning');
    }

    // === Step 4: Fill date range via MUI DatePicker ===
    const startParts = parseDateParts(options.dateStart);
    const endParts = parseDateParts(options.dateEnd);

    onLog(`Setting date range: ${options.dateStart} - ${options.dateEnd}`);
    await setMuiDatePicker(page, S.contactData.startDate, S.contactData.startDateFallbacks, startParts, onLog);
    await setMuiDatePicker(page, S.contactData.endDate, S.contactData.endDateFallbacks, endParts, onLog);
    await page.waitForTimeout(500);

    // === Step 5: (Optional) Fill username filter ===
    if (options.username) {
      onLog(`Filling username filter: ${options.username}`);
      try {
        const usernameInput = await page.$(S.contactData.usernameInput);
        if (usernameInput) {
          await usernameInput.fill(options.username);
          await page.waitForTimeout(300);
        } else {
          onLog('Username input not found', 'warning');
        }
      } catch (err) {
        onLog(`Username fill failed: ${err instanceof Error ? err.message : err}`, 'warning');
      }
    }

    // === Step 6: Click Filter button ===
    onLog('Clicking Filter...');
    await page.click(S.contactData.filterButton, { timeout: 5000 });

    // === Step 7: Wait for loading ===
    await waitForContactDataLoad(page, onLog);

    // === Step 8: Scrape rows with pagination ===
    const maxPages = options.maxPages ?? 10;
    let currentPage = 0;

    while (currentPage < maxPages) {
      const pageRows = await scrapeContactDataPage(page, onLog);

      if (pageRows.length === 0) {
        if (currentPage === 0) {
          onLog('No rows found in table', 'warning');
        }
        break;
      }

      allRows.push(...pageRows);
      onLog(`Page ${currentPage + 1}: scraped ${pageRows.length} row(s) (total: ${allRows.length})`);

      // Check if we got a full page and Next button is available
      if (pageRows.length < PAGE_SIZE) break;

      const canGoNext = await hasNextPage(page);
      if (!canGoNext) break;

      // Click Next page
      currentPage++;
      onLog(`Navigating to page ${currentPage + 1}...`);
      await page.click(S.contactData.nextPageButton, { timeout: 5000 });
      await waitForContactDataLoad(page, onLog);
    }

    onLog(`TARIK DB complete! ${allRows.length} member(s) found`, 'success');
    return { success: true, rows: allRows, totalItems: allRows.length };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`TARIK DB error: ${msg}`, 'error');
    return { success: false, rows: allRows, error: msg };
  }
}

// ============================================================
// Table Loading
// ============================================================

async function waitForContactDataLoad(
  page: Page,
  onLog: LogCallback,
): Promise<void> {
  // Wait for loading spinner to appear then disappear
  try {
    await page.waitForSelector(S.contactData.loadingSpinner, { state: 'attached', timeout: 3000 });
    onLog('Table loading...');
    await page.waitForSelector(S.contactData.loadingSpinner, { state: 'detached', timeout: 60000 });
  } catch {
    // No spinner seen, might already be loaded
  }

  // Wait for first row or stabilize
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

/**
 * Scrape a single page of the contact-data table.
 * Extracts Username (button text inside cell) and Phone.
 * Maps to TarikDbRow with wallet="-", status="REGISTERED", joinDate="-".
 */
async function scrapeContactDataPage(
  page: Page,
  onLog: LogCallback,
): Promise<TarikDbRow[]> {
  const rows: TarikDbRow[] = [];

  for (let n = 0; n < PAGE_SIZE; n++) {
    const rowEl = await page.$(S.contactData.tableRow(n));
    if (!rowEl) break;

    try {
      // Username: text inside button within the username cell
      const usernameCell = await page.$(S.contactData.cellUsername(n));
      let username = '';
      if (usernameCell) {
        const btn = await usernameCell.$('button');
        if (btn) {
          username = ((await btn.textContent()) || '').trim();
        } else {
          username = ((await usernameCell.textContent()) || '').trim();
        }
      }

      // Phone
      const phoneCell = await page.$(S.contactData.cellPhone(n));
      const phone = phoneCell ? ((await phoneCell.textContent()) || '').trim() : '-';

      if (username) {
        rows.push({
          username,
          wallet: '-',
          phone: phone || '-',
          status: 'REGISTERED',
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

/**
 * Check if the Next page button exists and is not disabled.
 */
async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const nextBtn = await page.$(S.contactData.nextPageButton);
    if (!nextBtn) return false;

    const isDisabled = await nextBtn.getAttribute('disabled');
    if (isDisabled !== null) return false;

    const ariaDisabled = await nextBtn.getAttribute('aria-disabled');
    if (ariaDisabled === 'true') return false;

    // MUI buttons use Mui-disabled class
    const hasMuiDisabled = await nextBtn.evaluate(
      el => el.classList.contains('Mui-disabled'),
    );
    return !hasMuiDisabled;
  } catch {
    return false;
  }
}
