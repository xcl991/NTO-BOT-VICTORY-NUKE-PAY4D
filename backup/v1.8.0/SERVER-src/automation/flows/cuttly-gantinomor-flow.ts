import type { Page } from 'playwright';
import { CUTTLY_SELECTORS } from '../selectors/cuttly-selectors';

type LogCallback = (msg: string, level?: string) => void;

export interface CuttlyGantiNomorResult {
  success: boolean;
  changed: { cs?: string; mst?: string };
  error?: string;
}

/**
 * Change a single result on the /change/{alias} page:
 * Replace phone={oldNumber} with phone={newNumber} in input, submit.
 */
async function changeOneResult(
  page: Page,
  changeHref: string,
  oldNumber: string,
  newNumber: string,
  label: string,
  index: number,
  onLog: LogCallback,
): Promise<boolean> {
  const S = CUTTLY_SELECTORS;

  onLog(`[${label}] (#${index + 1}) Navigating to change page: ${changeHref}`);
  await page.goto(changeHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  if (!page.url().includes('/change/')) {
    onLog(`[${label}] (#${index + 1}) Gagal navigasi ke change page (URL: ${page.url()})`, 'warning');
    return false;
  }

  const linkInput = await page.$(S.linkInput);
  if (!linkInput) {
    onLog(`[${label}] (#${index + 1}) Input field "link" tidak ditemukan`, 'warning');
    return false;
  }

  const currentValue = await linkInput.inputValue();
  if (!currentValue.includes(`phone=${oldNumber}`)) {
    onLog(`[${label}] (#${index + 1}) Input tidak mengandung phone=${oldNumber}, skip`, 'warning');
    return false;
  }

  const newValue = currentValue.replace(`phone=${oldNumber}`, `phone=${newNumber}`);
  onLog(`[${label}] (#${index + 1}) Replacing: phone=${oldNumber} → phone=${newNumber}`);

  // Set value via JS (reliable for plain HTML forms)
  await page.evaluate(({ sel, val }) => {
    const input = document.querySelector(sel) as HTMLInputElement;
    if (input) {
      input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { sel: S.linkInput, val: newValue });
  await page.waitForTimeout(300);

  // Verify
  const verifyValue = await linkInput.inputValue();
  if (verifyValue !== newValue) {
    onLog(`[${label}] (#${index + 1}) Direct set failed, using fill()...`);
    await linkInput.fill(newValue);
    await page.waitForTimeout(300);
  }

  // Submit
  const submitBtn = await page.$(S.changeSubmit);
  if (!submitBtn) {
    onLog(`[${label}] (#${index + 1}) Tombol "Change" tidak ditemukan`, 'warning');
    return false;
  }

  await submitBtn.click();
  await page.waitForTimeout(3000);

  onLog(`[${label}] (#${index + 1}) Berhasil diganti!`, 'success');
  return true;
}

/**
 * Process all matching results on the current search page.
 * Returns array of change hrefs (absolute) that contain phone={oldNumber}.
 */
async function collectMatchingResults(
  page: Page,
  oldNumber: string,
): Promise<{ changeHref: string; linkHref: string }[]> {
  return page.evaluate((oldNum) => {
    const results: { changeHref: string; linkHref: string }[] = [];
    const urlOptionsDivs = document.querySelectorAll('.url_options');

    for (const div of urlOptionsDivs) {
      const linkEl = div.querySelector('.url_link a') as HTMLAnchorElement | null;
      if (!linkEl) continue;

      const href = linkEl.getAttribute('href') || linkEl.textContent || '';
      if (!href.includes(`phone=${oldNum}`)) continue;

      const changeEl = div.querySelector('a[href*="/change/"]') as HTMLAnchorElement | null;
      if (!changeEl) continue;

      // Build absolute URL for the change link
      const changeHref = changeEl.href || (window.location.origin + changeEl.getAttribute('href'));
      results.push({ changeHref, linkHref: href });
    }

    return results;
  }, oldNumber);
}

/**
 * Get all pagination page URLs from search results.
 */
async function collectPaginationUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const links = document.querySelectorAll('.result a[href*="/search/"]');
    const urls = new Set<string>();
    for (const a of links) {
      const href = (a as HTMLAnchorElement).href;
      if (href) urls.add(href);
    }
    return [...urls];
  });
}

/**
 * Change ALL shortlinks on CUTT.LY matching phone={oldNumber}:
 *
 * 1. Navigate to {teamLink}/search/{oldNumber}
 * 2. Collect ALL .url_options that contain phone={oldNumber}
 * 3. For each: navigate to /change/{alias} → replace phone → submit
 * 4. After current page done, check pagination → process next pages
 * 5. Repeat until no more pages/matches
 */
async function changeSingleLink(
  page: Page,
  teamLink: string,
  oldNumber: string,
  newNumber: string,
  label: string,
  onLog: LogCallback,
): Promise<{ success: boolean; changedCount: number; error?: string }> {
  const baseUrl = teamLink.replace(/\/+$/, '');
  const searchUrl = `${baseUrl}/search/${oldNumber}`;
  let totalChanged = 0;

  // Track visited pages to avoid infinite loops
  const visitedPages = new Set<string>();

  // Start with page 1 (the base search URL)
  let pagesToVisit = [searchUrl];

  while (pagesToVisit.length > 0) {
    const currentPageUrl = pagesToVisit.shift()!;

    // Normalize URL for dedup (remove trailing slash)
    const normalizedUrl = currentPageUrl.replace(/\/+$/, '');
    if (visitedPages.has(normalizedUrl)) continue;
    visitedPages.add(normalizedUrl);

    onLog(`[${label}] Navigating to search page: ${currentPageUrl}`);
    await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check if any results exist
    const hasResults = await page.$('.url_options');
    if (!hasResults) {
      if (totalChanged === 0 && visitedPages.size === 1) {
        return { success: false, changedCount: 0, error: `[${label}] Nomor "${oldNumber}" tidak ditemukan di CUTT.LY` };
      }
      onLog(`[${label}] Tidak ada hasil di halaman ini`);
      continue;
    }

    // Collect all matching results on this page
    const matches = await collectMatchingResults(page, oldNumber);
    onLog(`[${label}] Ditemukan ${matches.length} link matching phone=${oldNumber} di halaman ini`);

    // Collect pagination URLs before we navigate away
    const paginationUrls = await collectPaginationUrls(page);
    for (const url of paginationUrls) {
      const norm = url.replace(/\/+$/, '');
      if (!visitedPages.has(norm) && !pagesToVisit.includes(url)) {
        pagesToVisit.push(url);
      }
    }

    // Process each matching result (navigate to change page → replace → submit → back)
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const ok = await changeOneResult(page, match.changeHref, oldNumber, newNumber, label, totalChanged + i, onLog);
      if (ok) totalChanged++;
      await page.waitForTimeout(1000);
    }
  }

  if (totalChanged === 0) {
    return { success: false, changedCount: 0, error: `[${label}] Tidak ada link dengan phone=${oldNumber} yang berhasil diganti` };
  }

  onLog(`[${label}] Total ${totalChanged} link berhasil diganti`, 'success');
  return { success: true, changedCount: totalChanged };
}

/**
 * CUTT.LY GANTI NOMOR Flow:
 *
 * For each link type (CS/MST), searches for old number on the team link,
 * clicks change URL, replaces phone number, and submits.
 *
 * @param cuttlyLinkCs - Team link for CS (e.g., https://cutt.ly/team/xxx/)
 * @param cuttlyLinkMst - Team link for MST
 * @param oldCs/newCs - Old and new CS phone number
 * @param oldMst/newMst - Old and new MST phone number
 */
export async function cuttlyGantiNomorFlow(
  page: Page,
  onLog: LogCallback,
  options: {
    cuttlyLinkCs?: string;
    cuttlyLinkMst?: string;
    oldCs?: string;
    newCs?: string;
    oldMst?: string;
    newMst?: string;
  },
): Promise<CuttlyGantiNomorResult> {
  const changed: { cs?: string; mst?: string } = {};

  const hasCs = options.oldCs && options.newCs;
  const hasMst = options.oldMst && options.newMst;

  if (!hasCs && !hasMst) {
    return { success: false, changed, error: 'Tidak ada pasangan old+new yang diberikan (cs/mst)' };
  }

  try {
    // Process MST first (if requested)
    if (hasMst) {
      if (!options.cuttlyLinkMst) {
        return { success: false, changed, error: 'Account tidak memiliki MST Link (cuttlyLinkMst). Set di panel terlebih dahulu.' };
      }

      const mstResult = await changeSingleLink(
        page, options.cuttlyLinkMst, options.oldMst!, options.newMst!, 'MST', onLog,
      );

      if (!mstResult.success) {
        return { success: false, changed, error: mstResult.error };
      }
      changed.mst = options.newMst;
      onLog(`MST berhasil diganti (${mstResult.changedCount} link): ${options.oldMst} → ${options.newMst}`, 'success');
    }

    // Process CS (if requested)
    if (hasCs) {
      if (!options.cuttlyLinkCs) {
        return { success: false, changed, error: 'Account tidak memiliki CS Link (cuttlyLinkCs). Set di panel terlebih dahulu.' };
      }

      const csResult = await changeSingleLink(
        page, options.cuttlyLinkCs, options.oldCs!, options.newCs!, 'CS', onLog,
      );

      if (!csResult.success) {
        return { success: false, changed, error: csResult.error };
      }
      changed.cs = options.newCs;
      onLog(`CS berhasil diganti (${csResult.changedCount} link): ${options.oldCs} → ${options.newCs}`, 'success');
    }

    const changedParts: string[] = [];
    if (changed.cs) changedParts.push(`CS: ${options.oldCs} → ${changed.cs}`);
    if (changed.mst) changedParts.push(`MST: ${options.oldMst} → ${changed.mst}`);
    onLog(`GANTI NOMOR CUTT.LY berhasil: ${changedParts.join(', ')}`, 'success');

    return { success: true, changed };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`GANTI NOMOR CUTT.LY error: ${msg}`, 'error');
    return { success: false, changed, error: msg };
  }
}
