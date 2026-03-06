import type { Page } from 'playwright';
import logger from '../../utils/logger';

/**
 * Try multiple selectors until one is found
 */
export async function waitForAnySelector(
  page: Page,
  selectors: string[],
  options: { timeout?: number; state?: 'visible' | 'attached' } = {}
): Promise<string> {
  const timeout = options.timeout ?? 10000;
  const state = options.state ?? 'visible';

  // Race all selectors
  const result = await Promise.race([
    ...selectors.map(async (selector) => {
      try {
        await page.waitForSelector(selector, { timeout, state });
        return selector;
      } catch {
        return null;
      }
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout + 500)),
  ]);

  if (!result) {
    throw new Error(`None of the selectors found within ${timeout}ms: ${selectors.join(', ')}`);
  }
  return result;
}

/**
 * Click with fallback selectors
 */
export async function clickWithFallback(
  page: Page,
  primary: string,
  fallbacks: readonly string[],
  options?: { timeout?: number }
): Promise<void> {
  const allSelectors = [primary, ...fallbacks];
  for (const selector of allSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: options?.timeout ?? 5000, state: 'visible' });
      await page.click(selector);
      return;
    } catch {
      continue;
    }
  }
  throw new Error(`Could not click any of: ${allSelectors.join(', ')}`);
}

/**
 * Fill input with fallback selectors
 */
export async function fillWithFallback(
  page: Page,
  primary: string,
  fallbacks: readonly string[],
  value: string,
  options?: { timeout?: number }
): Promise<void> {
  const allSelectors = [primary, ...fallbacks];
  for (const selector of allSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: options?.timeout ?? 5000, state: 'visible' });
      await page.fill(selector, value);
      return;
    } catch {
      continue;
    }
  }
  throw new Error(`Could not fill any of: ${allSelectors.join(', ')}`);
}

/**
 * Retry an async operation with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelay?: number; label?: string } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelay ?? 1000;
  const label = options.label ?? 'operation';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.warn(`${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`, {
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`${label} failed after ${maxRetries} attempts`);
}
