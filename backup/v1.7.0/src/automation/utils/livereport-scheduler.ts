import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import { contextManager } from '../browser/context-manager';
import { waitForBotReady } from './telegram-listener';
import {
  sendTelegramPhotoBufferToChat,
} from './telegram';
import { victoryLiveReportFlow } from '../flows/victory-livereport-flow';
import {
  summarize,
  buildTableRows,
  computeTop5,
  renderTableToPng,
  buildTelegramCaption,
  countMembers,
  type LiveReportMode,
} from './livereport-processor';

// Lazy import to avoid circular dependency
let _automationService: any = null;
async function getAutomationService() {
  if (!_automationService) {
    const mod = await import('../index');
    _automationService = mod.automationService;
  }
  return _automationService;
}

const MIN_TEAMS_REQUIRED = 15;

/**
 * Live Report Scheduler — Hourly loop + Daily/Weekly/Monthly recaps.
 *
 * Settings stored in Setting table:
 *   - livereport.scheduler.enabled (boolean)
 *   - livereport.scheduler.interval (number, minutes, default 60)
 *   - livereport.scheduler.accountIds (json, number[])
 *   - livereport.scheduler.dailyRecapTime (string, "HH:MM", default "00:10")
 *   - livereport.scheduler.weeklyRecap (boolean, default true)
 *   - livereport.scheduler.monthlyRecap (boolean, default true)
 *   - livereport.scheduler.lastRun (json)
 *   - notification.telegramChatIdLiveReport (string)
 */
class LiveReportScheduler {
  private running = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _isExecuting = false;
  private lastHourlyRunTime = 0;
  private lastDailyRunDate: string | null = null;
  private lastWeeklyRunWeek: string | null = null;
  private lastMonthlyRunMonth: string | null = null;

  start(): void {
    if (this.running) {
      logger.warn('[LiveReport] Scheduler already running');
      return;
    }

    this.running = true;
    // Check every 60 seconds
    this.intervalId = setInterval(() => this.checkAndRun(), 60_000);
    logger.info('[LiveReport] Scheduler started (60s check interval)');

    const broadcast = (global as any).wsBroadcast;
    if (broadcast) {
      broadcast({
        type: 'BOT_LOG',
        data: { accountId: 0, provider: 'SYSTEM', message: 'Live Report scheduler started', level: 'success' },
      });
    }
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('[LiveReport] Scheduler stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  isExecuting(): boolean {
    return this._isExecuting;
  }

  /** Manual trigger — runs immediately for all configured accounts */
  async runNow(recapType?: 'daily' | 'weekly' | 'monthly'): Promise<void> {
    if (this._isExecuting) {
      logger.warn('[LiveReport] Already executing, skipping runNow');
      return;
    }
    if (recapType === 'daily') {
      await this.runDailyRecap();
    } else if (recapType === 'weekly') {
      await this.runWeeklyRecap();
    } else if (recapType === 'monthly') {
      await this.runMonthlyRecap();
    } else {
      await this.runHourlyReport();
    }
  }

  private async checkAndRun(): Promise<void> {
    if (this._isExecuting) return;

    try {
      const enabledSetting = await prisma.setting.findUnique({ where: { key: 'livereport.scheduler.enabled' } });
      if (enabledSetting?.value !== 'true') return;

      const now = new Date();
      const currentHH = now.getHours();
      const currentMM = now.getMinutes();

      // Check daily recap time
      const dailyTimeSetting = await prisma.setting.findUnique({ where: { key: 'livereport.scheduler.dailyRecapTime' } });
      const dailyTime = dailyTimeSetting?.value || '00:10';
      const [dailyHH, dailyMM] = dailyTime.split(':').map(Number);

      const today = now.toISOString().split('T')[0];

      if (currentHH === dailyHH && currentMM === dailyMM && this.lastDailyRunDate !== today) {
        this.lastDailyRunDate = today;
        logger.info('[LiveReport] Daily recap time match, running...');
        await this.runDailyRecap();
        return;
      }

      // Check weekly recap (Monday at 10:00)
      const weeklyEnabled = await prisma.setting.findUnique({ where: { key: 'livereport.scheduler.weeklyRecap' } });
      if (weeklyEnabled?.value !== 'false' && now.getDay() === 1 && currentHH === 10 && currentMM === 0) {
        const weekKey = `${now.getFullYear()}-W${getISOWeek(now)}`;
        if (this.lastWeeklyRunWeek !== weekKey) {
          this.lastWeeklyRunWeek = weekKey;
          logger.info('[LiveReport] Weekly recap time match, running...');
          await this.runWeeklyRecap();
          return;
        }
      }

      // Check monthly recap (1st of month at 10:00)
      const monthlyEnabled = await prisma.setting.findUnique({ where: { key: 'livereport.scheduler.monthlyRecap' } });
      if (monthlyEnabled?.value !== 'false' && now.getDate() === 1 && currentHH === 10 && currentMM === 0) {
        const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
        if (this.lastMonthlyRunMonth !== monthKey) {
          this.lastMonthlyRunMonth = monthKey;
          logger.info('[LiveReport] Monthly recap time match, running...');
          await this.runMonthlyRecap();
          return;
        }
      }

      // Check hourly interval
      const intervalSetting = await prisma.setting.findUnique({ where: { key: 'livereport.scheduler.interval' } });
      const intervalMinutes = parseInt(intervalSetting?.value || '60', 10) || 60;
      const intervalMs = intervalMinutes * 60 * 1000;

      if (Date.now() - this.lastHourlyRunTime >= intervalMs) {
        this.lastHourlyRunTime = Date.now();
        logger.info(`[LiveReport] Interval ${intervalMinutes}min reached, running hourly report...`);
        await this.runHourlyReport();
      }

    } catch (err) {
      logger.error(`[LiveReport] checkAndRun error: ${err}`);
    }
  }

  // ============================================================
  // Report execution
  // ============================================================

  private async runHourlyReport(): Promise<void> {
    const now = new Date();
    const today = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    await this.runReport({ startDate: today, titleSuffix: '' });
  }

  private async runDailyRecap(): Promise<void> {
    const yesterday = new Date(Date.now() - 86400000);
    const dateStr = `${pad(yesterday.getDate())}/${pad(yesterday.getMonth() + 1)}/${yesterday.getFullYear()}`;
    const dateLabel = formatDateLabel(yesterday);
    await this.runReport({
      startDate: dateStr,
      endDate: dateStr,
      titleOverride: (mode) => `REKAP HARIAN ${mode} ${dateLabel}`,
    });
  }

  private async runWeeklyRecap(): Promise<void> {
    const now = new Date();
    // Previous week: Monday to Sunday
    const dayOfWeek = now.getDay() || 7; // 1=Mon, 7=Sun
    const lastSunday = new Date(now.getTime() - dayOfWeek * 86400000);
    const lastMonday = new Date(lastSunday.getTime() - 6 * 86400000);

    const startStr = `${pad(lastMonday.getDate())}/${pad(lastMonday.getMonth() + 1)}/${lastMonday.getFullYear()}`;
    const endStr = `${pad(lastSunday.getDate())}/${pad(lastSunday.getMonth() + 1)}/${lastSunday.getFullYear()}`;
    const rangeLabel = `${formatDateLabel(lastMonday)} - ${formatDateLabel(lastSunday)}`;

    await this.runReport({
      startDate: startStr,
      endDate: endStr,
      titleOverride: (mode) => `REKAP MINGGUAN ${mode} ${rangeLabel}`,
    });
  }

  private async runMonthlyRecap(): Promise<void> {
    const now = new Date();
    // Previous month
    const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastPrevMonth = new Date(firstThisMonth.getTime() - 86400000);
    const firstPrevMonth = new Date(lastPrevMonth.getFullYear(), lastPrevMonth.getMonth(), 1);

    const startStr = `${pad(firstPrevMonth.getDate())}/${pad(firstPrevMonth.getMonth() + 1)}/${firstPrevMonth.getFullYear()}`;
    const endStr = `${pad(lastPrevMonth.getDate())}/${pad(lastPrevMonth.getMonth() + 1)}/${lastPrevMonth.getFullYear()}`;
    const monthLabel = lastPrevMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    await this.runReport({
      startDate: startStr,
      endDate: endStr,
      titleOverride: (mode) => `REKAP BULANAN ${mode} ${monthLabel}`,
    });
  }

  private async runReport(opts: {
    startDate: string;
    endDate?: string;
    titleSuffix?: string;
    titleOverride?: (mode: string) => string;
  }): Promise<void> {
    this._isExecuting = true;
    const broadcast = (global as any).wsBroadcast;

    const onLog = (msg: string, level: string = 'info') => {
      logger.info(`[LiveReport] ${msg}`);
      if (broadcast) {
        broadcast({
          type: 'BOT_LOG',
          data: { accountId: 0, provider: 'SYSTEM', message: `[LiveReport] ${msg}`, level },
        });
      }
    };

    try {
      // Load account IDs
      const accountIdsSetting = await prisma.setting.findUnique({ where: { key: 'livereport.scheduler.accountIds' } });
      let accountIds: number[] = [];
      try { accountIds = JSON.parse(accountIdsSetting?.value || '[]'); } catch { accountIds = []; }

      if (accountIds.length === 0) {
        onLog('No accounts configured for Live Report scheduler', 'warning');
        return;
      }

      // Get bot token + chat ID for Live Report (separate from main bot)
      const botTokenSetting = await prisma.setting.findUnique({ where: { key: 'notification.telegramBotTokenLiveReport' } });
      const chatIdSetting = await prisma.setting.findUnique({ where: { key: 'notification.telegramChatIdLiveReport' } });
      const lrBotToken = botTokenSetting?.value || '';
      const chatId = chatIdSetting?.value || '';

      if (!lrBotToken) {
        onLog('No Telegram Bot Token configured for Live Report', 'warning');
        return;
      }
      if (!chatId) {
        onLog('No Telegram Chat ID configured for Live Report', 'warning');
        return;
      }

      onLog(`Starting Live Report for ${accountIds.length} account(s), date: ${opts.startDate}${opts.endDate ? ' - ' + opts.endDate : ''}`);

      const automationService = await getAutomationService();

      for (const accountId of accountIds) {
        const account = await prisma.account.findUnique({ where: { id: accountId } });

        if (!account || account.feature !== 'LIVEREPORT' || !account.isActive || account.provider !== 'VICTORY') {
          onLog(`Account #${accountId} not valid for Live Report — skipping`, 'warning');
          continue;
        }

        const rawUpline = account.uplineUsername;
        if (!rawUpline) {
          onLog(`Account "${account.name}" has no uplineUsername configured — skipping`, 'warning');
          continue;
        }

        // Support multiple upline usernames (comma-separated)
        const uplineList = rawUpline.split(',').map(u => u.trim()).filter(Boolean);
        if (uplineList.length === 0) {
          onLog(`Account "${account.name}" has empty uplineUsername — skipping`, 'warning');
          continue;
        }

        onLog(`Processing "${account.name}" (${uplineList.length} upline(s): ${uplineList.join(', ')})...`);

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

          const page = contextManager.getPage(accountId);
          if (!page) {
            onLog(`No browser page for "${account.name}"`, 'error');
            continue;
          }

          // Loop through each upline username
          for (const uplineUsername of uplineList) {
            const mode: LiveReportMode = uplineUsername.toLowerCase().includes('mkt') ? 'MKT' : 'REBORN';
            onLog(`Checking upline "${uplineUsername}" (mode: ${mode})...`);

            // Run the live report flow
            const result = await victoryLiveReportFlow(page, account.panelUrl, onLog, {
              uplineUsername,
              dateStart: opts.startDate,
              dateEnd: opts.endDate,
            });

            if (!result.success || result.rows.length === 0) {
              onLog(`No data for upline "${uplineUsername}": ${result.error || 'empty'}`, 'warning');
              continue;
            }

            // Process data
            const summary = summarize(result.rows, mode);
            const memberCount = countMembers(summary);

            if (memberCount < MIN_TEAMS_REQUIRED) {
              onLog(`Data incomplete for "${uplineUsername}": ${memberCount} members < ${MIN_TEAMS_REQUIRED}`, 'warning');
            }

            const tableRows = buildTableRows(summary, mode);
            const top5 = computeTop5(tableRows);

            // Build title
            const now = new Date();
            const modeLabel = mode === 'MKT' ? 'TEAMREBORN MKT' : 'TEAMREBORN';
            let title: string;
            if (opts.titleOverride) {
              title = opts.titleOverride(modeLabel);
            } else {
              title = `${modeLabel} REPORT — ${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
            }

            // Render table to PNG
            onLog('Rendering table image...');
            const pngBuffer = await renderTableToPng(page, tableRows, title, top5);

            // Build caption
            const currentHour = now.getHours();
            const includeTopBottom = [15, 18, 21, 0].includes(currentHour) || !!opts.titleOverride;
            const caption = buildTelegramCaption(title, tableRows, includeTopBottom);

            // Send to Telegram
            onLog('Sending to Telegram...');
            const sent = await sendTelegramPhotoBufferToChat(chatId, pngBuffer, caption, `livereport_${mode.toLowerCase()}.png`, lrBotToken);

            if (sent) {
              onLog(`Live Report "${uplineUsername}" (${mode}) sent successfully!`, 'success');
            } else {
              onLog(`Failed to send Live Report for "${uplineUsername}"`, 'error');
            }

            // Delay between uplines
            if (uplineList.indexOf(uplineUsername) < uplineList.length - 1) {
              onLog('Waiting 3s before next upline...');
              await new Promise(r => setTimeout(r, 3000));
            }
          }

          // Stop bot after processing all uplines
          try {
            await automationService.stopBot(accountId);
            onLog(`Browser closed for "${account.name}"`);
          } catch (e) {
            logger.warn(`[LiveReport] Failed to close browser for "${account.name}": ${e}`);
          }

          // Delay between accounts
          if (accountIds.indexOf(accountId) < accountIds.length - 1) {
            onLog('Waiting 10s before next account...');
            await new Promise(r => setTimeout(r, 10000));
          }

        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          onLog(`Error processing "${account.name}": ${errMsg}`, 'error');

          try {
            await automationService.stopBot(accountId);
          } catch { /* ignore */ }
        }
      }

      // Save last run info
      const lastRunData = JSON.stringify({
        timestamp: new Date().toISOString(),
        startDate: opts.startDate,
        endDate: opts.endDate,
        accountIds,
      });

      await prisma.setting.upsert({
        where: { key: 'livereport.scheduler.lastRun' },
        update: { value: lastRunData },
        create: { key: 'livereport.scheduler.lastRun', value: lastRunData, type: 'json' },
      });

      onLog('Live Report cycle complete', 'success');

    } catch (err) {
      logger.error(`[LiveReport] runReport error: ${err}`);
      onLog(`Live Report error: ${err}`, 'error');
    } finally {
      this._isExecuting = false;
    }
  }
}

// ============================================================
// Helpers
// ============================================================

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateLabel(d: Date): string {
  return `${pad(d.getDate())} ${d.toLocaleDateString('en-US', { month: 'long' })} ${d.getFullYear()}`;
}

function getISOWeek(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

export const livereportScheduler = new LiveReportScheduler();
