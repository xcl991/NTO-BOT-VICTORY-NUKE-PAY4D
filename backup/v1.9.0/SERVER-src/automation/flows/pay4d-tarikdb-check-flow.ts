import type { Page } from 'playwright';
import { PAY4D_SELECTORS } from '../selectors/pay4d-selectors';
import type { TarikDbCheckResult, TarikDbRow } from './nuke-tarikdb-check-flow';
import logger from '../../utils/logger';

const S = PAY4D_SELECTORS;

type LogCallback = (msg: string, level?: string) => void;

/**
 * PAY4D TARIK DB Check Flow:
 *
 * Scrapes the "All User" page to extract member data.
 * Flow: Navigate to All User -> Scan rows for target date(s) -> Click profile -> Get phone -> Back
 *
 * Key differences from NUKE/Victory:
 * - No server-side date filter — scans ALL rows client-side for matching Join Date
 * - Phone is NOT in the table — must click profile button to open detail page
 * - Status determined by credit > 0 (REGIS + DEPO) vs credit = 0 (REGIS ONLY)
 *
 * Table column layout (0-indexed):
 *   [0] NO  [1] Username  [2] Credit  [3] ?  [4] JoinDate(input)  ...  [8] Action(profile btn)
 */
export async function pay4dTarikDbCheckFlow(
  page: Page,
  panelUrl: string,
  onLog: LogCallback,
  options: {
    dateStart?: string;    // DD-MM-YYYY (optional for old_user mode)
    dateEnd?: string;      // DD-MM-YYYY (optional for old_user mode)
    username?: string;     // Optional: specific username filter
    usernames?: string[];  // Multiple usernames (old_user mode)
    maxPages?: number;     // Default 20
  },
): Promise<TarikDbCheckResult> {
  const isOldUser = !options.dateStart || !options.dateEnd;

  try {
    // === Navigate to "All User" page ===
    onLog('Navigating to "All User" page...');
    await navigateToAllUser(page, onLog);

    // === OLD USER MODE: search by username(s) ===
    if (isOldUser && options.usernames && options.usernames.length > 0) {
      const allRows: TarikDbRow[] = [];

      for (let i = 0; i < options.usernames.length; i++) {
        const uname = options.usernames[i];
        onLog(`[${i + 1}/${options.usernames.length}] Searching: ${uname}`);

        // Use search input to filter by username
        await searchUsername(page, uname, onLog);

        // Scan all visible rows (no date filter in old_user mode)
        const pageRows = await scanAndExtractRows(page, onLog, null, options.maxPages ?? 20);

        if (pageRows.length > 0) {
          allRows.push(...pageRows);
          onLog(`"${uname}": ${pageRows.length} result(s)`, 'success');
        } else {
          allRows.push({ username: uname, wallet: '-', phone: '-', status: 'NOT FOUND', joinDate: '-' });
          onLog(`"${uname}": not found`, 'warning');
        }

        // Clear search for next username — re-navigate to All User
        if (i < options.usernames.length - 1) {
          await navigateToAllUser(page, onLog);
        }
      }

      // Sort: REGIS+DEPO first
      const sorted = sortByStatus(allRows);
      onLog(`Old User TARIK DB complete! ${sorted.length} result(s) from ${options.usernames.length} username(s)`, 'success');
      return { success: true, rows: sorted, totalItems: sorted.length };
    }

    // Guard: old_user mode but no usernames
    if (isOldUser) {
      onLog('Old User mode but no usernames provided, nothing to search', 'warning');
      return { success: true, rows: [], totalItems: 0 };
    }

    // === DATE RANGE MODE ===
    // Build target dates from range
    const targetDates = buildTargetDateStrings(options.dateStart!, options.dateEnd!);
    onLog(`Date range: ${options.dateStart} s/d ${options.dateEnd} (${targetDates.length} target date(s))`);

    // If specific username, search for it
    if (options.username) {
      await searchUsername(page, options.username, onLog);
    }

    // Scan pages and extract matching rows
    const allRows = await scanAndExtractRows(page, onLog, targetDates, options.maxPages ?? 20);

    // Sort: REGIS+DEPO first
    const sorted = sortByStatus(allRows);

    const regisDepo = sorted.filter(r => r.status === 'REGIS + DEPO').length;
    const regisOnly = sorted.filter(r => r.status === 'REGIS ONLY').length;
    onLog(`TARIK DB complete! ${sorted.length} member(s) (${regisDepo} REGIS+DEPO, ${regisOnly} REGIS ONLY)`, 'success');
    return { success: true, rows: sorted, totalItems: sorted.length };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`TARIK DB error: ${msg}`, 'error');
    return { success: false, rows: [], error: msg };
  }
}

// ============================================================
// Navigation
// ============================================================

async function navigateToAllUser(page: Page, onLog: LogCallback): Promise<void> {
  // Click "All User" button
  const allUserBtn = await page.waitForSelector(S.allUser.menuButton, { timeout: 15000, state: 'visible' })
    .catch(async () => {
      // Try fallback selectors
      for (const fb of S.allUser.menuButtonFallbacks) {
        const el = await page.$(fb);
        if (el) return el;
      }
      return null;
    });

  if (!allUserBtn) {
    throw new Error('"All User" button not found. Make sure you are logged in.');
  }

  await allUserBtn.click();
  onLog('Clicked "All User" button');

  // Wait for search input to confirm page loaded
  await page.waitForSelector(S.allUser.searchInput, { timeout: 25000, state: 'visible' });
  await page.waitForTimeout(2000);

  // Log total pages available
  const totalPages = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    const pagination = doc.getElementById('pagination');
    if (!pagination) return 0;
    return pagination.querySelectorAll('li.page-item').length;
  });
  onLog(`"All User" page loaded (${totalPages} page${totalPages !== 1 ? 's' : ''} available)`);
}

async function searchUsername(page: Page, username: string, onLog: LogCallback): Promise<void> {
  const searchInput = await page.waitForSelector(S.allUser.searchInput, { timeout: 10000, state: 'visible' });
  if (!searchInput) throw new Error('Search input not found');

  await searchInput.fill('');
  await page.waitForTimeout(200);
  await searchInput.fill(username);
  await page.waitForTimeout(300);

  // Press Enter to trigger search
  await searchInput.press('Enter');
  onLog(`Searching username: ${username}`);

  // Wait for table to reload
  await page.waitForTimeout(3000);
}

// ============================================================
// Date Helpers
// ============================================================

/**
 * Build all target date strings in "DD Mon YYYY" format (e.g., "03 Mar 2026")
 * for each day in the date range (inclusive).
 */
function buildTargetDateStrings(dateStart: string, dateEnd: string): string[] {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const [sd, sm, sy] = dateStart.split('-').map(Number);
  const [ed, em, ey] = dateEnd.split('-').map(Number);

  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  const dates: string[] = [];

  const current = new Date(start);
  while (current <= end) {
    const dd = String(current.getDate()).padStart(2, '0');
    const mon = MONTHS[current.getMonth()];
    const yyyy = current.getFullYear();
    dates.push(`${dd} ${mon} ${yyyy}`);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Convert DD-MM-YYYY to a human-readable join date string for display
 */
function formatDateForDisplay(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('-');
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Format phone number to 62xxx format (matching Python reference)
 */
function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) return 'N/A';
  if (digits.startsWith('08')) return '62' + digits.substring(1);
  if (digits.startsWith('62')) return digits;
  if (phone.startsWith('+')) return phone.substring(1).replace(/[^\d]/g, '');
  return digits;
}

// ============================================================
// Core Scanning & Extraction
// ============================================================

/**
 * Scan table rows page by page, extract data for rows matching target dates.
 * If targetDates is null, extract ALL rows (old_user mode).
 */
async function scanAndExtractRows(
  page: Page,
  onLog: LogCallback,
  targetDates: string[] | null,
  maxPages: number,
): Promise<TarikDbRow[]> {
  const allMembers: TarikDbRow[] = [];
  let pageNum = 1;

  while (pageNum <= maxPages) {
    onLog(`Processing page ${pageNum}...`);

    // Wait for table data to appear
    const hasData = await waitForTableData(page, onLog);
    if (!hasData) {
      onLog(`No data on page ${pageNum}. Stopping.`);
      break;
    }

    // Get all valid rows (8+ columns)
    const rowCount = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const rows = doc.querySelectorAll('table tbody tr');
      let count = 0;
      rows.forEach((r: any) => { if (r.querySelectorAll('td').length >= 5) count++; });
      return count;
    });

    onLog(`Found ${rowCount} rows on page ${pageNum}`);
    if (rowCount === 0) break;

    // Collect users to check (matching date or all in old_user mode)
    const usersToCheck: Array<{
      username: string;
      creditText: string;
      joinDate: string;
      rowIndex: number;
    }> = [];

    let foundTargetDate = false;
    let foundOtherDate = false;

    for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
      try {
        const rowData = await page.evaluate((idx: number) => {
          const doc = (globalThis as any).document;
          const rows = doc.querySelectorAll('table tbody tr');
          const validRows: any[] = [];
          rows.forEach((r: any) => { if (r.querySelectorAll('td').length >= 5) validRows.push(r); });

          if (idx >= validRows.length) return null;
          const row = validRows[idx];
          const cells = row.querySelectorAll('td');

          // Username from column 1
          const username = cells[1]?.textContent?.trim() || '';

          // Credit from column 2
          const creditText = cells[2]?.textContent?.trim() || '0';

          // Join Date from column 4 (readonly input)
          const dateInput = cells[4]?.querySelector("input[type='text'][readonly]") as any;
          const joinDate = dateInput?.value?.trim() || '';

          // Profile button onclick from column 8
          const profileBtn = cells[8]?.querySelector("button[onclick*='editProfilUsers']") as any;
          const onclick = profileBtn?.getAttribute('onclick') || '';

          return { username, creditText, joinDate, onclick };
        }, rowIdx);

        if (!rowData || !rowData.username) continue;

        if (rowData.joinDate) {
          foundOtherDate = true;
        }

        // Check if date matches (or accept all in old_user mode)
        if (targetDates === null) {
          // Old user mode: accept all rows
          usersToCheck.push({
            username: rowData.username,
            creditText: rowData.creditText,
            joinDate: rowData.joinDate,
            rowIndex: rowIdx,
          });
        } else if (targetDates.some(td => rowData.joinDate.toLowerCase() === td.toLowerCase())) {
          foundTargetDate = true;
          usersToCheck.push({
            username: rowData.username,
            creditText: rowData.creditText,
            joinDate: rowData.joinDate,
            rowIndex: rowIdx,
          });
        }
      } catch (err) {
        logger.debug(`Error reading row ${rowIdx}: ${err}`);
      }
    }

    onLog(`Found ${usersToCheck.length} matching user(s) on page ${pageNum}`);

    // Extract phone for each matching user (click profile -> get phone -> back)
    for (const user of usersToCheck) {
      try {
        onLog(`Checking profile: ${user.username}...`);
        const phone = await extractPhoneFromProfile(page, user.rowIndex, user.username, onLog);

        // Determine status from credit
        const creditNum = parseInt(user.creditText.replace(/[^\d]/g, ''), 10) || 0;
        const status = creditNum > 0 ? 'REGIS + DEPO' : 'REGIS ONLY';

        allMembers.push({
          username: user.username,
          wallet: user.creditText,
          phone: formatPhoneNumber(phone),
          status,
          joinDate: user.joinDate,
        });

        onLog(`${user.username} | ${formatPhoneNumber(phone)} | Credit: ${creditNum} | ${status}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onLog(`Error processing ${user.username}: ${msg}`, 'warning');

        // Try recovery: navigate back to All User
        try {
          await recoveryNavigateBack(page, onLog);
        } catch {
          // If recovery fails, try full re-navigation
          try {
            await navigateToAllUser(page, onLog);
          } catch {}
        }
      }
    }

    // Stop conditions for date range mode
    if (targetDates !== null) {
      // If this page has NO target dates but HAS other dates → we've passed the range
      if (!foundTargetDate && foundOtherDate) {
        onLog('No target dates found on this page but other dates exist. Done.');
        break;
      }
      // If this page has NO rows at all → done
      if (!foundTargetDate && !foundOtherDate) {
        onLog('No data on this page. Done.');
        break;
      }
      // Otherwise: target dates found → continue to next page (could be more)
    }

    // Check next page
    const hasNext = await goToNextPage(page, onLog);
    if (!hasNext) {
      onLog(`No more pages after page ${pageNum}. Done.`);
      break;
    }

    pageNum++;
  }

  onLog(`Total extracted: ${allMembers.length} member(s)`);
  return allMembers;
}

// ============================================================
// Table Loading
// ============================================================

async function waitForTableData(page: Page, onLog: LogCallback): Promise<boolean> {
  try {
    // Wait for first row's date input to appear (confirms data loaded)
    await page.waitForSelector(
      S.allUser.firstRowDateInput,
      { timeout: 20000, state: 'visible' },
    );
    await page.waitForTimeout(1000);
    return true;
  } catch {
    onLog('Table data not found (no date inputs visible)', 'warning');
    return false;
  }
}

// ============================================================
// Profile Extraction
// ============================================================

/**
 * Click the profile button for a row, extract phone number, then go back.
 * This is the core PAY4D-specific logic: phone is only available in profile detail.
 */
async function extractPhoneFromProfile(
  page: Page,
  rowIndex: number,
  username: string,
  onLog: LogCallback,
): Promise<string> {
  // Re-query the profile button (DOM may have changed)
  const profileBtn = await page.evaluate((idx: number) => {
    const doc = (globalThis as any).document;
    const rows = doc.querySelectorAll('table tbody tr');
    const validRows: any[] = [];
    rows.forEach((r: any) => { if (r.querySelectorAll('td').length >= 5) validRows.push(r); });

    if (idx >= validRows.length) return null;
    const cells = validRows[idx].querySelectorAll('td');
    const btn = cells[8]?.querySelector("button[onclick*='editProfilUsers']") as any;
    if (btn) {
      btn.click();
      return true;
    }
    return null;
  }, rowIndex);

  if (!profileBtn) {
    throw new Error(`Profile button not found for row ${rowIndex}`);
  }

  // Wait for profile page to load (phone input appears)
  await page.waitForTimeout(2000);

  let phone = 'N/A';
  try {
    const phoneEl = await page.waitForSelector(S.allUser.phoneInput, { timeout: 10000, state: 'visible' })
      .catch(async () => {
        // Try fallbacks
        for (const fb of S.allUser.phoneInputFallbacks) {
          const el = await page.$(fb);
          if (el) return el;
        }
        return null;
      });

    if (phoneEl) {
      phone = await phoneEl.evaluate((el: any) => el.value || el.textContent?.trim() || 'N/A');
    }
  } catch {
    onLog(`Could not read phone for ${username}`, 'warning');
  }

  // Go back to All User list
  await goBackToAllUsers(page, onLog);

  return phone;
}

/**
 * Click "Back to All Users" button and wait for list to reload
 */
async function goBackToAllUsers(page: Page, onLog: LogCallback): Promise<void> {
  // Try primary back button
  let backClicked = false;
  try {
    const backBtn = await page.waitForSelector(S.allUser.backButton, { timeout: 5000, state: 'visible' });
    if (backBtn) {
      await backBtn.evaluate((el: any) => el.click());
      backClicked = true;
    }
  } catch {}

  // Try fallbacks
  if (!backClicked) {
    for (const fb of S.allUser.backButtonFallbacks) {
      try {
        const el = await page.$(fb);
        if (el) {
          await el.evaluate((e: any) => e.click());
          backClicked = true;
          break;
        }
      } catch {}
    }
  }

  if (!backClicked) {
    throw new Error('Could not find Back button');
  }

  // Wait for All User list to reload
  await page.waitForTimeout(3000);
  await page.waitForSelector(S.allUser.searchInput, { timeout: 15000, state: 'visible' }).catch(() => {});
}

/**
 * Recovery: try to navigate back to All User page after an error
 */
async function recoveryNavigateBack(page: Page, onLog: LogCallback): Promise<void> {
  onLog('Attempting recovery: navigating back to All User...');

  // Try clicking the All User menu button
  try {
    const allUserBtn = await page.$(S.allUser.menuButton);
    if (allUserBtn) {
      await allUserBtn.evaluate((el: any) => el.click());
      await page.waitForTimeout(3000);
      await page.waitForSelector(S.allUser.searchInput, { timeout: 10000, state: 'visible' });
      onLog('Recovery successful');
      return;
    }
  } catch {}

  // Try fallbacks
  for (const fb of S.allUser.menuButtonFallbacks) {
    try {
      const el = await page.$(fb);
      if (el) {
        await el.evaluate((e: any) => e.click());
        await page.waitForTimeout(3000);
        onLog('Recovery via fallback successful');
        return;
      }
    } catch {}
  }

  throw new Error('Recovery failed: could not navigate back to All User');
}

// ============================================================
// Pagination
// ============================================================

/**
 * PAY4D pagination uses numbered pages (no Next/Prev button):
 *   <li class="active page-item"><a class="page-link">1</a></li>
 *   <li class="page-item" onclick="menuUsers(2)"><a class="page-link">2</a></li>
 *
 * Find the current active page number, then click the next one.
 */
async function goToNextPage(page: Page, onLog: LogCallback): Promise<boolean> {
  try {
    const result = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const pagination = doc.getElementById('pagination');
      if (!pagination) return { hasNext: false, currentPage: 0 };

      const items = pagination.querySelectorAll('li.page-item');
      let activeIndex = -1;
      let currentPage = 0;

      for (let i = 0; i < items.length; i++) {
        if (items[i].classList.contains('active')) {
          activeIndex = i;
          const linkText = items[i].querySelector('a')?.textContent?.trim();
          currentPage = parseInt(linkText || '0', 10);
          break;
        }
      }

      if (activeIndex === -1 || activeIndex >= items.length - 1) {
        return { hasNext: false, currentPage };
      }

      // Click the next page item
      const nextItem = items[activeIndex + 1] as any;
      if (nextItem) {
        // Try onclick on the <li> itself (PAY4D pattern: onclick="menuUsers(N)")
        if (nextItem.onclick) {
          nextItem.click();
          return { hasNext: true, currentPage };
        }
        // Fallback: click the <a> inside
        const nextLink = nextItem.querySelector('a');
        if (nextLink) {
          nextLink.click();
          return { hasNext: true, currentPage };
        }
      }

      return { hasNext: false, currentPage };
    });

    if (result.hasNext) {
      onLog(`Page ${result.currentPage} → ${result.currentPage + 1}`);
      await page.waitForTimeout(3000);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ============================================================
// Sorting
// ============================================================

function sortByStatus(rows: TarikDbRow[]): TarikDbRow[] {
  const regisDepo = rows.filter(r => r.status === 'REGIS + DEPO');
  const regisOnly = rows.filter(r => r.status === 'REGIS ONLY');
  const other = rows.filter(r => r.status !== 'REGIS + DEPO' && r.status !== 'REGIS ONLY');
  return [...regisDepo, ...regisOnly, ...other];
}
