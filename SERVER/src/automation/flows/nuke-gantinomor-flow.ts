import type { Page } from 'playwright';
import { NUKE_SELECTORS } from '../selectors/nuke-selectors';
import { handleMidSessionOtp } from './nuke-tarikdb-check-flow';
import logger from '../../utils/logger';

type LogCallback = (msg: string, level?: string) => void;

export interface GantiNomorResult {
  success: boolean;
  changed: { cs?: string; mst?: string };
  error?: string;
}

/**
 * Fill an Ant Design input using React valueTracker-reset strategy.
 * Clears existing value, sets new one, dispatches input/change events.
 */
async function fillAntInput(page: Page, selector: string, value: string, onLog: LogCallback): Promise<boolean> {
  try {
    const el = await page.$(selector);
    if (!el) {
      onLog(`Input not found: ${selector}`, 'warning');
      return false;
    }

    // Click to focus
    await el.click();
    await page.waitForTimeout(300);

    // Select all + delete existing content
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    // Strategy 1: valueTracker-reset (works for React/Ant Design inputs)
    const filled = await page.evaluate(({ sel, val }) => {
      const input = document.querySelector(sel) as HTMLInputElement;
      if (!input) return false;

      // Reset React's internal _valueTracker
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      if (!nativeInputValueSetter) return false;

      const tracker = (input as any)._valueTracker;
      if (tracker) tracker.setValue('');

      nativeInputValueSetter.call(input, val);

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      return input.value === val;
    }, { sel: selector, val: value });

    if (filled) return true;

    // Strategy 2: type char by char
    onLog(`valueTracker strategy failed for ${selector}, trying keyboard...`);
    await el.click({ clickCount: 3 }); // select all
    await page.waitForTimeout(100);
    await page.keyboard.type(value, { delay: 50 });
    await page.waitForTimeout(200);

    const currentValue = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)?.value || '',
      selector,
    );
    return currentValue === value;
  } catch (e) {
    onLog(`fillAntInput error: ${e}`, 'error');
    return false;
  }
}

/**
 * NUKE GANTI NOMOR Flow:
 *
 * Navigate to /configuration/identity page, change WhatsApp number(s), submit.
 * Handles mid-session OTP if 2FA modal appears.
 *
 * @param oldCs / newCs - Old and new WhatsApp CS number (optional pair)
 * @param oldMst / newMst - Old and new WhatsApp MST number (optional pair)
 */
export async function nukeGantiNomorFlow(
  page: Page,
  panelUrl: string,
  onLog: LogCallback,
  options: {
    oldCs?: string;
    newCs?: string;
    oldMst?: string;
    newMst?: string;
    twoFaSecret?: string;
  },
): Promise<GantiNomorResult> {
  const S = NUKE_SELECTORS.identity;
  const changed: { cs?: string; mst?: string } = {};

  const hasCs = options.oldCs && options.newCs;
  const hasMst = options.oldMst && options.newMst;
  if (!hasCs && !hasMst) {
    return { success: false, changed, error: 'Tidak ada pasangan old+new yang diberikan (cs/mst)' };
  }

  try {
    const baseUrl = panelUrl.replace(/\/+$/, '');
    const identityUrl = `${baseUrl}/configuration/identity`;

    onLog(`Navigating to identity page...`);
    await page.goto(identityUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Handle mid-session OTP if needed
    const otpResult = await handleMidSessionOtp(page, onLog, options.twoFaSecret);
    if (otpResult === 'needs_otp') {
      return { success: false, changed, error: 'OTP 2FA diperlukan. Tambahkan 2FA Secret di account settings atau submit OTP manual.' };
    }
    if (otpResult === 'handled') {
      // Re-navigate after OTP
      onLog('OTP handled, re-navigating to identity page...');
      await page.goto(identityUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    }

    // Verify we're on the identity page
    const currentUrl = page.url();
    if (!currentUrl.includes('/configuration/identity')) {
      return { success: false, changed, error: `Gagal navigasi ke identity page (URL: ${currentUrl})` };
    }

    // Wait for form to load
    const whatsappInput = await page.$(S.whatsapp);
    if (!whatsappInput) {
      // Try waiting a bit more
      await page.waitForTimeout(2000);
      const retry = await page.$(S.whatsapp);
      if (!retry) {
        return { success: false, changed, error: 'Input WhatsApp (#whatsapp) tidak ditemukan di halaman' };
      }
    }

    // Read current values
    const currentCs = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)?.value || '',
      S.whatsapp,
    );
    const currentMst = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)?.value || '',
      S.whatsapp2,
    );

    onLog(`Current CS: ${currentCs}, MST: ${currentMst}`);

    // Verify & fill CS (WhatsApp) if old+new pair provided
    if (hasCs) {
      // Verify old value matches
      if (currentCs !== options.oldCs) {
        return { success: false, changed, error: `Old CS tidak cocok. Di panel: "${currentCs}", di command: "${options.oldCs}"` };
      }
      onLog(`Changing CS WhatsApp: ${options.oldCs} → ${options.newCs}...`);
      const csOk = await fillAntInput(page, S.whatsapp, options.newCs!, onLog);
      if (csOk) {
        changed.cs = options.newCs;
        onLog(`CS WhatsApp changed to ${options.newCs}`, 'success');
      } else {
        return { success: false, changed, error: `Gagal mengisi input CS WhatsApp` };
      }
    }

    // Verify & fill MST (Second WhatsApp) if old+new pair provided
    if (hasMst) {
      // Verify old value matches
      if (currentMst !== options.oldMst) {
        return { success: false, changed, error: `Old MST tidak cocok. Di panel: "${currentMst}", di command: "${options.oldMst}"` };
      }
      onLog(`Changing MST WhatsApp: ${options.oldMst} → ${options.newMst}...`);
      const mstOk = await fillAntInput(page, S.whatsapp2, options.newMst!, onLog);
      if (mstOk) {
        changed.mst = options.newMst;
        onLog(`MST WhatsApp changed to ${options.newMst}`, 'success');
      } else {
        return { success: false, changed, error: `Gagal mengisi input MST WhatsApp` };
      }
    }

    await page.waitForTimeout(500);

    // Click Submit
    onLog('Clicking Submit...');
    const submitBtn = await page.$(S.submitButton)
      || await page.$(S.submitButtonFallbacks[0])
      || await page.$(S.submitButtonFallbacks[1]);

    if (!submitBtn) {
      return { success: false, changed, error: 'Submit button tidak ditemukan' };
    }

    await submitBtn.click();
    await page.waitForTimeout(3000);

    // Check for success notification (Ant Design message)
    const hasSuccess = await page.$('.ant-message-success, .ant-notification-notice-success');
    const hasError = await page.$('.ant-message-error, .ant-notification-notice-error');

    if (hasError) {
      const errorText = await page.evaluate(() => {
        const el = document.querySelector('.ant-message-error .ant-message-custom-content span:last-child, .ant-notification-notice-error .ant-notification-notice-message');
        return el?.textContent || 'Unknown error';
      });
      return { success: false, changed, error: `Submit gagal: ${errorText}` };
    }

    // Verify values after submit
    await page.waitForTimeout(1000);
    const verifyCs = hasCs ? await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)?.value || '',
      S.whatsapp,
    ) : null;
    const verifyMst = hasMst ? await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLInputElement)?.value || '',
      S.whatsapp2,
    ) : null;

    if (hasCs && verifyCs !== options.newCs) {
      onLog(`Warning: CS value after submit is "${verifyCs}" (expected "${options.newCs}")`, 'warning');
    }
    if (hasMst && verifyMst !== options.newMst) {
      onLog(`Warning: MST value after submit is "${verifyMst}" (expected "${options.newMst}")`, 'warning');
    }

    const changedParts: string[] = [];
    if (changed.cs) changedParts.push(`CS: ${changed.cs}`);
    if (changed.mst) changedParts.push(`MST: ${changed.mst}`);
    onLog(`GANTI NOMOR berhasil: ${changedParts.join(', ')}`, 'success');

    return { success: true, changed };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog(`GANTI NOMOR error: ${msg}`, 'error');
    return { success: false, changed, error: msg };
  }
}
