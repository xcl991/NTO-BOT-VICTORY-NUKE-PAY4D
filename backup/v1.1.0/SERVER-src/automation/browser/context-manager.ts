import { chromium, type BrowserContext, type Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import logger from '../../utils/logger';

const PROFILES_DIR = path.join(__dirname, '../../../../profiles');

interface BrowserInstance {
  context: BrowserContext;
  page: Page;
  accountId: number;
  provider: string;
}

class ContextManager {
  private instances = new Map<number, BrowserInstance>();

  private getProfileDir(accountId: number): string {
    const dir = path.join(PROFILES_DIR, `account-${accountId}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async launch(accountId: number, provider: string, options?: { headless?: boolean; slowMo?: number }): Promise<BrowserInstance> {
    // Close existing if any
    await this.close(accountId);

    const profileDir = this.getProfileDir(accountId);
    const headless = options?.headless ?? false;
    const slowMo = options?.slowMo ?? 100;

    logger.info(`Launching browser for account #${accountId} (${provider})`, { headless, slowMo, profileDir });

    // Use launchPersistentContext to save cookies/session across restarts
    // channel: 'chrome' uses the system-installed Google Chrome instead of Playwright's
    // bundled Chromium. This eliminates TLS fingerprint (JA3/JA4) differences and
    // browser-level bot detection that distinguish Chromium from real Chrome.
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless,
      slowMo,
      viewport: { width: 1366, height: 768 },
      locale: 'id-ID',
      acceptDownloads: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
    });

    // Hide automation signals
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // Use existing page or create new one
    const page = context.pages()[0] || await context.newPage();

    // No need to override sec-ch-ua when using channel:'chrome' —
    // real Chrome generates correct headers automatically.

    const instance: BrowserInstance = { context, page, accountId, provider };
    this.instances.set(accountId, instance);

    logger.info(`Browser launched for account #${accountId} (persistent profile)`);
    return instance;
  }

  get(accountId: number): BrowserInstance | undefined {
    return this.instances.get(accountId);
  }

  getPage(accountId: number): Page | undefined {
    return this.instances.get(accountId)?.page;
  }

  async close(accountId: number): Promise<void> {
    const instance = this.instances.get(accountId);
    if (!instance) return;

    try {
      await instance.context.close();
      logger.info(`Browser closed for account #${accountId}`);
    } catch (e) {
      logger.warn(`Error closing browser for account #${accountId}: ${e}`);
    }
    this.instances.delete(accountId);
  }

  async closeAll(): Promise<void> {
    const ids = Array.from(this.instances.keys());
    for (const id of ids) await this.close(id);
    logger.info(`All browsers closed (${ids.length})`);
  }

  async screenshot(accountId: number, name?: string): Promise<string | null> {
    const page = this.getPage(accountId);
    if (!page) return null;

    const dir = path.join(__dirname, '../../../../data/screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${name || `account-${accountId}-${Date.now()}`}.png`);

    await page.screenshot({ path: filePath, fullPage: false });
    logger.debug(`Screenshot saved: ${filePath}`);
    return filePath;
  }

  isRunning(accountId: number): boolean {
    return this.instances.has(accountId);
  }

  getActiveCount(): number {
    return this.instances.size;
  }

  getActiveIds(): number[] {
    return Array.from(this.instances.keys());
  }
}

export const contextManager = new ContextManager();
