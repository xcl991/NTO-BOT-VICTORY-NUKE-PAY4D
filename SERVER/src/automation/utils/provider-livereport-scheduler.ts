import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import { contextManager } from '../browser/context-manager';
import { waitForBotReady } from './telegram-listener';
import type { NtoCheckResult, NtoRow } from '../flows/nto-check-flow';

// Lazy import to avoid circular dependency
let _automationService: any = null;
async function getAutomationService() {
  if (!_automationService) {
    const mod = await import('../index');
    _automationService = mod.automationService;
  }
  return _automationService;
}

type GameCategory = 'SLOT' | 'CASINO' | 'SPORTS' | 'GAMES';

/**
 * Generic NTO Live Report Scheduler — per-provider instance.
 *
 * Settings stored in Setting table (prefixed by provider):
 *   - livereport.{provider}.scheduler.enabled (boolean)
 *   - livereport.{provider}.scheduler.interval (number, minutes, default 60)
 *   - livereport.{provider}.scheduler.accountIds (json, number[])
 *   - livereport.{provider}.scheduler.gameCategories (json, string[], default all)
 *   - livereport.{provider}.scheduler.lastRun (json)
 *
 * Uses shared Telegram config:
 *   - notification.telegramBotToken + notification.telegramChatId
 */
class ProviderLiveReportScheduler {
  private provider: string;
  private prefix: string;
  private running = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _isExecuting = false;
  private lastRunTime = 0;

  constructor(provider: string) {
    this.provider = provider;
    this.prefix = `livereport.${provider.toLowerCase()}.scheduler`;
  }

  start(): void {
    if (this.running) {
      logger.warn(`[LiveReport-${this.provider}] Scheduler already running`);
      return;
    }
    this.running = true;
    this.intervalId = setInterval(() => this.checkAndRun(), 60_000);
    logger.info(`[LiveReport-${this.provider}] Scheduler started (60s check interval)`);

    const broadcast = (global as any).wsBroadcast;
    if (broadcast) {
      broadcast({
        type: 'BOT_LOG',
        data: { accountId: 0, provider: 'SYSTEM', message: `Live Report ${this.provider} scheduler started`, level: 'success' },
      });
    }
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info(`[LiveReport-${this.provider}] Scheduler stopped`);
  }

  isRunning(): boolean { return this.running; }
  isExecuting(): boolean { return this._isExecuting; }

  async runNow(): Promise<void> {
    if (this._isExecuting) {
      logger.warn(`[LiveReport-${this.provider}] Already executing, skipping runNow`);
      return;
    }
    await this.runReport();
  }

  private async checkAndRun(): Promise<void> {
    if (this._isExecuting) return;

    try {
      const enabledSetting = await prisma.setting.findUnique({ where: { key: `${this.prefix}.enabled` } });
      if (enabledSetting?.value !== 'true') return;

      const intervalSetting = await prisma.setting.findUnique({ where: { key: `${this.prefix}.interval` } });
      const intervalMinutes = parseInt(intervalSetting?.value || '60', 10) || 60;
      const intervalMs = intervalMinutes * 60 * 1000;

      if (Date.now() - this.lastRunTime >= intervalMs) {
        this.lastRunTime = Date.now();
        logger.info(`[LiveReport-${this.provider}] Interval ${intervalMinutes}min reached, running...`);
        await this.runReport();
      }
    } catch (err) {
      logger.error(`[LiveReport-${this.provider}] checkAndRun error: ${err}`);
    }
  }

  private async runReport(): Promise<void> {
    this._isExecuting = true;
    const broadcast = (global as any).wsBroadcast;
    const provider = this.provider;

    const onLog = (msg: string, level: string = 'info') => {
      logger.info(`[LiveReport-${provider}] ${msg}`);
      if (broadcast) {
        broadcast({
          type: 'BOT_LOG',
          data: { accountId: 0, provider: 'SYSTEM', message: `[LiveReport-${provider}] ${msg}`, level },
        });
      }
    };

    try {
      // Load account IDs
      const accountIdsSetting = await prisma.setting.findUnique({ where: { key: `${this.prefix}.accountIds` } });
      let accountIds: number[] = [];
      try { accountIds = JSON.parse(accountIdsSetting?.value || '[]'); } catch { accountIds = []; }

      if (accountIds.length === 0) {
        onLog('No accounts configured', 'warning');
        return;
      }

      // Load game categories to check
      const gameCatSetting = await prisma.setting.findUnique({ where: { key: `${this.prefix}.gameCategories` } });
      let gameCategories: string[] = [];
      try { gameCategories = JSON.parse(gameCatSetting?.value || '["SLOT","CASINO","SPORTS","GAMES"]'); } catch { gameCategories = ['SLOT', 'CASINO', 'SPORTS', 'GAMES']; }

      // Load Telegram config (uses main NTO bot token + chat ID)
      const botTokenSetting = await prisma.setting.findUnique({ where: { key: 'notification.telegramBotToken' } });
      const chatIdSetting = await prisma.setting.findUnique({ where: { key: 'notification.telegramChatId' } });
      const botToken = botTokenSetting?.value || '';
      const chatId = chatIdSetting?.value || '';

      if (!botToken || !chatId) {
        onLog('No Telegram Bot Token or Chat ID configured', 'warning');
        return;
      }

      const now = new Date();
      const today = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
      onLog(`Starting NTO Live Report for ${accountIds.length} account(s), date: ${today}, games: ${gameCategories.join(',')}`);

      const automationService = await getAutomationService();
      const allResults: { accountName: string; game: string; rows: NtoRow[]; error?: string }[] = [];

      for (const accountId of accountIds) {
        const account = await prisma.account.findUnique({ where: { id: accountId } });

        if (!account || !account.isActive || account.provider !== provider) {
          onLog(`Account #${accountId} not valid for ${provider} — skipping`, 'warning');
          continue;
        }

        onLog(`Processing "${account.name}"...`);

        try {
          // Start bot if not running
          const browserRunning = contextManager.isRunning(accountId);
          if (!browserRunning) {
            onLog(`Starting bot for "${account.name}"...`);
            await automationService.startBot(accountId);
            const loginOk = await waitForBotReady(accountId, onLog, 60000);
            if (!loginOk) {
              const freshAccount = await prisma.account.findUnique({ where: { id: accountId } });
              onLog(`Bot "${account.name}" failed to login (status: ${freshAccount?.status})`, 'error');
              continue;
            }
          }

          // Run NTO check for each game category
          for (const game of gameCategories) {
            onLog(`Checking ${game}...`);
            try {
              const result: NtoCheckResult = await automationService.checkNto(accountId, {
                dateStart: today,
                dateEnd: today,
                usernames: [],
                gameCategory: game,
              });

              allResults.push({
                accountName: account.name,
                game,
                rows: result.rows,
                error: result.success ? undefined : result.error,
              });

              if (result.success) {
                onLog(`${game}: ${result.rows.length} rows`, 'success');
              } else {
                onLog(`${game}: ${result.error}`, 'warning');
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              onLog(`${game} error: ${msg}`, 'error');
              allResults.push({ accountName: account.name, game, rows: [], error: msg });
            }

            // Small delay between game checks
            await new Promise(r => setTimeout(r, 2000));
          }

          // Stop bot after processing
          try {
            await automationService.stopBot(accountId);
            onLog(`Browser closed for "${account.name}"`);
          } catch (e) {
            logger.warn(`[LiveReport-${provider}] Failed to close browser: ${e}`);
          }

          // Delay between accounts
          if (accountIds.indexOf(accountId) < accountIds.length - 1) {
            onLog('Waiting 5s before next account...');
            await new Promise(r => setTimeout(r, 5000));
          }

        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          onLog(`Error processing "${account.name}": ${errMsg}`, 'error');
          try { await automationService.stopBot(accountId); } catch { /* ignore */ }
        }
      }

      // Format and send summary to Telegram
      if (allResults.length > 0) {
        const message = this.formatSummaryMessage(allResults, now);
        onLog('Sending summary to Telegram...');
        const { sendTelegramMessageToChat } = await import('./telegram');
        const sent = await sendTelegramMessageToChat(chatId, message, undefined, botToken);
        if (sent) {
          onLog('Summary sent to Telegram!', 'success');
        } else {
          onLog('Failed to send summary to Telegram', 'error');
        }
      }

      // Save last run info
      const lastRunData = JSON.stringify({
        timestamp: new Date().toISOString(),
        date: today,
        accountCount: accountIds.length,
        resultCount: allResults.length,
      });

      await prisma.setting.upsert({
        where: { key: `${this.prefix}.lastRun` },
        update: { value: lastRunData },
        create: { key: `${this.prefix}.lastRun`, value: lastRunData, type: 'json' },
      });

      onLog('NTO Live Report cycle complete', 'success');

    } catch (err) {
      logger.error(`[LiveReport-${provider}] runReport error: ${err}`);
      onLog(`Error: ${err}`, 'error');
    } finally {
      this._isExecuting = false;
    }
  }

  private formatSummaryMessage(
    results: { accountName: string; game: string; rows: NtoRow[]; error?: string }[],
    now: Date,
  ): string {
    const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    let msg = `📊 <b>NTO LIVE REPORT ${this.provider}</b>\n`;
    msg += `📅 ${dateStr}\n\n`;

    // Group by account
    const byAccount = new Map<string, typeof results>();
    for (const r of results) {
      if (!byAccount.has(r.accountName)) byAccount.set(r.accountName, []);
      byAccount.get(r.accountName)!.push(r);
    }

    for (const [accountName, accountResults] of byAccount) {
      msg += `<b>🏠 ${accountName}</b>\n`;

      for (const r of accountResults) {
        if (r.error) {
          msg += `  ${r.game}: ❌ ${r.error}\n`;
          continue;
        }
        if (r.rows.length === 0) {
          msg += `  ${r.game}: No data\n`;
          continue;
        }

        // Show summary per game
        if (this.provider === 'VICTORY') {
          const total = r.rows.reduce((s, row) => {
            const val = parseFloat(row.userTO.replace(/[.,]/g, (m) => m === '.' ? '' : '.') || '0');
            return s + (isNaN(val) ? 0 : val);
          }, 0);
          msg += `  ${r.game}: ${r.rows.length} users | Valid Bet: ${total.toLocaleString('id-ID')}\n`;
        } else if (this.provider === 'PAY4D') {
          const total = r.rows.reduce((s, row) => {
            const val = parseFloat(row.betCount.replace(/,/g, '') || '0');
            return s + (isNaN(val) ? 0 : val);
          }, 0);
          msg += `  ${r.game}: ${r.rows.length} users | Bet: ${total.toLocaleString()}\n`;
        } else {
          // NUKE
          const totalTO = r.rows.reduce((s, row) => {
            const val = parseFloat(row.userTO.replace(/,/g, '') || '0');
            return s + (isNaN(val) ? 0 : val);
          }, 0);
          const totalNTO = r.rows.reduce((s, row) => {
            const val = parseFloat(row.userNTO.replace(/,/g, '') || '0');
            return s + (isNaN(val) ? 0 : val);
          }, 0);
          msg += `  ${r.game}: ${r.rows.length} users | TO: ${totalTO.toLocaleString()} | NTO: ${totalNTO.toLocaleString()}\n`;
        }
      }
      msg += `\n`;
    }

    return msg;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export const nukeLiveReportScheduler = new ProviderLiveReportScheduler('NUKE');
export const victoryNtoScheduler = new ProviderLiveReportScheduler('VICTORY');
export const pay4dLiveReportScheduler = new ProviderLiveReportScheduler('PAY4D');
