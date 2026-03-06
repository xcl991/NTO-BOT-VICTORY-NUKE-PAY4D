import type { Page } from 'playwright';
import { VICTORY_SELECTORS } from '../selectors/victory-selectors';
import { fillWithFallback, clickWithFallback } from '../utils/retry-handler';
import type { LoginFlowResult } from './login-flow';

const S = VICTORY_SELECTORS;

/**
 * Victory Login Flow:
 * Simple username + password login (no OTP, no captcha).
 *
 * 1. Navigate to panel URL (ends with /login)
 * 2. Fill #username
 * 3. Fill #password
 * 4. Click #Login_Button_signin
 * 5. Wait for SPA route change
 * 6. Verify login success (URL no longer contains /login, MUI app shell visible)
 */
export async function victoryLoginFlow(
  page: Page,
  panelUrl: string,
  username: string,
  password: string,
  onLog: (msg: string, level?: string) => void,
): Promise<LoginFlowResult> {
  try {
    // === Step 1: Navigate ===
    onLog(`Navigating to ${panelUrl}...`);
    await page.goto(panelUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Set large viewport to show more content (like zoom out)
    await page.setViewportSize({ width: 2560, height: 1440 });
    onLog('Page loaded (viewport 2560x1440)');

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

    // Wait for SPA navigation
    await page.waitForTimeout(3000);

    // === Step 5: Check for login error ===
    const errorEl = await page.$(S.login.errorMessage);
    if (errorEl) {
      const errorText = await errorEl.textContent();
      onLog(`Login error: ${errorText?.trim()}`, 'error');
      return { success: false, needsOtp: false, error: `Login failed: ${errorText?.trim()}` };
    }

    // === Step 6: Verify login success ===
    const currentUrl = page.url();

    // Check MUI app shell indicators
    const hasAppBar = await page.$(S.dashboard.appBar);
    const hasDrawer = await page.$(S.dashboard.drawer);

    if (hasAppBar || hasDrawer) {
      onLog('Login successful! Dashboard loaded', 'success');
      return { success: true, needsOtp: false };
    }

    // If not on login page anymore, consider it success
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
