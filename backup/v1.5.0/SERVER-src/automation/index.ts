import type { Page } from 'playwright';
import { contextManager } from './browser/context-manager';
import { nukeLoginFlow, nukeSubmitOtp } from './flows/login-flow';
import { pay4dLoginFlow } from './flows/pay4d-login-flow';
import { victoryLoginFlow } from './flows/victory-login-flow';
import { nukeNtoCheckFlow, screenshotReportTable, type NtoCheckResult, type GameCategory } from './flows/nto-check-flow';
import { pay4dNtoCheckFlow, screenshotPay4dResults, type Pay4dGameCategory } from './flows/pay4d-nto-check-flow';
import { victoryNtoCheckFlow, screenshotVictoryResults, type VictoryGameCategory } from './flows/victory-nto-check-flow';
import { nukeTarikDbCheckFlow, type TarikDbCheckResult } from './flows/nuke-tarikdb-check-flow';
import { victoryTarikDbCheckFlow } from './flows/victory-tarikdb-check-flow';
import { NUKE_SELECTORS } from './selectors/nuke-selectors';
import { VICTORY_SELECTORS } from './selectors/victory-selectors';
import { exportNtoToExcel, exportTarikDbToExcel } from './utils/excel-export';
import { sendNtoReportToTelegram } from './utils/telegram';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import path from 'path';
import fs from 'fs';

type LogCallback = (msg: string, level?: string) => void;

/**
 * Check if the browser has a valid saved session by navigating to the panel
 * and seeing if we land on dashboard (not login page).
 */
async function checkExistingSession(
  page: Page,
  panelUrl: string,
  onLog: LogCallback,
  provider?: string,
): Promise<boolean> {
  try {
    onLog('Checking saved session...');
    await page.goto(panelUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    const currentUrl = page.url();

    // If redirected to login page, session is invalid
    if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
      onLog('Saved session expired, need to login');
      return false;
    }

    // Provider-specific dashboard detection
    if (provider === 'VICTORY') {
      const hasAppBar = await page.$(VICTORY_SELECTORS.dashboard.appBar);
      const hasDrawer = await page.$(VICTORY_SELECTORS.dashboard.drawer);
      if (hasAppBar || hasDrawer) return true;
    } else {
      const hasSidebar = await page.$(NUKE_SELECTORS.dashboard.sidebar);
      if (currentUrl.includes('/dashboard') || currentUrl.includes('/home') || currentUrl.includes('/mimin/adminarea') || hasSidebar) {
        return true;
      }
    }

    // Not on login page = probably logged in
    if (!currentUrl.includes('/login')) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function createBroadcastLog(accountId: number, provider: string): LogCallback {
  const broadcast = (global as any).wsBroadcast;
  return (msg: string, level: string = 'info') => {
    logger.info(`[${provider}] Account #${accountId}: ${msg}`);
    if (broadcast) {
      broadcast({ type: 'BOT_LOG', data: { accountId, provider, message: msg, level } });
    }
  };
}

async function updateAccountStatus(accountId: number, status: string, extra?: { lastError?: string; lastNto?: string }) {
  await prisma.account.update({ where: { id: accountId }, data: { status, ...extra } });
  const broadcast = (global as any).wsBroadcast;
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (broadcast && account) {
    broadcast({ type: 'BOT_STATUS', data: { accountId, provider: account.provider, status, name: account.name } });
  }
}

export class AutomationService {
  /**
   * Start bot for a single account - launches browser and runs login flow
   */
  async startBot(accountId: number): Promise<void> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('Account not found');

    const onLog = createBroadcastLog(accountId, account.provider);

    try {
      // Update status to starting
      await updateAccountStatus(accountId, 'starting');
      await prisma.botSession.create({ data: { accountId, provider: account.provider, status: 'starting' } });
      await prisma.activityLog.create({
        data: { action: 'bot_started', provider: account.provider, accountId, details: `Bot started for "${account.name}"`, status: 'success' },
      });

      // Read browser settings from database
      const headlessSetting = await prisma.setting.findUnique({ where: { key: 'browser.headless' } });
      const slowMoSetting = await prisma.setting.findUnique({ where: { key: 'browser.slowMo' } });
      const headless = headlessSetting?.value === 'true';
      const slowMo = slowMoSetting ? Number(slowMoSetting.value) : 100;

      // Launch browser
      onLog(`Launching browser (headless: ${headless})...`);
      const instance = await contextManager.launch(accountId, account.provider, {
        headless,
        slowMo,
      });

      // Check if session is still valid for NUKE (saved profile)
      // PAY4D & VICTORY always fresh login
      await updateAccountStatus(accountId, 'logging_in');
      let isLoggedIn = false;

      if (account.provider === 'NUKE') {
        onLog('Checking saved session...');
        try {
          const baseUrl = account.panelUrl.replace(/\/+$/, '');
          await instance.page.goto(`${baseUrl}/homepage`, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await instance.page.waitForTimeout(3000);
          const currentUrl = instance.page.url();
          // If still on /homepage, session is valid
          if (currentUrl.includes('/homepage')) {
            isLoggedIn = true;
            onLog('Session still valid! Skipping login.', 'success');
          } else {
            onLog('Session expired, need to login');
          }
        } catch {
          onLog('Session check failed, will login');
        }
      }

      if (isLoggedIn) {
        await updateAccountStatus(accountId, 'running');
        onLog('Bot is now running!', 'success');
        return;
      }

      // No valid session - run full login flow
      onLog('No saved session, logging in...');
      let loginResult;
      switch (account.provider) {
        case 'NUKE':
          loginResult = await nukeLoginFlow(instance.page, account.panelUrl, account.username, account.password, onLog, account.twoFaSecret ?? undefined);
          break;
        case 'PAY4D':
          loginResult = await pay4dLoginFlow(
            instance.page, account.panelUrl,
            account.username, account.password,
            account.pinCode ?? '', onLog, account.id
          );
          break;
        case 'VICTORY':
          loginResult = await victoryLoginFlow(instance.page, account.panelUrl, account.username, account.password, onLog);
          break;
        default:
          throw new Error(`Unknown provider: ${account.provider}`);
      }

      // Handle login result
      if (!loginResult.success && !loginResult.needsOtp) {
        await updateAccountStatus(accountId, 'error', { lastError: loginResult.error });
        onLog(`Login failed: ${loginResult.error}`, 'error');
        return;
      }

      if (loginResult.needsOtp) {
        await updateAccountStatus(accountId, 'waiting_otp');
        onLog('Waiting for OTP input from user...', 'warning');
        return;
      }

      // Login successful
      await updateAccountStatus(accountId, 'running');
      onLog('Bot is now running!', 'success');

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onLog(`Bot error: ${msg}`, 'error');
      await updateAccountStatus(accountId, 'error', { lastError: msg });
      await contextManager.close(accountId);
    }
  }

  /**
   * Submit OTP for an account that's waiting
   */
  async submitOtp(accountId: number, otp: string): Promise<void> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('Account not found');

    const page = contextManager.getPage(accountId);
    if (!page) throw new Error('No browser running for this account');

    const onLog = createBroadcastLog(accountId, account.provider);

    const result = await nukeSubmitOtp(page, otp, onLog);

    if (result.success) {
      await updateAccountStatus(accountId, 'running');
      onLog('Bot is now running!', 'success');
    } else {
      await updateAccountStatus(accountId, 'error', { lastError: result.error });
      onLog(`OTP failed: ${result.error}`, 'error');
    }
  }

  /**
   * Stop bot for a single account
   */
  async stopBot(accountId: number): Promise<void> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    await contextManager.close(accountId);
    await updateAccountStatus(accountId, 'stopped');

    if (account) {
      await prisma.activityLog.create({
        data: { action: 'bot_stopped', provider: account.provider, accountId, details: `Bot stopped for "${account.name}"`, status: 'info' },
      });
      const onLog = createBroadcastLog(accountId, account.provider);
      onLog('Bot stopped');
    }
  }

  /**
   * Start all bots for a provider
   */
  async startAllBots(provider: string): Promise<number> {
    const accounts = await prisma.account.findMany({ where: { provider, isActive: true } });
    let count = 0;

    for (const acc of accounts) {
      try {
        // Stagger launches to avoid overwhelming the system
        if (count > 0) await new Promise(r => setTimeout(r, 2000));
        await this.startBot(acc.id);
        count++;
      } catch (e) {
        logger.error(`Failed to start bot for account #${acc.id}: ${e}`);
      }
    }

    await prisma.activityLog.create({
      data: { action: 'bot_start_all', provider, details: `Started ${count}/${accounts.length} bots for ${provider}`, status: 'success' },
    });

    return count;
  }

  /**
   * Stop all bots for a provider
   */
  async stopAllBots(provider: string): Promise<number> {
    const accounts = await prisma.account.findMany({
      where: { provider, status: { notIn: ['idle', 'stopped'] } },
    });

    for (const acc of accounts) {
      await this.stopBot(acc.id);
    }

    await prisma.activityLog.create({
      data: { action: 'bot_stop_all', provider, details: `Stopped ${accounts.length} bots for ${provider}`, status: 'warning' },
    });

    return accounts.length;
  }

  /**
   * Take screenshot for debugging
   */
  async screenshot(accountId: number): Promise<string | null> {
    return contextManager.screenshot(accountId);
  }

  /**
   * Run NTO check for an account.
   * Navigates to report page (dates via URL), selects game filter,
   * then checks each username sequentially (clear → fill → filter → scrape).
   */
  async checkNto(accountId: number, options: {
    dateStart: string;        // DD-MM-YYYY
    dateEnd: string;          // DD-MM-YYYY
    usernames: string[];      // usernames to check
    gameCategory: GameCategory | Pay4dGameCategory | VictoryGameCategory;
    maxPages?: number;
  }): Promise<NtoCheckResult> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('Account not found');

    const page = contextManager.getPage(accountId);
    if (!page) throw new Error('No browser running for this account. Start the bot first.');

    const onLog = createBroadcastLog(accountId, account.provider);

    try {
      await updateAccountStatus(accountId, 'checking_nto');
      onLog('Starting NTO check...');

      let result: NtoCheckResult;

      if (account.provider === 'PAY4D') {
        result = await pay4dNtoCheckFlow(page, account.panelUrl, onLog, {
          dateStart: options.dateStart,
          dateEnd: options.dateEnd,
          gameCategory: options.gameCategory as Pay4dGameCategory,
        });
      } else if (account.provider === 'VICTORY') {
        result = await victoryNtoCheckFlow(page, account.panelUrl, onLog, {
          dateStart: options.dateStart,
          dateEnd: options.dateEnd,
          usernames: options.usernames,
          gameCategory: (options.gameCategory as VictoryGameCategory) || 'SLOT',
          maxPages: options.maxPages,
        });
      } else {
        result = await nukeNtoCheckFlow(page, account.panelUrl, onLog, {
          dateStart: options.dateStart,
          dateEnd: options.dateEnd,
          usernames: options.usernames,
          gameCategory: options.gameCategory as GameCategory,
          maxPages: options.maxPages,
          twoFaSecret: account.twoFaSecret || undefined,
        });
      }

      if (result.success) {
        // Save to database
        await prisma.ntoResult.create({
          data: {
            accountId,
            provider: account.provider,
            value: `${options.gameCategory} ${options.usernames.join(',')} (${result.rows.length} rows)`,
            rawData: JSON.stringify({ rows: result.rows, totalItems: result.totalItems, options }),
          },
        });

        const ntoSummary = `${result.rows.length} rows (${options.gameCategory})`;
        await updateAccountStatus(accountId, 'running', { lastNto: ntoSummary });
        onLog(`NTO check saved: ${ntoSummary}`, 'success');
      } else {
        await updateAccountStatus(accountId, 'running', { lastError: result.error });
        onLog(`NTO check failed: ${result.error}`, 'error');
      }

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onLog(`NTO check error: ${msg}`, 'error');
      await updateAccountStatus(accountId, 'running', { lastError: msg });
      return { success: false, rows: [], error: msg };
    }
  }

  /**
   * Export NTO results to Excel file
   */
  async exportNtoExcel(accountId: number, ntoResultId?: number): Promise<string> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('Account not found');

    // Get the latest NTO result or specific one
    const where = ntoResultId ? { id: ntoResultId } : { accountId };
    const ntoResult = await prisma.ntoResult.findFirst({
      where,
      orderBy: { checkedAt: 'desc' },
    });

    if (!ntoResult || !ntoResult.rawData) {
      throw new Error('No NTO data found. Run NTO check first.');
    }

    const data = JSON.parse(ntoResult.rawData);
    const filePath = await exportNtoToExcel(data.rows, {
      summary: data.summary,
      accountName: account.name,
      provider: account.provider,
      dateRange: ntoResult.checkedAt.toISOString().split('T')[0],
    });

    return filePath;
  }

  /**
   * Run TARIK DB check for an account (NUKE or VICTORY).
   * NUKE: navigates to member management page and scrapes member data.
   * VICTORY: navigates to /player/contact-data and scrapes contact data.
   */
  async checkTarikDb(accountId: number, options: {
    dateStart?: string;
    dateEnd?: string;
    username?: string;
    usernames?: string[];
    maxPages?: number;
  }): Promise<TarikDbCheckResult> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('Account not found');

    const page = contextManager.getPage(accountId);
    if (!page) throw new Error('No browser running for this account. Start the bot first.');

    const onLog = createBroadcastLog(accountId, account.provider);

    try {
      await updateAccountStatus(accountId, 'checking_nto');
      onLog('Starting TARIK DB check...');

      let result: TarikDbCheckResult;

      if (account.provider === 'VICTORY') {
        result = await victoryTarikDbCheckFlow(page, account.panelUrl, onLog, options);
      } else {
        result = await nukeTarikDbCheckFlow(page, account.panelUrl, onLog, {
          ...options,
          twoFaSecret: account.twoFaSecret || undefined,
        });
      }

      if (result.success) {
        await prisma.ntoResult.create({
          data: {
            accountId,
            provider: account.provider,
            value: `TARIKDB ${options.usernames?.join(',') || options.username || 'ALL'} (${result.rows.length} rows)`,
            rawData: JSON.stringify({ type: 'tarikdb', rows: result.rows, totalItems: result.totalItems, options }),
          },
        });

        const summary = `TARIKDB: ${result.rows.length} member(s)`;
        await updateAccountStatus(accountId, 'running', { lastNto: summary });
        onLog(`TARIK DB saved: ${summary}`, 'success');
      } else {
        await updateAccountStatus(accountId, 'running', { lastError: result.error });
        onLog(`TARIK DB failed: ${result.error}`, 'error');
      }

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onLog(`TARIK DB error: ${msg}`, 'error');
      await updateAccountStatus(accountId, 'running', { lastError: msg });
      return { success: false, rows: [], error: msg };
    }
  }

  /**
   * Export TARIK DB results to Excel file
   */
  async exportTarikDbExcel(accountId: number, ntoResultId?: number): Promise<string> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('Account not found');

    const where = ntoResultId ? { id: ntoResultId } : { accountId };
    const ntoResult = await prisma.ntoResult.findFirst({
      where,
      orderBy: { checkedAt: 'desc' },
    });

    if (!ntoResult || !ntoResult.rawData) {
      throw new Error('No TARIK DB data found. Run TARIK DB check first.');
    }

    const data = JSON.parse(ntoResult.rawData);
    const filePath = await exportTarikDbToExcel(data.rows, {
      accountName: account.name,
      provider: account.provider,
      dateRange: data.options?.dateStart && data.options?.dateEnd
        ? `${data.options.dateStart} s/d ${data.options.dateEnd}`
        : ntoResult.checkedAt.toISOString().split('T')[0],
    });

    return filePath;
  }

  /**
   * Send NTO report to Telegram
   */
  async sendNtoTelegram(accountId: number, ntoResultId?: number): Promise<boolean> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('Account not found');

    const onLog = createBroadcastLog(accountId, account.provider);

    // Get the latest NTO result
    const where = ntoResultId ? { id: ntoResultId } : { accountId };
    const ntoResult = await prisma.ntoResult.findFirst({
      where,
      orderBy: { checkedAt: 'desc' },
    });

    if (!ntoResult || !ntoResult.rawData) {
      throw new Error('No NTO data found. Run NTO check first.');
    }

    const data = JSON.parse(ntoResult.rawData);
    const dateRange = ntoResult.checkedAt.toISOString().split('T')[0];

    onLog('Exporting to Excel for Telegram...');
    let excelPath: string | undefined;
    try {
      excelPath = await exportNtoToExcel(data.rows, {
        summary: data.summary,
        accountName: account.name,
        provider: account.provider,
        dateRange,
      });
    } catch (e) {
      onLog(`Excel export failed: ${e}`, 'warning');
    }

    // Take screenshot if browser is running
    let screenshotPath: string | undefined;
    const page = contextManager.getPage(accountId);
    if (page) {
      try {
        const ssDir = path.join(__dirname, '../../../data/screenshots');
        if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
        screenshotPath = path.join(ssDir, `nto-${accountId}-${Date.now()}.png`);
        if (account.provider === 'PAY4D') {
          await screenshotPay4dResults(page, screenshotPath);
        } else if (account.provider === 'VICTORY') {
          await screenshotVictoryResults(page, screenshotPath);
        } else {
          await screenshotReportTable(page, screenshotPath);
        }
        onLog('Screenshot captured for Telegram');
      } catch (e) {
        onLog(`Screenshot failed: ${e}`, 'warning');
      }
    }

    onLog('Sending to Telegram...');
    const sent = await sendNtoReportToTelegram(data.rows, excelPath, screenshotPath, {
      provider: account.provider,
      accountName: account.name,
      dateRange,
      summary: data.summary,
    });

    if (sent) {
      onLog('NTO report sent to Telegram!', 'success');
    } else {
      onLog('Failed to send to Telegram. Check bot token and chat ID in settings.', 'error');
    }

    return sent;
  }
}

export const automationService = new AutomationService();
