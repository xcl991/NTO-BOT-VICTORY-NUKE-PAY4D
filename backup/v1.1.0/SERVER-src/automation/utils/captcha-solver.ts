import type { Page } from 'playwright';
import logger from '../../utils/logger';
import prisma from '../../utils/prisma';
import path from 'path';
import fs from 'fs';

const TWOCAPTCHA_IN = 'http://2captcha.com/in.php';
const TWOCAPTCHA_RES = 'http://2captcha.com/res.php';

/**
 * Get 2Captcha API key from settings.
 */
async function get2CaptchaKey(): Promise<string | null> {
  const setting = await prisma.setting.findUnique({ where: { key: 'captcha_api_key' } });
  return setting?.value || null;
}

/**
 * Fetch current 2Captcha balance.
 */
async function getBalance(apiKey: string): Promise<number | null> {
  try {
    const res = await fetch(`${TWOCAPTCHA_RES}?key=${apiKey}&action=getbalance&json=1`);
    const data = await res.json() as { status: number; request: string };
    if (data.status === 1) return parseFloat(data.request);
    return null;
  } catch {
    return null;
  }
}

/**
 * Record a captcha usage entry in the database.
 */
async function recordCaptchaUsage(entry: {
  balanceBefore: number;
  balanceAfter: number;
  captchaId?: string;
  result?: string;
  accountId?: number;
  provider?: string;
  status: string;
}): Promise<void> {
  try {
    await prisma.captchaUsage.create({
      data: {
        balanceBefore: entry.balanceBefore,
        balanceAfter: entry.balanceAfter,
        cost: Math.max(0, entry.balanceBefore - entry.balanceAfter),
        captchaId: entry.captchaId ?? null,
        result: entry.result ?? null,
        accountId: entry.accountId ?? null,
        provider: entry.provider ?? null,
        status: entry.status,
      },
    });
  } catch (e) {
    logger.error(`[CaptchaSolver] Failed to record usage: ${e}`);
  }
}

export interface CaptchaContext {
  accountId?: number;
  provider?: string;
}

/**
 * Solve a captcha using 2Captcha API.
 *
 * 1. Screenshot captcha element
 * 2. Send base64 image to 2Captcha
 * 3. Poll for result
 * 4. Return solved text
 *
 * Retries by refreshing captcha (clicking the image) if result isn't 4 digits.
 */
export async function solveCaptcha(
  page: Page,
  captchaSelector: string,
  maxRetries: number = 3,
  context?: CaptchaContext,
): Promise<string> {
  const apiKey = await get2CaptchaKey();
  if (!apiKey) {
    throw new Error('2Captcha API key not configured. Set "captcha_api_key" in Settings.');
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let captchaId: string | undefined;
    let balanceBefore: number | null = null;

    try {
      const captchaEl = await page.waitForSelector(captchaSelector, {
        state: 'visible',
        timeout: 10000,
      });

      if (!captchaEl) {
        throw new Error('Captcha element not found');
      }

      // Wait for captcha image to fully load (naturalWidth > 0)
      await page.waitForFunction(
        (sel) => {
          const img = document.querySelector(sel) as HTMLImageElement | null;
          return img && img.complete && img.naturalWidth > 0;
        },
        captchaSelector,
        { timeout: 10000 },
      );

      // Screenshot the captcha element → base64
      const rawBuffer = Buffer.from(await captchaEl.screenshot());
      const base64Image = rawBuffer.toString('base64');

      // Save debug image so we can check what 2Captcha sees
      try {
        const debugDir = path.join(__dirname, '../../../../data/captcha-debug');
        if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
        const debugPath = path.join(debugDir, `captcha-${Date.now()}-attempt${attempt}.png`);
        fs.writeFileSync(debugPath, rawBuffer);
        logger.info(`[CaptchaSolver] Debug image saved: ${debugPath}`);
      } catch {}

      // Snapshot balance before solve
      balanceBefore = await getBalance(apiKey);

      logger.info(`[CaptchaSolver] Attempt ${attempt}: Sending to 2Captcha... (balance: ${balanceBefore ?? 'unknown'})`);

      // Submit to 2Captcha
      captchaId = await submitTo2Captcha(apiKey, base64Image);
      logger.info(`[CaptchaSolver] 2Captcha request ID: ${captchaId}`);

      // Poll for result
      const result = await pollResult(apiKey, captchaId);
      logger.info(`[CaptchaSolver] 2Captcha result: "${result}"`);

      // Snapshot balance after solve
      const balanceAfter = await getBalance(apiKey);

      // Extract only digits
      const digits = result.replace(/\D/g, '');

      if (/^\d{4}$/.test(digits)) {
        logger.info(`[CaptchaSolver] Solved: ${digits}`);

        // Record successful usage
        if (balanceBefore !== null && balanceAfter !== null) {
          await recordCaptchaUsage({
            balanceBefore,
            balanceAfter,
            captchaId,
            result: digits,
            accountId: context?.accountId,
            provider: context?.provider,
            status: 'success',
          });
        }

        return digits;
      }

      // Invalid result — still costs money, record it
      if (balanceBefore !== null && balanceAfter !== null) {
        await recordCaptchaUsage({
          balanceBefore,
          balanceAfter,
          captchaId,
          result: digits || result,
          accountId: context?.accountId,
          provider: context?.provider,
          status: 'invalid',
        });
      }

      logger.warn(`[CaptchaSolver] Attempt ${attempt}: Invalid result "${digits}" (raw: "${result}"), refreshing captcha...`);

      // Refresh captcha by clicking image, then wait for new image to load
      if (attempt < maxRetries) {
        await captchaEl.click();
        await page.waitForTimeout(2000);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[CaptchaSolver] Attempt ${attempt} error: ${msg}`);

      // Record failed usage
      if (balanceBefore !== null) {
        const balanceAfter = await getBalance(apiKey);
        await recordCaptchaUsage({
          balanceBefore,
          balanceAfter: balanceAfter ?? balanceBefore,
          captchaId,
          result: msg,
          accountId: context?.accountId,
          provider: context?.provider,
          status: 'failed',
        });
      }

      if (attempt === maxRetries) {
        throw new Error(`Captcha solving failed after ${maxRetries} attempts: ${msg}`);
      }

      await page.waitForTimeout(1000);
    }
  }

  throw new Error(`Captcha solving failed after ${maxRetries} attempts`);
}

/**
 * Submit a base64 captcha image to 2Captcha.
 * Returns the captcha request ID.
 */
async function submitTo2Captcha(apiKey: string, base64Image: string): Promise<string> {
  const params = new URLSearchParams({
    key: apiKey,
    method: 'base64',
    body: base64Image,
    numeric: '1',     // digits only
    min_len: '4',
    max_len: '4',
    json: '1',
  });

  const res = await fetch(TWOCAPTCHA_IN, {
    method: 'POST',
    body: params,
  });

  const data = await res.json() as { status: number; request: string };

  if (data.status !== 1) {
    throw new Error(`2Captcha submit error: ${data.request}`);
  }

  return data.request; // captcha ID
}

/**
 * Poll 2Captcha for the result.
 * Waits up to 60 seconds with 5-second intervals.
 */
async function pollResult(apiKey: string, captchaId: string): Promise<string> {
  const maxWait = 60000;
  const interval = 5000;
  const start = Date.now();

  // Initial wait - 2Captcha recommends waiting 5s before first poll
  await new Promise(r => setTimeout(r, interval));

  while (Date.now() - start < maxWait) {
    const url = `${TWOCAPTCHA_RES}?key=${apiKey}&action=get&id=${captchaId}&json=1`;
    const res = await fetch(url);
    const data = await res.json() as { status: number; request: string };

    if (data.status === 1) {
      return data.request; // solved text
    }

    if (data.request !== 'CAPCHA_NOT_READY') {
      throw new Error(`2Captcha error: ${data.request}`);
    }

    // Not ready yet, wait and retry
    await new Promise(r => setTimeout(r, interval));
  }

  throw new Error('2Captcha timeout: result not ready after 60s');
}
