# Research: PAY4D TARIK DB Implementation

## Source Reference
- File: `g:\GGWP Project 04032026\bot_auto_tarik_db_merged_v4.py`
- Class: `DatabaseExtractorRunner` (line 2254+)
- Flow: Login -> Captcha -> PIN -> "All User" page -> H-1 date filter (client-side) -> Profile click -> Extract phone -> Back -> Next page

## Complete Flow Summary

### 1. Login (`_login_to_panel`, line 2385)
PAY4D login is ALREADY implemented in our project (`pay4d-login-flow.ts`). The Python reference confirms the same selectors:
- Username: `#inputUsername`
- Password: `#inputPassword`
- Submit: `button[type='submit']`
- Captcha image: `img[src*='captcha']`
- Captcha input: `#inputCaptcha` (4-digit code)
- PIN modal: `<main>` containing `<div id="keypad">`, buttons `button.num` (6-digit)
- PIN iframe fallback: switches to `<iframe>` if keypad not found in main page

**Reuse:** Our existing `pay4d-login-flow.ts` already handles all of this (2Captcha auto-solve + cross-origin iframe PIN). No changes needed for login.

### 2. Navigate to "All User" Page (`_navigate_to_member_page`, line 2646)
After login, click the "All User" button:
- Selector: `button[onclick*="switchMenu('menuAllUser')"]` (full: `button.btn.btn-info.btn-menu.w-100.p-2.fw-bold`)
- Wait for: `input#userSearch` to confirm page loaded
- This is a SPA navigation (no page reload), uses `switchMenu()` JS function

### 3. Data Extraction (`_extract_member_data`, line 2671)
This is the core logic. Key details:

#### H-1 Date Filtering (Client-Side)
- **No server-side date filter** - the `_apply_h1_date_filter` and `_set_pagination_to_100` functions were DELETED
- Instead, the script scans ALL rows on each page and checks the Join Date column client-side
- Target date = yesterday (H-1): `datetime.now() - timedelta(days=1)`, formatted as `"DD Mon YYYY"` (e.g., "03 Nov 2025")
- Compares each row's Join Date input value against target date string

#### Table Structure
- Table: `//table//tbody//tr` (standard HTML table)
- Valid rows: must have 8+ columns (`count(td) >= 8`)
- Wait for data: first row's date input `//table//tbody//tr[1]//input[@type='text' and @readonly and @value]`

#### Column Mapping (0-indexed)
| Index | Column     | How to Extract |
|-------|-----------|----------------|
| 1     | Username  | `cells[1].text` |
| 2     | Credit    | `cells[2].text` (remove commas, parse as int) |
| 4     | Join Date | `cells[4] > input[type='text'][readonly]` → `.value` attribute |
| 8     | Action    | `cells[8] > button[onclick*='editProfilUsers']` → click to open profile |

#### Profile Detail Flow (per matching user)
For each user with matching H-1 date:
1. Click profile button: `button[onclick*="editProfilUsers"]` in column 8
2. Wait 3 seconds for profile page to load
3. Extract phone: `input.form-control.telpon` → `.value` attribute
4. Determine status: `credit > 0` → "REGIS + DEPO", else → "REGIS ONLY"
5. Click "Back to All Users": `button[onclick*="menuUsers('1')"]` containing text "Back to All Users"
6. Wait 3 seconds for list to reload

#### Pagination
- Next button: `a.page-link` with text "Next"
- Disabled check: parent `<li>` has class "disabled"
- Stop conditions:
  - No H-1 dates found on page BUT other dates exist (means we've passed H-1 range)
  - H-1 users found < 100 on current page (no need for next)
  - Last page (Next disabled)
  - No Next button exists

#### Anti-Stale Element Handling
- Re-queries `rows` after each iteration (Selenium StaleElementReferenceException)
- Scrolls row into viewport before reading (`scrollIntoView({block: 'center'})`)
- Re-queries again after scroll (DOM may change)

### 4. Sorting (`_sort_member_data_by_priority`, line 2873)
Same as NUKE: REGIS+DEPO first, then REGIS ONLY. Re-numbers the `no` field.

### 5. Output
Python saves to Google Sheets. Our implementation will:
- Save to `NtoResult` (rawData JSON) — same pattern as NUKE TARIK DB
- Export to Excel via ExcelJS
- Send to Telegram

### 6. Phone Number Formatting (`_format_phone_number`, line 2284)
- Strip non-digits
- `08xxx` → `628xxx`
- `62xxx` → keep as-is
- `+62xxx` → `62xxx` (remove +)

## Target Output Columns
```
PAY4D_TARGET_COLUMNS = ['NO', 'USERNAME', 'PHONE', 'CREDIT', 'STATUS', 'JOIN_DATE']
```

## Implementation Plan for BOT NTO

### New Files
1. `SERVER/src/automation/flows/pay4d-tarikdb-check-flow.ts` — Main TARIK DB flow
2. `SERVER/src/automation/selectors/pay4d-selectors.ts` — Add new selectors (extend existing)

### Changes to Existing Files
1. `SERVER/src/automation/index.ts` — Route PAY4D TARIK DB to new flow in `checkTarikDb()`
2. `SERVER/src/automation/selectors/pay4d-selectors.ts` — Add "All User" page selectors
3. `SERVER/src/automation/utils/excel-export.ts` — Already supports TARIK DB export (reuse)
4. `SERVER/src/automation/utils/telegram-listener.ts` — Already handles TARIK DB commands (reuse)

### Key Differences from NUKE/Victory TARIK DB
| Aspect | NUKE | Victory | PAY4D |
|--------|------|---------|-------|
| Navigation | `/management/member` URL | `/player/contact-data` URL | SPA `switchMenu('menuAllUser')` |
| Date Filter | Server-side `createdDate` params | Date picker + Filter button | Client-side scan (no filter API) |
| Status Detection | Green color on ID cell | 2-cycle deposit_status | Credit > 0 |
| Phone Extraction | Same table row | Same table row | **Separate profile page** (click → read → back) |
| Pagination | Size=100, up to 10 pages | Size=1000, Next button | Default page size, Next button |

### PAY4D-Specific Challenges
1. **Profile click flow is SLOW** — Each user requires: click profile → wait 3s → read phone → click back → wait 3s = ~6s per user minimum
2. **No server-side date filter** — Must scan all rows on all pages to find H-1 matches
3. **SPA navigation** — `switchMenu()` doesn't change URL, must use JS click
4. **Stale elements** — DOM re-renders after scroll/navigation, need to re-query elements
5. **2Captcha cost** — Login requires captcha each time (already handled by existing flow)

### Playwright Equivalents for Selenium Patterns

| Selenium (Python) | Playwright (TypeScript) |
|-------------------|------------------------|
| `find_element(By.XPATH, ...)` | `page.locator('xpath=...')` or `page.$('...')` |
| `find_element(By.CSS_SELECTOR, ...)` | `page.locator('...')` |
| `WebDriverWait(driver, N).until(EC.visibility_of_element_located(...))` | `page.waitForSelector('...', { state: 'visible', timeout: N*1000 })` |
| `element.get_attribute("value")` | `await element.inputValue()` or `await element.getAttribute('value')` |
| `element.text` | `await element.textContent()` |
| `driver.execute_script("arguments[0].click()", el)` | `await element.click({ force: true })` |
| `driver.execute_script("arguments[0].scrollIntoView(...)", el)` | `await element.scrollIntoViewIfNeeded()` |
| `StaleElementReferenceException` handling | Not needed — Playwright auto-waits and re-queries locators |
| `driver.switch_to.frame(iframe)` | `const frame = page.frameLocator('iframe')` |
| `time.sleep(3)` | `await page.waitForTimeout(3000)` or better: `await page.waitForSelector(...)` |

### Estimated Complexity
- **Medium-High** — The profile-click-and-back flow is unique to PAY4D and adds significant complexity
- **Risk to existing flows: LOW** — New file, only touches `AutomationService.checkTarikDb()` routing
- **Performance concern:** If there are 50 H-1 users, extraction takes ~5 minutes (50 * 6s)

### Pseudo-code for `pay4d-tarikdb-check-flow.ts`

```typescript
export async function pay4dTarikDbCheckFlow(page, options) {
  const { dateStart, dateEnd, username, onLog } = options;

  // 1. Navigate to "All User" page
  await page.click('button:has-text("All User")');
  await page.waitForSelector('#userSearch');

  // 2. If targeted username, use search
  if (username) {
    await page.fill('#userSearch', username);
    // wait for filtered results
  }

  // 3. Calculate target date(s) — H-1 or date range
  const targetDates = calculateTargetDates(dateStart, dateEnd);

  // 4. Scan pages
  const allMembers = [];
  let pageNum = 1;

  while (true) {
    // Wait for table data
    const rows = await page.$$('table tbody tr');

    for (const row of rows) {
      const cells = await row.$$('td');
      if (cells.length < 8) continue;

      // Read join date from readonly input
      const joinDateInput = await cells[4].$('input[type="text"][readonly]');
      const joinDate = await joinDateInput?.getAttribute('value');

      if (!isTargetDate(joinDate, targetDates)) continue;

      // Read username and credit from table
      const username = await cells[1].textContent();
      const creditText = await cells[2].textContent();

      // Click profile button to get phone
      const profileBtn = await cells[8].$('button[onclick*="editProfilUsers"]');
      await profileBtn.click();
      await page.waitForSelector('input.form-control.telpon');

      const phone = await page.$eval('input.form-control.telpon', el => el.value);

      // Determine status
      const credit = parseInt(creditText.replace(/[^\d]/g, '')) || 0;
      const status = credit > 0 ? 'REGIS + DEPO' : 'REGIS ONLY';

      allMembers.push({ username, phone, credit: creditText, status, joinDate });

      // Go back
      await page.click('button:has-text("Back to All Users")');
      await page.waitForSelector('#userSearch');
    }

    // Check next page
    const nextBtn = await page.$('a.page-link:has-text("Next")');
    if (!nextBtn) break;
    const parentLi = await nextBtn.$('..');
    const parentClass = await parentLi?.getAttribute('class');
    if (parentClass?.includes('disabled')) break;

    await nextBtn.click();
    pageNum++;
  }

  // 5. Sort: REGIS+DEPO first
  const sorted = sortByStatus(allMembers);

  return sorted;
}
```

## Risk Assessment
- **Login flow:** NO RISK — reuse existing `pay4d-login-flow.ts` entirely
- **Captcha cost:** Each TARIK DB run costs 1 captcha solve (~$0.003)
- **Browser stability:** Medium risk — many click/navigate cycles could cause issues
- **Performance:** Slow for large datasets (6s per user)
- **Existing automation:** NO IMPACT — new flow file, minimal routing change
