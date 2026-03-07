import type { Page, Frame } from 'playwright';
import { PAY4D_SELECTORS } from '../selectors/pay4d-selectors';
import { fillWithFallback, clickWithFallback } from '../utils/retry-handler';
import { solveCaptcha, type CaptchaContext } from '../utils/captcha-solver';
import type { LoginFlowResult } from './login-flow';
import logger from '../../utils/logger';

const S = PAY4D_SELECTORS;

/**
 * PAY4D Login Flow - Two phases:
 *
 * Phase 1 - Login page:
 *   Fill username, password, solve image captcha, submit
 *
 * Phase 2 - PIN entry (cross-origin iframe):
 *   After login, page loads iframe#pin from auth.dotflyby.com
 *   Enter 6-digit PIN via virtual keypad with randomized button positions
 *   iframe validates PIN via AJAX, then sends token to parent via postMessage
 *   Parent navigates to /mimin/adminarea on success
 */
export async function pay4dLoginFlow(
  page: Page,
  panelUrl: string,
  username: string,
  password: string,
  pinCode: string,
  onLog: (msg: string, level?: string) => void,
  accountId?: number,
): Promise<LoginFlowResult> {
  const MAX_ROUNDS = 3; // 3 rounds × 3 captcha attempts per round = 9 total attempts
  const captchaCtx: CaptchaContext = { accountId, provider: 'PAY4D' };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    try {
      onLog(`Login round ${round}/${MAX_ROUNDS}...`);

      // ========== PHASE 1: Login with Captcha ==========

      onLog(`Navigating to ${panelUrl}...`);
      await page.goto(panelUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
      onLog('Page loaded');

      // Fill username
      onLog('Filling username...');
      await fillWithFallback(page, S.login.username, S.login.usernameFallbacks, username, { timeout: 10000 });

      // Fill password
      onLog('Filling password...');
      await fillWithFallback(page, S.login.password, S.login.passwordFallbacks, password, { timeout: 5000 });

      // Solve captcha (3 attempts per round)
      const captchaResult = await solveCaptchaWithLoginRetry(page, onLog, captchaCtx);
      if (!captchaResult.success) {
        onLog(`Round ${round}: captcha solving failed, ${round < MAX_ROUNDS ? 'refreshing browser...' : 'giving up'}`, 'warning');
        if (round < MAX_ROUNDS) continue; // next round = refresh browser
        return { success: false, needsOtp: false, error: captchaResult.error };
      }

      // Fill captcha
      onLog(`Captcha solved: ${captchaResult.digits}`);
      await fillWithFallback(page, S.login.captchaInput, S.login.captchaInputFallbacks, captchaResult.digits!, { timeout: 5000 });

      // Submit login
      onLog('Clicking login button...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
        clickWithFallback(page, S.login.submitButton, S.login.submitButtonFallbacks, { timeout: 5000 }),
      ]);
      onLog('Login form submitted, page loaded');
      await page.waitForTimeout(2000);
      onLog(`Post-login URL: ${page.url()}`);

      // Check for login errors
      const loginCheckResult = await checkLoginResult(page, onLog);

      // If captcha was wrong, go to next round (refresh browser)
      if (loginCheckResult.captchaWrong) {
        onLog(`Round ${round}: captcha was wrong, ${round < MAX_ROUNDS ? 'refreshing browser...' : 'giving up'}`, 'warning');
        if (round < MAX_ROUNDS) continue; // next round
        return { success: false, needsOtp: false, error: loginCheckResult.error };
      }

      if (!loginCheckResult.success) {
        return { success: false, needsOtp: false, error: loginCheckResult.error };
      }

      // ========== PHASE 2: PIN Entry (cross-origin iframe) ==========

      if (!pinCode) {
        onLog('No PIN code configured, skipping PIN entry', 'warning');
        return { success: true, needsOtp: false };
      }

      return await handlePinPhase(page, pinCode, onLog);

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onLog(`Round ${round} error: ${msg}`, 'error');
      if (round >= MAX_ROUNDS) {
        return { success: false, needsOtp: false, error: msg };
      }
      // Continue to next round
    }
  }

  return { success: false, needsOtp: false, error: `Login failed after ${MAX_ROUNDS} rounds (${MAX_ROUNDS * 3} captcha attempts)` };
}

/**
 * Handle the entire PIN phase: detect iframe, enter PIN, verify result.
 *
 * After PIN success, the iframe sends a token to the parent via postMessage.
 * The parent page's JS tries to navigate to "mimin/adminarea" (relative URL),
 * which resolves to /mimin/mimin/adminarea (broken double path).
 * We block this broken navigation so the page stays at /mimin/ with the
 * admin area already visible (the iframe gets hidden by the parent JS).
 */
async function handlePinPhase(
  page: Page,
  pinCode: string,
  onLog: (msg: string, level?: string) => void,
): Promise<LoginFlowResult> {
  // Wait for PIN iframe to appear
  onLog('Waiting for PIN iframe...');
  const pinFrame = await waitForPinFrame(page);

  if (!pinFrame) {
    const currentUrl = page.url();
    if (currentUrl.includes(S.dashboard.adminAreaPath)) {
      onLog('No PIN iframe, already in admin area', 'success');
      return { success: true, needsOtp: false };
    }
    return { success: false, needsOtp: false, error: 'PIN iframe did not appear and not in admin area' };
  }

  onLog('PIN iframe detected, checking keypad...');

  // Check for account suspension inside the iframe
  const isSuspended = await pinFrame.evaluate(() => {
    const el = document.getElementById('suspend');
    if (!el || el.style.display === 'none') return '';
    return el.textContent?.trim() || '';
  }).catch(() => '');

  if (isSuspended) {
    onLog(`Account suspended: ${isSuspended}`, 'error');
    return { success: false, needsOtp: false, error: `Account suspended: ${isSuspended}` };
  }

  // Block the broken adminarea navigation BEFORE entering PIN.
  // Parent page uses relative URL "mimin/adminarea" → resolves to /mimin/mimin/adminarea.
  // We abort this request so the page stays at /mimin/ with admin area visible.
  await page.route('**/mimin/mimin/**', route => route.abort());

  // Enter PIN via virtual keypad inside the iframe
  onLog('Entering PIN via keypad...');
  const pinResult = await enterPinViaKeypad(pinFrame, pinCode, onLog);

  if (!pinResult.success) {
    await page.unroute('**/mimin/mimin/**');
    return { success: false, needsOtp: false, error: pinResult.error };
  }

  // Verify PIN was accepted
  onLog('PIN entered, verifying...');
  const result = await verifyPostPinResult(page, pinFrame, onLog);

  // Clean up route interception
  await page.unroute('**/mimin/mimin/**');

  return result;
}

/**
 * Solve captcha with up to 3 OCR attempts before submitting
 */
async function solveCaptchaWithLoginRetry(
  page: Page,
  onLog: (msg: string, level?: string) => void,
  context?: CaptchaContext,
): Promise<{ success: boolean; digits?: string; error?: string }> {
  try {
    onLog('Solving captcha...');
    const digits = await solveCaptcha(page, S.login.captchaImage, 3, context);
    return { success: true, digits };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`Captcha solving failed: ${msg}`, 'error');
    return { success: false, error: `Captcha solving failed: ${msg}` };
  }
}

/**
 * Check the result after submitting login form
 */
async function checkLoginResult(
  page: Page,
  onLog: (msg: string, level?: string) => void,
): Promise<{ success: boolean; captchaWrong: boolean; error?: string }> {
  // Check for error messages
  const errorEl = await page.$(S.login.errorMessage);
  if (errorEl) {
    const errorText = (await errorEl.textContent())?.trim() ?? '';
    const lowerError = errorText.toLowerCase();

    // Check if it's specifically a captcha error
    if (lowerError.includes('captcha') || lowerError.includes('kode') || lowerError.includes('verifikasi')) {
      return { success: false, captchaWrong: true, error: errorText };
    }

    onLog(`Login error: ${errorText}`, 'error');
    return { success: false, captchaWrong: false, error: `Login failed: ${errorText}` };
  }

  // Check URL - if still on login page with same URL, might be an error without visible message
  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
    // Check if captcha image refreshed (indicating wrong captcha)
    const captchaEl = await page.$(S.login.captchaImage);
    if (captchaEl) {
      return { success: false, captchaWrong: false, error: 'Login failed - still on login page' };
    }
  }

  return { success: true, captchaWrong: false };
}


/**
 * Wait for the PIN iframe to appear and return its Frame.
 * PAY4D loads the PIN form inside: <iframe id="pin" src="https://auth.dotflyby.com/v3/pin.php">
 */
async function waitForPinFrame(page: Page): Promise<Frame | null> {
  try {
    // Wait for the iframe element to appear on the main page
    logger.info('[waitForPinFrame] Waiting for iframe#pin...');
    const iframeEl = await page.waitForSelector(S.pin.iframe, {
      state: 'visible',
      timeout: 15000,
    });

    if (!iframeEl) {
      logger.warn('[waitForPinFrame] iframe element not found');
      return null;
    }

    // Get the Frame from the iframe element
    const frame = await iframeEl.contentFrame();
    if (!frame) {
      logger.warn('[waitForPinFrame] contentFrame() returned null');
      return null;
    }

    logger.info(`[waitForPinFrame] Got frame: ${frame.url()}`);

    // Wait for the keypad to be ready inside the frame
    await frame.waitForSelector('#keypad button.num', {
      state: 'visible',
      timeout: 15000,
    });

    logger.info('[waitForPinFrame] Keypad is ready inside iframe');
    return frame;
  } catch (e) {
    logger.error(`[waitForPinFrame] Error: ${e}`);
    return null;
  }
}

/**
 * Verify the result after PIN entry.
 * After correct PIN, iframe's AJAX validates and sends token to parent.
 * We check the iframe's msgbox to determine if PIN was accepted.
 * The broken navigation to adminarea is already blocked by route handler.
 */
async function verifyPostPinResult(
  page: Page,
  pinFrame: Frame,
  onLog: (msg: string, level?: string) => void,
): Promise<LoginFlowResult> {
  // Wait for the iframe's AJAX to complete (250ms delay + network call)
  await new Promise(r => setTimeout(r, 3000));

  // Check if PIN was accepted by examining the iframe's msgbox
  try {
    const msgText = await pinFrame.evaluate(() => {
      return document.getElementById('msgbox')?.textContent?.trim() || '';
    });

    // If msgbox still shows PIN prompt with attempt counter, PIN was wrong
    if (msgText.toLowerCase().includes('masukkan pin')) {
      onLog(`PIN incorrect: ${msgText}`, 'error');
      return { success: false, needsOtp: false, error: `PIN error: ${msgText}` };
    }

    // msgbox changed to something else (success message) → PIN accepted
    logger.info(`[verifyPostPinResult] PIN accepted, msgbox: "${msgText}"`);
  } catch {
    // Frame was destroyed → parent page processed the token (success)
    logger.info('[verifyPostPinResult] PIN iframe destroyed, assuming success');
  }

  // Wait for parent page to finish processing (hide iframe, set session)
  await new Promise(r => setTimeout(r, 1000));

  onLog('Login successful! PIN verified', 'success');
  return { success: true, needsOtp: false };
}

/**
 * Enter PIN by clicking virtual keypad buttons inside the iframe.
 * Buttons have randomized positions, so we find each button by its text content.
 */
async function enterPinViaKeypad(
  frame: Frame,
  pinCode: string,
  onLog: (msg: string, level?: string) => void,
): Promise<{ success: boolean; error?: string }> {
  try {
    for (let i = 0; i < pinCode.length; i++) {
      const digit = pinCode[i];

      // Find all keypad buttons inside the iframe
      const buttons = await frame.$$('#keypad button.num');

      if (buttons.length === 0) {
        return { success: false, error: `No keypad buttons found in iframe for digit #${i + 1}` };
      }

      const targetBtn = await findButtonByDigit(buttons, digit);
      if (!targetBtn) {
        return { success: false, error: `Could not find keypad button for digit "${digit}"` };
      }
      await targetBtn.click();

      // Brief wait between digit presses for the pin dot to update
      await new Promise(r => setTimeout(r, 300));
    }

    onLog(`PIN entered (${pinCode.length} digits)`);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `PIN entry failed: ${msg}` };
  }
}

/**
 * Find a keypad button element whose trimmed text content matches the given digit
 */
async function findButtonByDigit(
  buttons: Awaited<ReturnType<Frame['$$']>>,
  digit: string,
): Promise<Awaited<ReturnType<Frame['$']>>> {
  for (const btn of buttons) {
    const text = await btn.textContent();
    if (text?.trim() === digit) {
      return btn;
    }
  }
  return null;
}
