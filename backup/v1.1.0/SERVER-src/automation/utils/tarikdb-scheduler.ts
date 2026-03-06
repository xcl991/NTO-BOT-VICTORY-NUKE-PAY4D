import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import { contextManager } from '../browser/context-manager';
import { formatTarikDbResultMessage, waitForBotReady } from './telegram-listener';
import {
  getTelegramConfig,
  sendTelegramMessage,
  sendTelegramMessageToChat,
  sendTelegramDocumentToChat,
} from './telegram';
import type { TarikDbCheckResult } from '../flows/nuke-tarikdb-check-flow';

// Lazy import to avoid circular dependency
let _automationService: any = null;
async function getAutomationService() {
  if (!_automationService) {
    const mod = await import('../index');
    _automationService = mod.automationService;
  }
  return _automationService;
}

/**
 * TARIK DB Scheduler — Auto-check H+1 (yesterday) daily at a configurable time.
 * Settings stored in Setting table:
 *   - tarikdb.scheduler.enabled (boolean)
 *   - tarikdb.scheduler.time (string, "HH:MM")
 *   - tarikdb.scheduler.accountIds (json, number[])
 */
class TarikDbScheduler {
  private running = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastRunDate: string | null = null;
  private _isExecuting = false;

  start(): void {
    if (this.running) {
      logger.warn('[Scheduler] TARIK DB scheduler already running');
      return;
    }

    this.running = true;
    this.intervalId = setInterval(() => this.checkAndRun(), 60_000);
    logger.info('[Scheduler] TARIK DB scheduler started (60s interval)');

    const broadcast = (global as any).wsBroadcast;
    if (broadcast) {
      broadcast({
        type: 'BOT_LOG',
        data: { accountId: 0, provider: 'SYSTEM', message: 'TARIK DB scheduler started', level: 'success' },
      });
    }
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('[Scheduler] TARIK DB scheduler stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  isExecuting(): boolean {
    return this._isExecuting;
  }

  /** Manual trigger — ignores time check, but still requires enabled + accounts */
  async runNow(): Promise<void> {
    if (this._isExecuting) {
      logger.warn('[Scheduler] Already executing, skipping runNow');
      return;
    }
    await this.runScheduledCheck();
  }

  private async checkAndRun(): Promise<void> {
    if (this._isExecuting) return;

    try {
      // Check enabled
      const enabledSetting = await prisma.setting.findUnique({ where: { key: 'tarikdb.scheduler.enabled' } });
      if (enabledSetting?.value !== 'true') return;

      // Check time
      const timeSetting = await prisma.setting.findUnique({ where: { key: 'tarikdb.scheduler.time' } });
      const scheduledTime = timeSetting?.value || '08:00';

      const now = new Date();
      const currentHH = String(now.getHours()).padStart(2, '0');
      const currentMM = String(now.getMinutes()).padStart(2, '0');
      const currentTime = `${currentHH}:${currentMM}`;

      if (currentTime !== scheduledTime) return;

      // Check if already ran today
      const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
      if (this.lastRunDate === today) return;

      // Mark as ran today (prevent re-trigger within the same minute)
      this.lastRunDate = today;

      logger.info(`[Scheduler] Time match ${currentTime}, starting TARIK DB H+1 check...`);
      await this.runScheduledCheck();
    } catch (err) {
      logger.error(`[Scheduler] checkAndRun error: ${err}`);
    }
  }

  private async runScheduledCheck(): Promise<void> {
    this._isExecuting = true;
    const broadcast = (global as any).wsBroadcast;

    const onLog = (msg: string, level: string = 'info') => {
      logger.info(`[Scheduler] ${msg}`);
      if (broadcast) {
        broadcast({
          type: 'BOT_LOG',
          data: { accountId: 0, provider: 'SYSTEM', message: `[Scheduler] ${msg}`, level },
        });
      }
    };

    try {
      // Load account IDs
      const accountIdsSetting = await prisma.setting.findUnique({ where: { key: 'tarikdb.scheduler.accountIds' } });
      let accountIds: number[] = [];
      try {
        accountIds = JSON.parse(accountIdsSetting?.value || '[]');
      } catch { accountIds = []; }

      if (accountIds.length === 0) {
        onLog('No accounts configured for scheduler, skipping', 'warning');
        return;
      }

      // Calculate yesterday (H+1)
      const now = new Date();
      const yesterday = new Date(now.getTime() - 86400000);
      const dd = String(yesterday.getDate()).padStart(2, '0');
      const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
      const yyyy = yesterday.getFullYear();
      const dateStr = `${dd}-${mm}-${yyyy}`;

      onLog(`Starting H+1 check for ${accountIds.length} account(s), date: ${dateStr}`);

      // Get Telegram config for sending results
      const telegramConfig = await getTelegramConfig();
      const chatId = telegramConfig ? (
        await prisma.setting.findUnique({ where: { key: 'notification.telegramChatId' } })
      )?.value : null;

      const results: { accountName: string; count: number; success: boolean; error?: string }[] = [];

      // Process each account sequentially
      for (const accountId of accountIds) {
        const account = await prisma.account.findUnique({ where: { id: accountId } });

        if (!account || account.feature !== 'TARIKDB' || !account.isActive) {
          onLog(`Account #${accountId} not found, not TARIKDB, or inactive — skipping`, 'warning');
          results.push({ accountName: `#${accountId}`, count: 0, success: false, error: 'not found/inactive' });
          continue;
        }

        onLog(`Processing account "${account.name}" (#${accountId})...`);

        try {
          const automationService = await getAutomationService();

          // Start bot if not running
          const browserRunning = contextManager.isRunning(accountId);
          if (!browserRunning) {
            onLog(`Starting bot for "${account.name}"...`);
            await automationService.startBot(accountId);

            const loginOk = await waitForBotReady(accountId, onLog, 60000);
            if (!loginOk) {
              const freshAccount = await prisma.account.findUnique({ where: { id: accountId } });
              onLog(`Bot "${account.name}" failed to login (status: ${freshAccount?.status})`, 'error');
              results.push({ accountName: account.name, count: 0, success: false, error: `login failed: ${freshAccount?.status}` });
              continue;
            }
            onLog(`Bot "${account.name}" ready`);
          }

          // Run TARIK DB check
          const result: TarikDbCheckResult = await automationService.checkTarikDb(accountId, {
            dateStart: dateStr,
            dateEnd: dateStr,
            maxPages: 10,
          });

          onLog(`"${account.name}": ${result.rows.length} member(s) found`, 'success');

          // Send to Telegram if configured
          if (chatId) {
            const fakeCommand = { accountName: account.name, dateStart: dateStr, dateEnd: dateStr };
            const dateDisplay = `${dateStr} s/d ${dateStr}`;
            const msg = formatTarikDbResultMessage(
              result.rows,
              fakeCommand as any,
              dateDisplay,
              'Scheduler (H+1)',
              account.name,
              account.provider,
            );
            await sendTelegramMessageToChat(chatId, msg);

            // Export and send Excel
            if (result.success && result.rows.length > 0) {
              try {
                const excelPath = await automationService.exportTarikDbExcel(accountId);
                await sendTelegramDocumentToChat(
                  chatId,
                  excelPath,
                  `📎 TARIK DB Scheduler - ${account.name} (${account.provider}) - ${dateDisplay}`,
                );
              } catch (e) {
                onLog(`Excel export/send failed for "${account.name}": ${e}`, 'warning');
              }
            }
          }

          results.push({ accountName: account.name, count: result.rows.length, success: true });

          // Stop bot after processing
          try {
            await automationService.stopBot(accountId);
            onLog(`Browser closed for "${account.name}"`);
          } catch (e) {
            logger.warn(`[Scheduler] Failed to close browser for "${account.name}": ${e}`);
          }

        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          onLog(`Error processing "${account.name}": ${errMsg}`, 'error');
          results.push({ accountName: account.name, count: 0, success: false, error: errMsg });

          // Try to stop bot on error
          try {
            const automationService = await getAutomationService();
            await automationService.stopBot(accountId);
          } catch { /* ignore */ }
        }
      }

      // Save last run info
      const summary = results.map(r =>
        r.success ? `✅ ${r.accountName}: ${r.count} member(s)` : `❌ ${r.accountName}: ${r.error}`
      ).join('\n');

      const lastRunData = JSON.stringify({
        timestamp: new Date().toISOString(),
        date: dateStr,
        results,
        summary,
      });

      await prisma.setting.upsert({
        where: { key: 'tarikdb.scheduler.lastRun' },
        update: { value: lastRunData },
        create: { key: 'tarikdb.scheduler.lastRun', value: lastRunData, type: 'json' },
      });

      onLog(`Scheduler complete: ${results.filter(r => r.success).length}/${results.length} accounts OK`, 'success');

      // Send summary to Telegram
      if (chatId) {
        let summaryMsg = `📋 <b>TARIK DB Scheduler (H+1) Summary</b>\n`;
        summaryMsg += `Tanggal: <b>${dateStr}</b>\n\n`;
        for (const r of results) {
          if (r.success) {
            summaryMsg += `✅ <b>${r.accountName}</b>: ${r.count} member(s)\n`;
          } else {
            summaryMsg += `❌ <b>${r.accountName}</b>: ${r.error}\n`;
          }
        }
        await sendTelegramMessageToChat(chatId, summaryMsg);
      }

    } catch (err) {
      logger.error(`[Scheduler] runScheduledCheck error: ${err}`);
      onLog(`Scheduler error: ${err}`, 'error');
    } finally {
      this._isExecuting = false;
    }
  }
}

export const tarikdbScheduler = new TarikDbScheduler();
