import type { Page } from 'playwright';
import { NUKE_SELECTORS } from '../selectors/nuke-selectors';
import { fillWithFallback, clickWithFallback, withRetry } from '../utils/retry-handler';
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
    const hasOtpInput = await page.$(S.otpInput.modal);
    if (hasOtpInput) {
      // Verify it's actually an OTP input modal (not the agreement)
      const otpInputEl = await page.$(S.otpInput.input);
      if (otpInputEl) {
        onLog('OTP input required (Google Authenticator)', 'warning');
        return { success: true, needsOtp: true };
      }
    }

    // Also check if a new modal appeared after agreement
    await page.waitForTimeout(1500);
    const hasNewModal = await page.$(S.otpInput.modal);
    if (hasNewModal) {
      const otpInputEl = await page.$(S.otpInput.input);
      if (otpInputEl) {
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
 * Submit OTP code (Google Authenticator)
 */
export async function nukeSubmitOtp(
  page: Page,
  otp: string,
  onLog: (msg: string, level?: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const S = NUKE_SELECTORS;

  try {
    onLog('Submitting OTP code...');

    // Fill OTP input
    await fillWithFallback(page, S.otpInput.input, S.otpInput.inputFallbacks, otp, { timeout: 10000 });
    await page.waitForTimeout(500);

    // Click submit
    await clickWithFallback(page, S.otpInput.submitButton, S.otpInput.submitButtonFallbacks, { timeout: 5000 });
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
