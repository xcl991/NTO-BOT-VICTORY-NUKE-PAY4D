import type { Page } from 'playwright';
import { CUTTLY_SELECTORS } from '../selectors/cuttly-selectors';

type LogCallback = (msg: string, level?: string) => void;

interface LoginResult {
  success: boolean;
  error?: string;
  needsOtp?: boolean;
}

/**
 * Check if CUTT.LY session is still valid (saved session).
 * Navigates to panelUrl and checks if redirected to login page.
 */
export async function cuttlySessionCheck(page: Page, panelUrl: string, onLog: LogCallback): Promise<boolean> {
  try {
    onLog('Checking CUTT.LY saved session...');
    await page.goto(panelUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    // If redirected to login page, session expired
    if (currentUrl.includes('/login')) {
      onLog('Session expired (redirected to login page)');
      return false;
    }

    // Check if login form is present on current page
    const loginForm = await page.$(CUTTLY_SELECTORS.login.form);
    if (loginForm) {
      onLog('Session expired (login form detected)');
      return false;
    }

    onLog('Session still valid!', 'success');
    return true;
  } catch (e) {
    onLog(`Session check error: ${e}`, 'warning');
    return false;
  }
}

/**
 * CUTT.LY Login Flow:
 *
 * 1. Navigate to https://cutt.ly/login
 * 2. Fill email and password inputs
 * 3. Click Log in button (reCAPTCHA v3 invisible auto-executes)
 * 4. Wait for redirect (session saved in persistent browser profile)
 */
export async function cuttlyLoginFlow(
  page: Page,
  panelUrl: string,
  email: string,
  password: string,
  onLog: LogCallback,
): Promise<LoginResult> {
  const S = CUTTLY_SELECTORS.login;

  try {
    const loginUrl = 'https://cutt.ly/login';
    onLog(`Navigating to ${loginUrl}...`);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Fill email
    const emailInput = await page.$(S.emailInput);
    if (!emailInput) {
      return { success: false, error: 'Email input not found on login page' };
    }
    await emailInput.click();
    await page.waitForTimeout(200);
    await emailInput.fill(email);
    onLog('Email filled');

    // Fill password
    const passwordInput = await page.$(S.passwordInput);
    if (!passwordInput) {
      return { success: false, error: 'Password input not found on login page' };
    }
    await passwordInput.click();
    await page.waitForTimeout(200);
    await passwordInput.fill(password);
    onLog('Password filled');

    await page.waitForTimeout(500);

    // Click submit (reCAPTCHA v3 invisible will auto-execute)
    const submitBtn = await page.$(S.submitButton);
    if (!submitBtn) {
      return { success: false, error: 'Login button not found' };
    }

    onLog('Clicking Log in...');
    await submitBtn.click();
    await page.waitForTimeout(5000);

    // Check if login was successful — should redirect away from login page
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      // Still on login page — check for error messages
      const errorText = await page.evaluate(() => {
        const errEl = document.querySelector('.alert-danger, .error, .form-error, .text-danger');
        return errEl?.textContent?.trim() || '';
      });
      return { success: false, error: errorText || 'Login failed — masih di halaman login (mungkin reCAPTCHA block)' };
    }

    onLog(`Login berhasil! Redirected to: ${currentUrl}`, 'success');
    return { success: true };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`Login error: ${msg}`, 'error');
    return { success: false, error: msg };
  }
}
