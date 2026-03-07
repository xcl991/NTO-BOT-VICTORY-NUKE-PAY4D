import type { Page } from 'playwright';
import { NUKE_SELECTORS } from '../selectors/nuke-selectors';
import { fillWithFallback, clickWithFallback, withRetry } from '../utils/retry-handler';
import { generateTOTP, getClockOffsetSeconds } from '../utils/totp';
import logger from '../../utils/logger';

export interface LoginFlowResult {
  success: boolean;
  needsOtp: boolean;
  error?: string;
}

/**
 * NUKE Login Flow:
 * 1. Navigate to panel URL
 * 2. Fill username (#username)
 * 3. Fill password (#password)
 * 4. Click Login button (button[type="submit"])
 * 5. Handle OTP Agreement popup if appears:
 *    - Check the checkbox
 *    - Click "Lanjutkan"
 * 6. Check if OTP input is needed (Google Authenticator)
 * 7. Verify login success
 */
export async function nukeLoginFlow(
  page: Page,
  panelUrl: string,
  username: string,
  password: string,
  onLog: (msg: string, level?: string) => void,
  twoFaSecret?: string,
): Promise<LoginFlowResult> {
  const S = NUKE_SELECTORS;

  try {
    // === Step 1: Navigate ===
    onLog(`Navigating to ${panelUrl}...`);
    await page.goto(panelUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    onLog('Page loaded');

    // === Step 2: Fill Username ===
    onLog('Filling username...');
    await fillWithFallback(page, S.login.username, S.login.usernameFallbacks, username, { timeout: 10000 });

    // === Step 3: Fill Password ===
    onLog('Filling password...');
    await fillWithFallback(page, S.login.password, S.login.passwordFallbacks, password, { timeout: 5000 });

    // === Step 4: Click Login ===
    onLog('Clicking login button...');
    await clickWithFallback(page, S.login.submitButton, S.login.submitButtonFallbacks, { timeout: 5000 });
    onLog('Login form submitted, waiting for response...');

    // Wait for page to respond
    await page.waitForTimeout(3000);

    // === Step 5: Check for login error ===
    const errorEl = await page.$(S.login.errorMessage);
    if (errorEl) {
      const errorText = await errorEl.textContent();
      onLog(`Login error: ${errorText?.trim()}`, 'error');
      return { success: false, needsOtp: false, error: `Login failed: ${errorText?.trim()}` };
    }

    // === Step 6: Handle OTP Agreement popup ===
    // Wait for modal to appear (may take a few seconds after login)
    let hasOtpAgreement = false;
    try {
      await page.waitForSelector(S.otpAgreement.modal, { timeout: 10000, state: 'visible' });
      hasOtpAgreement = true;
    } catch {
      // No modal appeared within timeout - might go straight to dashboard
    }

    if (hasOtpAgreement) {
      onLog('OTP Agreement popup detected');

      // Try to find the agreement title, but don't require it
      const hasAgreementTitle = await page.$(S.otpAgreement.title);
      // Also check for checkbox as indicator
      const hasCheckbox = await page.$(S.otpAgreement.checkbox);

      if (hasAgreementTitle || hasCheckbox) {
        onLog('Checking agreement checkbox...');
        await clickWithFallback(page, S.otpAgreement.checkbox, S.otpAgreement.checkboxFallbacks, { timeout: 5000 });
        await page.waitForTimeout(500);

        onLog('Clicking "Lanjutkan"...');
        await clickWithFallback(page, S.otpAgreement.continueButton, S.otpAgreement.continueButtonFallbacks, { timeout: 5000 });
        await page.waitForTimeout(2000);
        onLog('OTP Agreement accepted');
      }
    }

    // === Step 7: Check if OTP input is needed ===
    // Wait a bit for OTP modal to appear
    await page.waitForTimeout(1500);

    // Detect OTP modal (check both 6-digit and single-input styles)
    const otpModalDetected = await detectOtpModal(page);

    if (otpModalDetected) {
      if (twoFaSecret) {
        // Auto-fill OTP using TOTP secret
        onLog('OTP modal detected, auto-filling with 2FA secret...');
        const autoResult = await autoFillOtp(page, twoFaSecret, onLog);
        if (autoResult.success) {
          onLog('Auto-OTP successful!', 'success');
          // Fall through to dashboard verification below
        } else {
          onLog(`Auto-OTP failed: ${autoResult.error}`, 'error');
          return { success: false, needsOtp: false, error: autoResult.error };
        }
      } else {
        onLog('OTP input required (Google Authenticator)', 'warning');
        return { success: true, needsOtp: true };
      }
    }

    // === Step 8: Verify login success ===
    const currentUrl = page.url();
    const dashboardIndicator = await page.$(S.dashboard.sidebar);

    if (currentUrl.includes('/dashboard') || currentUrl.includes('/home') || dashboardIndicator) {
      onLog('Login successful! Dashboard loaded', 'success');
      return { success: true, needsOtp: false };
    }

    // If we're not on login page anymore, consider it success
    if (!currentUrl.includes('/login') && !currentUrl.includes('/auth')) {
      onLog(`Login appears successful (URL: ${currentUrl})`, 'success');
      return { success: true, needsOtp: false };
    }

    onLog('Login status unclear, may need manual check', 'warning');
    return { success: false, needsOtp: false, error: 'Could not verify login success' };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`Login flow error: ${msg}`, 'error');
    return { success: false, needsOtp: false, error: msg };
  }
}

/**
 * Detect if an OTP modal is visible (either 6-digit or single-input style).
 */
async function detectOtpModal(page: Page): Promise<boolean> {
  const S = NUKE_SELECTORS;

  // Check for 6-digit inputs (primary selector, then fallback)
  let sixDigitInputs = await page.$$(S.otpSixDigit.inputs);
  if (sixDigitInputs.length < 6) {
    sixDigitInputs = await page.$$(S.otpSixDigit.inputsFallback);
  }
  if (sixDigitInputs.length >= 6) return true;

  // Check for single-input OTP
  const hasModal = await page.$(S.otpInput.modal);
  if (hasModal) {
    const otpInputEl = await page.$(S.otpInput.input);
    if (otpInputEl) return true;
  }

  return false;
}

/**
 * Auto-fill OTP using TOTP secret. Handles both 6-digit individual inputs and single input.
 * Retries up to 3 times (matching Python reference behavior).
 */
async function autoFillOtp(
  page: Page,
  twoFaSecret: string,
  onLog: (msg: string, level?: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const S = NUKE_SELECTORS;
  const MAX_OTP_ATTEMPTS = 3;

  try {
    for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt++) {
      const otpCode = await generateTOTP(twoFaSecret);
      onLog(`Generated TOTP code: ${otpCode} (attempt ${attempt}/${MAX_OTP_ATTEMPTS}, clock offset: ${getClockOffsetSeconds()}s)`);

      // Re-detect inputs each attempt (modal may refresh)
      let inputs = await page.$$(S.otpSixDigit.inputs);
      if (!inputs || inputs.length < 6) {
        inputs = await page.$$(S.otpSixDigit.inputsFallback);
      }

      if (inputs && inputs.length >= 6) {
        onLog('Filling 6-digit OTP inputs (via React fiber)...');
        await fillOtpDigitsViaKeyboard(page, inputs.slice(0, 6), otpCode, onLog);
      } else {
        // Fallback to single input
        onLog('Filling single OTP input...');
        await fillWithFallback(page, S.otpInput.input, S.otpInput.inputFallbacks, otpCode, { timeout: 10000 });
      }

      await page.waitForTimeout(500);

      // Click submit
      try {
        await clickWithFallback(page, S.otpSixDigit.submitButton, S.otpSixDigit.submitButtonFallbacks, { timeout: 5000 });
      } catch {
        await clickWithFallback(page, S.otpInput.submitButton, S.otpInput.submitButtonFallbacks, { timeout: 5000 });
      }

      onLog('OTP submitted, waiting for response...');
      await page.waitForTimeout(3000);

      // Check for error — match both global messages and in-modal errorText
      const errorEl = await page.$('.ant-message-error, .ant-alert-error, [class*="errorText"], .ant-typography:has-text("Invalid")');
      if (errorEl) {
        const errorText = await errorEl.textContent();
        onLog(`OTP error: ${errorText?.trim()}`, 'warning');

        if (attempt < MAX_OTP_ATTEMPTS) {
          onLog(`Retrying OTP (attempt ${attempt + 1}/${MAX_OTP_ATTEMPTS})...`);
          // Clear inputs before retry
          if (inputs && inputs.length >= 6) {
            for (const input of inputs.slice(0, 6)) {
              await input.evaluate((el: any) => { el.value = ''; });
            }
          }
          await page.waitForTimeout(2000);
          continue;
        }

        return { success: false, error: `OTP failed after ${MAX_OTP_ATTEMPTS} attempts: ${errorText?.trim()}` };
      }

      // Verify success - no longer on login page
      const currentUrl = page.url();
      if (!currentUrl.includes('/login') && !currentUrl.includes('/auth')) {
        return { success: true };
      }

      if (attempt < MAX_OTP_ATTEMPTS) {
        onLog('OTP may not have been accepted, retrying...', 'warning');
        await page.waitForTimeout(2000);
        continue;
      }

      return { success: false, error: 'Could not verify OTP success' };
    }

    return { success: false, error: 'OTP failed after all attempts' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

/**
 * Fill 6-digit OTP inputs using cascade of strategies.
 * See nuke-tarikdb-check-flow.ts for the full implementation with all 4 strategies.
 * This is a simplified version that imports the same logic pattern.
 */
async function fillOtpDigitsViaKeyboard(
  page: Page,
  _inputs: Awaited<ReturnType<Page['$$']>>,
  otpCode: string,
  onLog: (msg: string, level?: string) => void,
): Promise<void> {
  const strategies: Array<{ name: string; fn: () => Promise<void> }> = [
    { name: 'clipboard-paste', fn: async () => {
      try { await page.context().grantPermissions(['clipboard-read', 'clipboard-write']); } catch {}
      await page.evaluate(async (code: string) => {
        if ((globalThis as any).navigator?.clipboard?.writeText) {
          await (globalThis as any).navigator.clipboard.writeText(code);
        } else {
          const ta = (globalThis as any).document.createElement('textarea');
          ta.value = code; (globalThis as any).document.body.appendChild(ta);
          ta.select(); (globalThis as any).document.execCommand('copy');
          (globalThis as any).document.body.removeChild(ta);
        }
      }, otpCode);
      const fi = page.locator('.ant-modal-content input[maxlength="1"]').first();
      await fi.click(); await page.waitForTimeout(300);
      await page.keyboard.press('Control+KeyV'); await page.waitForTimeout(1000);
    }},
    { name: 'valueTracker-reset', fn: async () => {
      await page.evaluate((code: string) => {
        const doc = (globalThis as any).document;
        const inputs = doc.querySelectorAll('.ant-modal-content input[maxlength="1"]');
        const ns = Object.getOwnPropertyDescriptor((globalThis as any).HTMLInputElement.prototype, 'value')?.set;
        if (!ns || inputs.length < 6) return;
        for (let i = 0; i < 6 && i < code.length; i++) {
          const input = inputs[i] as any;
          input.focus();
          if (input._valueTracker) input._valueTracker.setValue('');
          ns.call(input, code[i]);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, otpCode);
      await page.waitForTimeout(500);
    }},
    { name: 'direct-cdp', fn: async () => {
      const client = await page.context().newCDPSession(page);
      const fi = page.locator('.ant-modal-content input[maxlength="1"]').first();
      await fi.click(); await page.waitForTimeout(300);
      for (const d of otpCode) {
        const kc = d.charCodeAt(0);
        await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: d, code: `Digit${d}`, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc, text: d, unmodifiedText: d });
        await client.send('Input.dispatchKeyEvent', { type: 'char', key: d, code: `Digit${d}`, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc, text: d, unmodifiedText: d });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: d, code: `Digit${d}`, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc });
        await page.waitForTimeout(250);
      }
      await client.detach(); await page.waitForTimeout(500);
    }},
    { name: 'pressSequentially', fn: async () => {
      const fi = page.locator('.ant-modal-content input[maxlength="1"]').first();
      await fi.click(); await page.waitForTimeout(500);
      await fi.pressSequentially(otpCode, { delay: 300 }); await page.waitForTimeout(500);
    }},
  ];

  for (const s of strategies) {
    onLog(`Trying OTP strategy: ${s.name}...`);
    try { await s.fn(); } catch (e) {
      onLog(`Strategy ${s.name} error: ${e instanceof Error ? e.message : e}`, 'warning');
      continue;
    }
    await page.waitForTimeout(800);
    const enabled = await page.evaluate(() => {
      const btns = (globalThis as any).document.querySelectorAll('.ant-modal-footer button');
      for (const b of Array.from(btns) as any[]) {
        if (b.classList.contains('ant-btn-primary') || b.textContent?.trim().toLowerCase() === 'submit') return !b.disabled;
      }
      return false;
    });
    const filled = await page.evaluate(() => {
      const inputs = (globalThis as any).document.querySelectorAll('.ant-modal-content input[maxlength="1"]');
      return Array.from(inputs).map((el: any) => el.value).join('');
    });
    onLog(`[${s.name}] Submit: ${enabled} | Filled: "${filled}" (expected: ${otpCode})`);
    if (enabled) { onLog(`Strategy "${s.name}" succeeded!`, 'success'); return; }
  }
  onLog('All OTP strategies exhausted', 'error');
}

/**
 * Submit OTP code (Google Authenticator) — manual entry from panel
 */
export async function nukeSubmitOtp(
  page: Page,
  otp: string,
  onLog: (msg: string, level?: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const S = NUKE_SELECTORS;

  try {
    onLog('Submitting OTP code...');

    // Check for 6-digit individual inputs
    let inputs = await page.$$(S.otpSixDigit.inputs);
    if (!inputs || inputs.length < 6) {
      inputs = await page.$$(S.otpSixDigit.inputsFallback);
    }

    if (inputs && inputs.length >= 6) {
      // 6-digit style: fill each digit using native setter (matching Python reference)
      onLog('Detected 6-digit OTP input style');
      const digits = otp.replace(/\D/g, '').substring(0, 6);
      await fillOtpDigitsViaKeyboard(page, inputs.slice(0, 6), digits, onLog);
    } else {
      // Single input style
      await fillWithFallback(page, S.otpInput.input, S.otpInput.inputFallbacks, otp, { timeout: 10000 });
    }

    await page.waitForTimeout(500);

    // Click submit
    try {
      await clickWithFallback(page, S.otpSixDigit.submitButton, S.otpSixDigit.submitButtonFallbacks, { timeout: 5000 });
    } catch {
      await clickWithFallback(page, S.otpInput.submitButton, S.otpInput.submitButtonFallbacks, { timeout: 5000 });
    }
    onLog('OTP submitted, waiting for response...');

    await page.waitForTimeout(3000);

    // Check for error
    const errorEl = await page.$('.ant-message-error, .ant-alert-error');
    if (errorEl) {
      const errorText = await errorEl.textContent();
      onLog(`OTP error: ${errorText?.trim()}`, 'error');
      return { success: false, error: `OTP failed: ${errorText?.trim()}` };
    }

    // Verify success
    const currentUrl = page.url();
    if (!currentUrl.includes('/login') && !currentUrl.includes('/auth')) {
      onLog('OTP accepted, login complete!', 'success');
      return { success: true };
    }

    return { success: false, error: 'Could not verify OTP success' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`OTP error: ${msg}`, 'error');
    return { success: false, error: msg };
  }
}
