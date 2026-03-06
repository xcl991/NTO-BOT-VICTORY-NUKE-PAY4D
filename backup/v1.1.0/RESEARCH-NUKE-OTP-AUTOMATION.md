# Research: NUKE OTP Automation — Playwright Alternatives & Workarounds

**Date:** 2026-03-05
**Status:** UNRESOLVED — mid-session OTP on `/management/member` page

---

## 1. Problem Summary

NUKE panel (`nukepanel.com`, Ant Design v3) memiliki custom OTP component pada halaman member management. 6 individual `<input maxlength="1">` fields inside `.ant-modal-content`. Server API: `POST /validation/otp/generate` with body `{"token":"XXXXXX"}`.

**Yang sudah dicoba dan GAGAL:**

| Approach | Result |
|----------|--------|
| `page.keyboard.type(code, { delay: 80 })` | DOM updated, React state NOT updated (submit button stays disabled) |
| `page.keyboard.press(digit)` per input (350ms delay) | DOM updated, submit button stays disabled |
| Native `HTMLInputElement.value` setter + `input`/`change` events | DOM updated, React state NOT updated (events are untrusted) |
| React fiber `__reactProps$` / `__reactEventHandlers$` direct call | Keys NOT FOUND on input elements |
| `pressSequentially(code, { delay: 300 })` | DOM correct, submit button ENABLED, but server returns 418 "Otp Token Invalid" |
| `navigator.webdriver = false` override | Did not fix |
| Direct `fetch('/validation/otp/generate')` bypass | Returns 400 "Server Validation Error" (different from form's 418) |

**Key fact:** Same TOTP code typed MANUALLY by user → works. Python Selenium `send_keys()` → works.

---

## 2. Root Cause Analysis

### CDP vs WebDriver Protocol — Keyboard Event Dispatch

**Playwright** uses CDP `Input.dispatchKeyEvent`:
```
rawKeyDown → char (text parameter) → keyUp
```
Events created at browser compositor level. `isTrusted: true`.

**Selenium** uses W3C WebDriver Actions endpoint → ChromeDriver translates to CDP, BUT through its own **keyboard state machine** that:
1. Tracks modifier state
2. Handles grapheme cluster parsing
3. Generates complete `key`, `code`, `text`, `unmodifiedText` properties
4. Ensures `InputEvent.data` and `InputEvent.inputType` are properly set

### Why Ant Design v3 OTP Component Is Sensitive

The NUKE panel uses a custom OTP component (NOT standard Ant Design `Input.OTP` from v5). Class: `antd-pro-app-cache-src-hocs-with-teapot-handler-components-styles-numberInput`.

Possible failure points:

**Theory A: `InputEvent.data` property missing/incorrect.** React reads `event.data` or `event.nativeEvent.data` from InputEvents. CDP's keyboard events may not populate this correctly → React deduplicates the change.

**Theory B: React internal `_valueTracker` out of sync.** React overloads `HTMLInputElement.prototype.value` setter. CDP may bypass this, causing React to believe value hasn't changed → `onChange` fires but is ignored.

**Theory C: The `pressSequentially` case** (submit button enables, but server rejects). Form assembles OTP from internal state. Although React state appears correct (submit button enabled), the Ant Design Form `rc-form` may read values from its OWN store (`data-__field`), not from React component state. The `pressSequentially` keyboard events update React state but NOT the `rc-form` field store.

### Why `pressSequentially` Enables Submit But Server Rejects

This is the most puzzling finding. `pressSequentially` uses `keyboard.type()` internally which dispatches `keydown → keypress/input → keyup`. This properly triggers React's event delegation → component state updates → submit button enables.

BUT: the Ant Design v3 Form (`rc-form`) wraps the OTP component with `getFieldDecorator`. The form field store tracks values separately from component state. The `onKeyDown` handler may update component state (enabling submit), while the form's `onChange` callback (which updates `rc-form` store) may not fire correctly because the `InputEvent` from CDP lacks proper `data` property.

When submit is clicked, the form reads from `rc-form` store (empty/wrong) → sends wrong token → server rejects.

---

## 3. Playwright Workarounds (Try FIRST before migrating)

### Workaround A: Clipboard Paste (HIGHEST PRIORITY)

Many OTP components have `onPaste` handler that splits pasted string across all inputs. This bypasses keyboard events entirely.

```typescript
async function fillOtpViaClipboard(page: Page, otpCode: string): Promise<void> {
  // Set clipboard
  await page.evaluate(async (code) => {
    await navigator.clipboard.writeText(code);
  }, otpCode);

  // Click first input to focus
  const firstInput = page.locator('.ant-modal-content input[maxlength="1"]').first();
  await firstInput.click();
  await page.waitForTimeout(300);

  // Paste (Ctrl+V)
  await page.keyboard.press('Control+KeyV');
  await page.waitForTimeout(1000);
}
```

**Why likely to work:** Paste goes through completely different code path. OTP components almost always handle paste events. The `onPaste` handler directly calls `rc-form`'s `setFieldsValue`.

**Effort:** Very low (15 minutes). **Risk:** Low.

### Workaround B: Direct CDP `Input.dispatchKeyEvent` with Complete Properties

Playwright's `pressSequentially` may omit some CDP event properties. Send raw CDP events with ALL properties explicitly set:

```typescript
async function fillOtpViaCDP(page: Page, otpCode: string): Promise<void> {
  const client = await page.context().newCDPSession(page);

  // Focus first input
  const firstInput = page.locator('.ant-modal-content input[maxlength="1"]').first();
  await firstInput.click();
  await page.waitForTimeout(300);

  for (const digit of otpCode) {
    const keyCode = digit.charCodeAt(0);

    await client.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: digit,
      code: `Digit${digit}`,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      text: digit,
      unmodifiedText: digit,
    });

    await client.send('Input.dispatchKeyEvent', {
      type: 'char',
      key: digit,
      code: `Digit${digit}`,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      text: digit,
      unmodifiedText: digit,
    });

    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: digit,
      code: `Digit${digit}`,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });

    await page.waitForTimeout(250);
  }

  await client.detach();
  await page.waitForTimeout(1000);
}
```

**Why might work:** Explicit `text`, `unmodifiedText`, `code`, `windowsVirtualKeyCode` on every event type including `char`. Playwright's high-level API may omit some of these.

**Effort:** Low (30 minutes). **Risk:** Low.

### Workaround C: React `_valueTracker` Reset

React tracks input values internally. Force-reset the tracker before setting values:

```typescript
await page.evaluate((code) => {
  const inputs = document.querySelectorAll(
    '.ant-modal-content input[maxlength="1"]'
  ) as NodeListOf<HTMLInputElement>;

  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;

  for (let i = 0; i < 6 && i < inputs.length; i++) {
    const input = inputs[i] as any;
    input.focus();

    // Reset React's internal value tracker
    const tracker = input._valueTracker;
    if (tracker) {
      tracker.setValue('');  // Tell React the "previous" value was empty
    }

    // Set new value via native setter
    if (nativeSetter) nativeSetter.call(input, code[i]);

    // Now dispatch event — React will see value changed (from '' to digit)
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}, otpCode);
```

**Why might work:** The previous nativeInputValueSetter attempt may have failed because React's `_valueTracker` thought the value was already set (deduplication). Resetting the tracker forces React to recognize the change.

**Effort:** Low (20 minutes). **Risk:** Low.

### Workaround D: Traverse React Fiber to Parent onChange

Previous attempt checked input elements — no React props found. But the PARENT container (`div.numberContainer`) may have the handlers:

```typescript
await page.evaluate((code) => {
  // Find the numberContainer (parent of all 6 inputs)
  const container = document.querySelector(
    '[class*="numberContainer"]'
  ) as any;
  if (!container) throw new Error('numberContainer not found');

  // Check React keys on container AND its parent elements
  let el = container;
  while (el && el !== document.body) {
    const keys = Object.keys(el);
    const reactKey = keys.find(k =>
      k.startsWith('__reactInternalInstance$') ||
      k.startsWith('__reactFiber$') ||
      k.startsWith('__reactProps$') ||
      k.startsWith('__reactEventHandlers$')
    );
    if (reactKey) {
      console.log('Found React key on:', el.tagName, el.className?.substring(0, 50), reactKey);
      // Try to find onChange in fiber tree
      const fiber = el[reactKey];
      let node = fiber;
      while (node) {
        const props = node.memoizedProps || node.pendingProps;
        if (props?.onChange) {
          console.log('Found onChange on fiber');
          // Call it with the full OTP value
          props.onChange(code);
          return 'called onChange with full code';
        }
        node = node.return;
      }
    }
    el = el.parentElement;
  }
  return 'no React handler found';
}, otpCode);
```

**Effort:** Medium (30 minutes). **Risk:** Medium (fragile).

---

## 4. Alternative Automation Tools

### 4.1 Puppeteer

| Aspect | Assessment |
|--------|-----------|
| Protocol | CDP `Input.dispatchKeyEvent` — **SAME as Playwright** |
| Fixes OTP? | **Very unlikely** — same CDP keyboard mechanism |
| TypeScript | Full support |
| Persistent profiles | Yes (`userDataDir`) |
| Migration effort | Medium |

**Verdict: NOT recommended.** Same underlying CDP issue.

### 4.2 Selenium WebDriver for Node.js (`selenium-webdriver`)

| Aspect | Assessment |
|--------|-----------|
| Protocol | W3C WebDriver → ChromeDriver → CDP (through keyboard state machine) |
| Fixes OTP? | **Very likely YES** — Python Selenium works for this exact case |
| TypeScript | Supported via `@types/selenium-webdriver` |
| Persistent profiles | Yes (`--user-data-dir`) |
| Migration effort | **HIGH** — completely different API, all 7+ flow files need rewrite |
| Route interception | NOT built-in (need CDP bridge) |
| waitForSelector | NOT built-in (manual polling) |

```typescript
// Example: Selenium Node.js
import { Builder, By } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';

const options = new chrome.Options();
options.addArguments('--user-data-dir=/path/to/profile');

const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(options)
  .build();

// sendKeys dispatches through W3C Actions → ChromeDriver keyboard state machine
const inputs = await driver.findElements(By.css('input[maxlength="1"]'));
for (let i = 0; i < 6; i++) {
  await inputs[i].sendKeys(otpCode[i]);
  await driver.sleep(100);
}
```

**Pros:** Proven to work (Python version). W3C WebDriver protocol.
**Cons:** High migration effort. No built-in route interception. Requires ChromeDriver binary.

### 4.3 WebDriverIO (Standalone Mode) — RECOMMENDED if migration needed

| Aspect | Assessment |
|--------|-----------|
| Protocol | W3C WebDriver + WebDriver BiDi + optional CDP |
| Fixes OTP? | **Very likely YES** — same W3C protocol as Selenium |
| TypeScript | First-class (built with TypeScript) |
| Persistent profiles | Yes |
| Migration effort | **HIGH** but better API than raw Selenium |
| Standalone mode | YES — works as plain Node.js library without test runner |

```typescript
// Example: WebDriverIO standalone
import { remote } from 'webdriverio';

const browser = await remote({
  capabilities: {
    browserName: 'chrome',
    'goog:chromeOptions': {
      args: ['--user-data-dir=/path/to/profile']
    }
  }
});

// setValue uses W3C Actions internally
const inputs = await browser.$$('.ant-modal-content input[maxlength="1"]');
for (let i = 0; i < 6; i++) {
  await inputs[i].setValue(otpCode[i]);
  await browser.pause(100);
}
```

**Pros:** Better API than raw Selenium. TypeScript-native. BiDi support.
**Cons:** Still requires ChromeDriver. High migration effort. No built-in route interception.

### 4.4 Others (NOT recommended)

| Tool | Why NOT |
|------|---------|
| Cypress | Not for third-party site automation, no persistent profiles |
| playwright-extra/stealth | Stealth plugin doesn't change keyboard dispatch |
| Playwright + external Chrome | Still uses CDP for keyboard events |
| Rod (Go) | Wrong language, full rewrite needed |
| Playwright BiDi | Experimental, not production-ready |

---

## 5. Recommended Action Plan

### Phase 1: Try Playwright Workarounds (1-2 hours)

Try in this order:

1. **Clipboard Paste** (Workaround A) — 15 min, highest chance
2. **React _valueTracker reset** (Workaround C) — 20 min
3. **Direct CDP with complete properties** (Workaround B) — 30 min
4. **React fiber parent traversal** (Workaround D) — 30 min

### Phase 2: If All Workarounds Fail → Hybrid Approach

Use **Selenium WebDriver (`selenium-webdriver` npm)** for NUKE OTP only:
- Close Playwright browser context before OTP
- Open Selenium with same profile
- Fill OTP via `sendKeys`
- Close Selenium
- Reopen Playwright browser context

Drawback: slow (browser close/reopen), but works for the specific OTP step.

### Phase 3: If Hybrid Too Painful → Full Migration to WebDriverIO

Migrate NUKE automation flows to **WebDriverIO standalone mode**:
- Keep Playwright for PAY4D and VICTORY (no OTP issues there)
- Use WebDriverIO for all NUKE flows
- Both can coexist in the same project

**Migration scope:**
- `login-flow.ts` → WebDriverIO
- `nuke-tarikdb-check-flow.ts` → WebDriverIO
- `nto-check-flow.ts` → WebDriverIO
- `context-manager.ts` → add WebDriverIO browser management alongside Playwright
- `nuke-selectors.ts` → convert to WebDriverIO selector format

---

## 6. Key Technical References

- [Chrome DevTools Protocol — Input domain](https://chromedevtools.github.io/devtools-protocol/tot/Input/)
- [Playwright keyboard API](https://playwright.dev/docs/api/class-keyboard)
- [React issue #1152: Trigger change events programmatically](https://github.com/facebook/react/issues/1152)
- [Trigger Input Updates with React Controlled Inputs](https://coryrylan.com/blog/trigger-input-updates-with-react-controlled-inputs)
- [How Selenium Works: Episode 6 — sendKeys](https://www.theautomatedtester.co.uk/blog/2020/how-selenium-works-6-typing/)
- [WebDriver vs CDP vs WebDriver BiDi](https://substack.thewebscraping.club/p/webdriver-vs-cdp-vs-bidi)
- [Playwright GitHub Issue #6267: keyboard.type events](https://github.com/microsoft/playwright/issues/6267)
- [selenium-webdriver npm](https://www.npmjs.com/package/selenium-webdriver)
- [WebDriverIO standalone mode](https://webdriver.io/docs/setuptypes/)
