import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import { contextManager } from '../browser/context-manager';
import { waitForBotReady } from './telegram-listener';
import type { SummaryPerformanceResult } from '../flows/nuke-summary-performance-flow';
import type { VictorySPResult } from '../flows/victory-summary-performance-flow';
import type { Pay4dSPResult } from '../flows/pay4d-summary-performance-flow';
import { sendTelegramPhotoBufferToChat } from './telegram';

// Lazy import to avoid circular dependency
let _automationService: any = null;
async function getAutomationService() {
  if (!_automationService) {
    const mod = await import('../index');
    _automationService = mod.automationService;
  }
  return _automationService;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatIDR(num: number): string {
  if (num === 0) return '0';
  return num.toLocaleString('id-ID');
}

/**
 * Unified row result for the combined horizontal report.
 */
export interface SPAccountResult {
  provider: string;
  accountName: string;
  yesterdayDpCount: number;
  todayDpCount: number;
  yesterdayDpAmount: number;
  todayDpAmount: number;
  yesterdayNto: number;   // NTO for NUKE, Valid Bet for VICTORY, Bet for PAY4D
  todayNto: number;
  error?: string;
}

/**
 * Unified Summary Performance Scheduler.
 *
 * Runs all configured providers (NUKE, VICTORY, PAY4D) in a single cycle,
 * collects results, renders one combined horizontal PNG, sends to Telegram.
 *
 * Settings:
 *   - summaryperformance.scheduler.enabled (boolean)
 *   - summaryperformance.scheduler.interval (number, minutes)
 *   - summaryperformance.scheduler.lastRun (json)
 *   - summaryperformance.nuke.scheduler.accountIds (json, number[])
 *   - summaryperformance.victory.scheduler.accountIds (json, number[])
 *   - summaryperformance.pay4d.scheduler.accountIds (json, number[])
 *
 * Telegram: notification.telegramBotToken + notification.telegramChatIdSummaryPerformance
 */
class UnifiedSPScheduler {
  private running = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _isExecuting = false;
  private lastRunTime = 0;

  start(): void {
    if (this.running) {
      logger.warn('[SP] Scheduler already running');
      return;
    }
    this.running = true;
    this.intervalId = setInterval(() => this.checkAndRun(), 60_000);
    logger.info('[SP] Unified scheduler started (60s check interval)');

    const broadcast = (global as any).wsBroadcast;
    if (broadcast) {
      broadcast({
        type: 'BOT_LOG',
        data: { accountId: 0, provider: 'SYSTEM', message: 'Summary Performance scheduler started', level: 'success' },
      });
    }
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('[SP] Unified scheduler stopped');
  }

  isRunning(): boolean { return this.running; }
  isExecuting(): boolean { return this._isExecuting; }

  async runNow(): Promise<void> {
    if (this._isExecuting) {
      logger.warn('[SP] Already executing, skipping runNow');
      return;
    }
    await this.runReport();
  }

  private async checkAndRun(): Promise<void> {
    if (this._isExecuting) return;

    try {
      const enabledSetting = await prisma.setting.findUnique({ where: { key: 'summaryperformance.scheduler.enabled' } });
      if (enabledSetting?.value !== 'true') return;

      const intervalSetting = await prisma.setting.findUnique({ where: { key: 'summaryperformance.scheduler.interval' } });
      const intervalMinutes = parseInt(intervalSetting?.value || '60', 10) || 60;
      const intervalMs = intervalMinutes * 60 * 1000;

      if (Date.now() - this.lastRunTime >= intervalMs) {
        this.lastRunTime = Date.now();
        logger.info(`[SP] Interval ${intervalMinutes}min reached, running...`);
        await this.runReport();
      }
    } catch (err) {
      logger.error(`[SP] checkAndRun error: ${err}`);
    }
  }

  private async runReport(): Promise<void> {
    this._isExecuting = true;
    const broadcast = (global as any).wsBroadcast;

    const onLog = (msg: string, level: string = 'info') => {
      logger.info(`[SP] ${msg}`);
      if (broadcast) {
        broadcast({
          type: 'BOT_LOG',
          data: { accountId: 0, provider: 'SYSTEM', message: `[SP] ${msg}`, level },
        });
      }
    };

    try {
      // Load Telegram config
      const botTokenSetting = await prisma.setting.findUnique({ where: { key: 'notification.telegramBotToken' } });
      const chatIdSetting = await prisma.setting.findUnique({ where: { key: 'notification.telegramChatIdSummaryPerformance' } });
      const botToken = botTokenSetting?.value || '';
      const chatId = chatIdSetting?.value || '';

      if (!botToken || !chatId) {
        onLog('No Telegram Bot Token or Chat ID configured', 'warning');
        return;
      }

      // Load account IDs per provider
      const nukeIdsSetting = await prisma.setting.findUnique({ where: { key: 'summaryperformance.nuke.scheduler.accountIds' } });
      const vicIdsSetting = await prisma.setting.findUnique({ where: { key: 'summaryperformance.victory.scheduler.accountIds' } });
      const pay4dIdsSetting = await prisma.setting.findUnique({ where: { key: 'summaryperformance.pay4d.scheduler.accountIds' } });

      let nukeIds: number[] = [];
      let vicIds: number[] = [];
      let pay4dIds: number[] = [];
      try { nukeIds = JSON.parse(nukeIdsSetting?.value || '[]'); } catch { nukeIds = []; }
      try { vicIds = JSON.parse(vicIdsSetting?.value || '[]'); } catch { vicIds = []; }
      try { pay4dIds = JSON.parse(pay4dIdsSetting?.value || '[]'); } catch { pay4dIds = []; }

      const totalAccounts = nukeIds.length + vicIds.length + pay4dIds.length;
      if (totalAccounts === 0) {
        onLog('No accounts configured for any provider', 'warning');
        return;
      }

      const allIds = [...nukeIds, ...vicIds, ...pay4dIds];
      onLog(`Starting Summary Performance: ${nukeIds.length} NUKE, ${vicIds.length} VICTORY, ${pay4dIds.length} PAY4D (${allIds.length} total)`);
      const automationService = await getAutomationService();

      const allResults: SPAccountResult[] = [];

      // Helper: process one account → scrape → stop bot immediately (saves RAM)
      // The last account is kept open for PNG rendering, then stopped after.
      const processAndStop = async (
        accountId: number,
        isLast: boolean,
        processFn: (id: number, svc: any, log: typeof onLog) => Promise<SPAccountResult | null>,
      ): Promise<{ page: any; accountId: number } | null> => {
        const result = await processFn(accountId, automationService, onLog);
        if (result) allResults.push(result);

        if (isLast && contextManager.isRunning(accountId)) {
          // Keep last account's browser open for PNG rendering
          const page = contextManager.getPage(accountId);
          if (page) return { page, accountId };
        }

        // Stop bot immediately to free RAM
        try {
          if (contextManager.isRunning(accountId)) {
            await automationService.stopBot(accountId);
            onLog(`Stopped bot #${accountId} (freeing RAM)`);
          }
        } catch { /* ignore */ }
        return null;
      };

      let lastPage: any = null;

      // Process all accounts sequentially — stop each bot right after scraping
      for (let i = 0; i < allIds.length; i++) {
        const accountId = allIds[i];
        const isLast = i === allIds.length - 1;

        // Route to correct processor by checking which provider list contains this ID
        let processFn: (id: number, svc: any, log: typeof onLog) => Promise<SPAccountResult | null>;
        if (nukeIds.includes(accountId)) {
          processFn = this.processNukeAccount.bind(this);
        } else if (vicIds.includes(accountId)) {
          processFn = this.processVictoryAccount.bind(this);
        } else {
          processFn = this.processPay4dAccount.bind(this);
        }

        const kept = await processAndStop(accountId, isLast, processFn);
        if (kept) lastPage = kept;
      }

      // Render combined horizontal report using last account's browser
      if (allResults.length > 0 && lastPage) {
        onLog(`Rendering combined report (${allResults.length} accounts)...`);
        const html = buildCombinedSPReportHtml(allResults);
        const { page, accountId: lastAccountId } = lastPage;

        await page.setContent(html, { waitUntil: 'load' });
        await page.waitForTimeout(500);
        const container = await page.$('#report-container');
        const pngBuffer = container
          ? await container.screenshot({ type: 'png' })
          : await page.screenshot({ type: 'png', fullPage: true });

        onLog('Sending combined PNG to Telegram...');
        const sent = await sendTelegramPhotoBufferToChat(
          chatId, pngBuffer,
          `📊 Summary Performance — ${allResults.length} account(s)`,
          `sp_combined_${Date.now()}.png`, botToken,
        );
        if (sent) {
          onLog('Combined SP report sent to Telegram!', 'success');
        } else {
          onLog('Failed to send combined PNG to Telegram', 'error');
        }

        // Now stop the last bot too
        try {
          if (contextManager.isRunning(lastAccountId)) {
            await automationService.stopBot(lastAccountId);
          }
        } catch { /* ignore */ }
      } else if (allResults.length > 0) {
        // No browser page available — send text fallback
        onLog('No browser page for PNG rendering, sending text summary...', 'warning');
        const { sendTelegramMessageToChat } = await import('./telegram');
        const textMsg = buildTextFallback(allResults);
        await sendTelegramMessageToChat(chatId, textMsg, undefined, botToken);
      }

      // Save last run info
      const now = new Date();
      const today = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
      const lastRunData = JSON.stringify({
        timestamp: now.toISOString(),
        date: today,
        accountCount: totalAccounts,
        resultCount: allResults.length,
      });

      await prisma.setting.upsert({
        where: { key: 'summaryperformance.scheduler.lastRun' },
        update: { value: lastRunData },
        create: { key: 'summaryperformance.scheduler.lastRun', value: lastRunData, type: 'json' },
      });

      onLog('Summary Performance cycle complete', 'success');

    } catch (err) {
      logger.error(`[SP] runReport error: ${err}`);
      onLog(`Error: ${err}`, 'error');
    } finally {
      this._isExecuting = false;
    }
  }

  /**
   * Process a single NUKE account — scrape /report/summary-performance
   */
  private async processNukeAccount(
    accountId: number,
    automationService: any,
    onLog: (msg: string, level?: string) => void,
  ): Promise<SPAccountResult | null> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || !account.isActive || account.provider !== 'NUKE') {
      onLog(`Account #${accountId} not valid for NUKE — skipping`, 'warning');
      return null;
    }

    onLog(`[NUKE] Processing "${account.name}"...`);

    try {
      if (!contextManager.isRunning(accountId)) {
        onLog(`[NUKE] Starting bot for "${account.name}"...`);
        await automationService.startBot(accountId);
        const loginOk = await waitForBotReady(accountId, onLog, 60000);
        if (!loginOk) {
          onLog(`[NUKE] Bot "${account.name}" failed to login`, 'error');
          return { provider: 'NUKE', accountName: account.name, yesterdayDpCount: 0, todayDpCount: 0, yesterdayDpAmount: 0, todayDpAmount: 0, yesterdayNto: 0, todayNto: 0, error: 'Login failed' };
        }
      }

      const result: SummaryPerformanceResult = await automationService.checkSummaryPerformance(accountId);

      if (result.success) {
        onLog(`[NUKE] "${account.name}" scraped successfully`, 'success');
        return {
          provider: 'NUKE',
          accountName: account.name,
          yesterdayDpCount: result.yesterday?.overallDpCount ?? 0,
          todayDpCount: result.today?.overallDpCount ?? 0,
          yesterdayDpAmount: result.yesterday?.overallDpAmount ?? 0,
          todayDpAmount: result.today?.overallDpAmount ?? 0,
          yesterdayNto: result.yesterday?.nto ?? 0,
          todayNto: result.today?.nto ?? 0,
        };
      } else {
        onLog(`[NUKE] "${account.name}" failed: ${result.error}`, 'error');
        return { provider: 'NUKE', accountName: account.name, yesterdayDpCount: 0, todayDpCount: 0, yesterdayDpAmount: 0, todayDpAmount: 0, yesterdayNto: 0, todayNto: 0, error: result.error };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog(`[NUKE] "${account.name}" error: ${msg}`, 'error');
      return { provider: 'NUKE', accountName: account.name, yesterdayDpCount: 0, todayDpCount: 0, yesterdayDpAmount: 0, todayDpAmount: 0, yesterdayNto: 0, todayNto: 0, error: msg };
    }
  }

  /**
   * Process a single VICTORY account — scrape /report/report-profit-loss/by-company
   */
  private async processVictoryAccount(
    accountId: number,
    automationService: any,
    onLog: (msg: string, level?: string) => void,
  ): Promise<SPAccountResult | null> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || !account.isActive || account.provider !== 'VICTORY') {
      onLog(`Account #${accountId} not valid for VICTORY — skipping`, 'warning');
      return null;
    }

    onLog(`[VICTORY] Processing "${account.name}"...`);

    try {
      if (!contextManager.isRunning(accountId)) {
        onLog(`[VICTORY] Starting bot for "${account.name}"...`);
        await automationService.startBot(accountId);
        const loginOk = await waitForBotReady(accountId, onLog, 60000);
        if (!loginOk) {
          onLog(`[VICTORY] Bot "${account.name}" failed to login`, 'error');
          return { provider: 'VICTORY', accountName: account.name, yesterdayDpCount: 0, todayDpCount: 0, yesterdayDpAmount: 0, todayDpAmount: 0, yesterdayNto: 0, todayNto: 0, error: 'Login failed' };
        }
      }

      const result: VictorySPResult = await automationService.checkVictorySummaryPerformance(accountId);

      if (result.success) {
        onLog(`[VICTORY] "${account.name}" scraped successfully`, 'success');
        return {
          provider: 'VICTORY',
          accountName: account.name,
          yesterdayDpCount: result.yesterday?.dpCount ?? 0,
          todayDpCount: result.today?.dpCount ?? 0,
          yesterdayDpAmount: result.yesterday?.dpAmount ?? 0,
          todayDpAmount: result.today?.dpAmount ?? 0,
          yesterdayNto: result.yesterday?.validBet ?? 0,
          todayNto: result.today?.validBet ?? 0,
        };
      } else {
        onLog(`[VICTORY] "${account.name}" failed: ${result.error}`, 'error');
        return { provider: 'VICTORY', accountName: account.name, yesterdayDpCount: 0, todayDpCount: 0, yesterdayDpAmount: 0, todayDpAmount: 0, yesterdayNto: 0, todayNto: 0, error: result.error };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog(`[VICTORY] "${account.name}" error: ${msg}`, 'error');
      return { provider: 'VICTORY', accountName: account.name, yesterdayDpCount: 0, todayDpCount: 0, yesterdayDpAmount: 0, todayDpAmount: 0, yesterdayNto: 0, todayNto: 0, error: msg };
    }
  }

  /**
   * Process a single PAY4D account — dedicated Performance Review page scraping
   */
  private async processPay4dAccount(
    accountId: number,
    automationService: any,
    onLog: (msg: string, level?: string) => void,
  ): Promise<SPAccountResult | null> {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || !account.isActive || account.provider !== 'PAY4D') {
      onLog(`Account #${accountId} not valid for PAY4D — skipping`, 'warning');
      return null;
    }

    onLog(`[PAY4D] Processing "${account.name}"...`);

    try {
      if (!contextManager.isRunning(accountId)) {
        onLog(`[PAY4D] Starting bot for "${account.name}"...`);
        await automationService.startBot(accountId);
        const loginOk = await waitForBotReady(accountId, onLog, 60000);
        if (!loginOk) {
          onLog(`[PAY4D] Bot "${account.name}" failed to login`, 'error');
          return { provider: 'PAY4D', accountName: account.name, yesterdayDpCount: 0, todayDpCount: 0, yesterdayDpAmount: 0, todayDpAmount: 0, yesterdayNto: 0, todayNto: 0, error: 'Login failed' };
        }
      }

      const result: Pay4dSPResult = await automationService.checkPay4dSummaryPerformance(accountId);

      if (result.success) {
        onLog(`[PAY4D] "${account.name}" scraped successfully`, 'success');
        return {
          provider: 'PAY4D',
          accountName: account.name,
          yesterdayDpCount: result.yesterday?.dpCount ?? 0,
          todayDpCount: result.today?.dpCount ?? 0,
          yesterdayDpAmount: result.yesterday?.dpAmount ?? 0,
          todayDpAmount: result.today?.dpAmount ?? 0,
          yesterdayNto: result.yesterday?.nto ?? 0,
          todayNto: result.today?.nto ?? 0,
        };
      } else {
        onLog(`[PAY4D] "${account.name}" failed: ${result.error}`, 'error');
        return { provider: 'PAY4D', accountName: account.name, yesterdayDpCount: 0, todayDpCount: 0, yesterdayDpAmount: 0, todayDpAmount: 0, yesterdayNto: 0, todayNto: 0, error: result.error };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog(`[PAY4D] "${account.name}" error: ${msg}`, 'error');
      return { provider: 'PAY4D', accountName: account.name, yesterdayDpCount: 0, todayDpCount: 0, yesterdayDpAmount: 0, todayDpAmount: 0, yesterdayNto: 0, todayNto: 0, error: msg };
    }
  }
}

/**
 * Build combined horizontal HTML report.
 * 1 row per account, columns: Provider | Account | DP Count (Kmrn/Ini) | DP Amount (Kmrn/Ini) | NTO (Kmrn/Ini)
 */
export function buildCombinedSPReportHtml(results: SPAccountResult[]): string {
  const now = new Date();
  const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const providerColors: Record<string, string> = {
    NUKE: '#FEE2E2',
    VICTORY: '#FEF3C7',
    PAY4D: '#DCFCE7',
  };

  const providerTextColors: Record<string, string> = {
    NUKE: '#991B1B',
    VICTORY: '#92400E',
    PAY4D: '#166534',
  };

  const diffHtml = (today: number, yesterday: number): string => {
    const diff = today - yesterday;
    if (diff === 0) return '';
    const arrow = diff > 0 ? '▲' : '▼';
    const color = diff > 0 ? '#059669' : '#DC2626';
    const sign = diff > 0 ? '+' : '';
    return `<div style="font-size:10px;color:${color};font-weight:600;">${arrow} ${sign}${formatIDR(diff)}</div>`;
  };

  let rows = '';
  let totYDpCount = 0, totTDpCount = 0, totYDpAmt = 0, totTDpAmt = 0, totYNto = 0, totTNto = 0;

  for (const r of results) {
    const bg = providerColors[r.provider] || '#F9FAFB';
    const textColor = providerTextColors[r.provider] || '#374151';

    if (r.error) {
      rows += `<tr style="background:${bg};">
        <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;font-weight:700;color:${textColor};text-align:center;">${r.provider}</td>
        <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;font-weight:600;">${escapeHtml(r.accountName)}</td>
        <td colspan="6" style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;color:#DC2626;text-align:center;">❌ ${escapeHtml(r.error)}</td>
      </tr>`;
      continue;
    }

    totYDpCount += r.yesterdayDpCount;
    totTDpCount += r.todayDpCount;
    totYDpAmt += r.yesterdayDpAmount;
    totTDpAmt += r.todayDpAmount;
    totYNto += r.yesterdayNto;
    totTNto += r.todayNto;

    rows += `<tr style="background:${bg};">
      <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;font-weight:700;color:${textColor};text-align:center;">${r.provider}</td>
      <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;font-weight:600;">${escapeHtml(r.accountName)}</td>
      <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(r.yesterdayDpCount)}</td>
      <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(r.todayDpCount)}${diffHtml(r.todayDpCount, r.yesterdayDpCount)}</td>
      <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(r.yesterdayDpAmount)}</td>
      <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(r.todayDpAmount)}${diffHtml(r.todayDpAmount, r.yesterdayDpAmount)}</td>
      <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(r.yesterdayNto)}</td>
      <td style="padding:6px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(r.todayNto)}${diffHtml(r.todayNto, r.yesterdayNto)}</td>
    </tr>`;
  }

  // Total row
  rows += `<tr style="background:#0F766E;color:#fff;font-weight:bold;">
    <td colspan="2" style="padding:8px 10px;border:1px solid #CBD5E1;font-size:13px;text-align:center;">TOTAL</td>
    <td style="padding:8px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(totYDpCount)}</td>
    <td style="padding:8px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(totTDpCount)}</td>
    <td style="padding:8px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(totYDpAmt)}</td>
    <td style="padding:8px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(totTDpAmt)}</td>
    <td style="padding:8px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(totYNto)}</td>
    <td style="padding:8px 10px;border:1px solid #CBD5E1;font-size:12px;text-align:right;">${formatIDR(totTNto)}</td>
  </tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background: #fff; }
  #report-container { padding: 20px; display: inline-block; min-width: 800px; }
  table { border-collapse: collapse; width: 100%; }
</style></head><body>
<div id="report-container">
  <div style="text-align:center;margin-bottom:14px;">
    <div style="font-size:18px;font-weight:bold;color:#1E3A5F;">SUMMARY PERFORMANCE</div>
    <div style="font-size:11px;color:#6B7280;margin-top:4px;">${escapeHtml(dateStr)}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="background:#1E3A5F;color:#fff;padding:8px 10px;border:1px solid #CBD5E1;font-size:11px;text-align:center;" rowspan="2">Provider</th>
        <th style="background:#1E3A5F;color:#fff;padding:8px 10px;border:1px solid #CBD5E1;font-size:11px;text-align:center;" rowspan="2">Account</th>
        <th style="background:#E0E7FF;padding:6px 8px;border:1px solid #CBD5E1;font-size:11px;text-align:center;" colspan="2">DP Count</th>
        <th style="background:#E0E7FF;padding:6px 8px;border:1px solid #CBD5E1;font-size:11px;text-align:center;" colspan="2">DP Amount</th>
        <th style="background:#E0E7FF;padding:6px 8px;border:1px solid #CBD5E1;font-size:11px;text-align:center;" colspan="2">NTO / Valid Bet</th>
      </tr>
      <tr>
        <th style="background:#F0F4FF;padding:5px 8px;border:1px solid #CBD5E1;font-size:10px;text-align:center;">Kemarin</th>
        <th style="background:#F0F4FF;padding:5px 8px;border:1px solid #CBD5E1;font-size:10px;text-align:center;">Hari Ini</th>
        <th style="background:#F0F4FF;padding:5px 8px;border:1px solid #CBD5E1;font-size:10px;text-align:center;">Kemarin</th>
        <th style="background:#F0F4FF;padding:5px 8px;border:1px solid #CBD5E1;font-size:10px;text-align:center;">Hari Ini</th>
        <th style="background:#F0F4FF;padding:5px 8px;border:1px solid #CBD5E1;font-size:10px;text-align:center;">Kemarin</th>
        <th style="background:#F0F4FF;padding:5px 8px;border:1px solid #CBD5E1;font-size:10px;text-align:center;">Hari Ini</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div></body></html>`;
}

/**
 * Text fallback when no browser page is available for PNG rendering.
 */
function buildTextFallback(results: SPAccountResult[]): string {
  const now = new Date();
  const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  let msg = `📊 <b>SUMMARY PERFORMANCE</b>\n📅 ${dateStr}\n\n`;

  for (const r of results) {
    if (r.error) {
      msg += `❌ <b>${r.provider} — ${r.accountName}</b>: ${r.error}\n`;
      continue;
    }
    msg += `<b>${r.provider} — ${r.accountName}</b>\n`;
    msg += `  DP Count: ${formatIDR(r.yesterdayDpCount)} → ${formatIDR(r.todayDpCount)}\n`;
    msg += `  DP Amount: ${formatIDR(r.yesterdayDpAmount)} → ${formatIDR(r.todayDpAmount)}\n`;
    msg += `  NTO/VB: ${formatIDR(r.yesterdayNto)} → ${formatIDR(r.todayNto)}\n\n`;
  }

  return msg;
}

export const unifiedSPScheduler = new UnifiedSPScheduler();
