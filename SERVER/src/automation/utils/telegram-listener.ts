import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import { contextManager } from '../browser/context-manager';
import type { NtoCheckResult, NtoRow, GameCategory } from '../flows/nto-check-flow';
import type { Pay4dGameCategory } from '../flows/pay4d-nto-check-flow';
import {
  getTelegramConfig,
  sendTelegramMessageToChat,
} from './telegram';

// Lazy import to avoid circular dependency
let _automationService: any = null;
async function getAutomationService() {
  if (!_automationService) {
    const mod = await import('../index');
    _automationService = mod.automationService;
  }
  return _automationService;
}

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Valid game categories in Telegram commands (provider-agnostic keywords)
const VALID_CATEGORIES = new Set<string>(['SLOT', 'SPORTS', 'CASINO', 'GAMES']);

// Map command keywords → PAY4D multiselect labels
const PAY4D_CATEGORY_MAP: Record<string, Pay4dGameCategory> = {
  'SLOT': 'Slots',
  'SPORTS': 'Sport',
  'CASINO': 'Live Casino',
  'GAMES': 'Togel',
};

// Per-account command queue to prevent concurrent operations on same account
const accountQueues = new Map<string, Promise<void>>();

/**
 * Queue a command for an account. Commands on the same account run sequentially,
 * commands on different accounts run in parallel.
 */
function queueForAccount(accountName: string, fn: () => Promise<void>): void {
  const key = accountName.toLowerCase();
  const prev = accountQueues.get(key) ?? Promise.resolve();

  const next = prev.then(fn, fn); // run fn after previous completes (even if it failed)
  accountQueues.set(key, next);

  // Clean up entry when queue is empty
  next.finally(() => {
    if (accountQueues.get(key) === next) {
      accountQueues.delete(key);
    }
  });
}

interface ParsedNtoCommand {
  accountName: string;
  gameCategory: string; // Raw category keyword from command (SLOT, SPORTS, etc.)
  usernames: string[];
  dateStart: string; // DD-MM-YYYY
  dateEnd: string;   // DD-MM-YYYY
}

/**
 * Parse a Telegram NTO command.
 *
 * Single-line format:
 *   Captain77 SLOT NTO drmollor,belety 01-03-2026:03-03-2026
 *
 * Multi-line format:
 *   Captain77 SLOT NTO
 *
 *   drmollor
 *   belety
 *   junam12
 *
 *   01-03-2026:03-03-2026
 */
function parseNtoCommand(text: string): ParsedNtoCommand | null {
  // Try single-line format first
  const singleLine = parseSingleLine(text);
  if (singleLine) return singleLine;

  // Try multi-line format
  return parseMultiLine(text);
}

/**
 * Parse single-line: "AccountName GAME NTO user1,user2 DD-MM-YYYY:DD-MM-YYYY"
 */
function parseSingleLine(text: string): ParsedNtoCommand | null {
  const cleaned = text.trim().replace(/\s+/g, ' ');

  const match = cleaned.match(
    /^(\S+)\s+(SLOT|SPORTS|CASINO|GAMES)\s+NTO\s+(\S+)\s+(\d{2}-\d{2}-\d{4}):(\d{2}-\d{2}-\d{4})$/i
  );

  if (!match) return null;

  const usernames = match[3]
    .split(',')
    .map(u => u.trim().toLowerCase())
    .filter(u => u.length > 0);

  if (usernames.length === 0) return null;
  if (!isValidDate(match[4]) || !isValidDate(match[5])) return null;

  return {
    accountName: match[1],
    gameCategory: match[2].toUpperCase(),
    usernames,
    dateStart: match[4],
    dateEnd: match[5],
  };
}

/**
 * Parse multi-line format:
 *   AccountName GAME NTO
 *   (blank line optional)
 *   username1
 *   username2
 *   ...
 *   (blank line optional)
 *   DD-MM-YYYY:DD-MM-YYYY
 */
function parseMultiLine(text: string): ParsedNtoCommand | null {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 3) return null; // Need at least: header, 1 username, dates

  // First line: "AccountName GAME NTO"
  const headerMatch = lines[0].match(
    /^(\S+)\s+(SLOT|SPORTS|CASINO|GAMES)\s+NTO$/i
  );
  if (!headerMatch) return null;

  // Last line: "DD-MM-YYYY:DD-MM-YYYY"
  const dateMatch = lines[lines.length - 1].match(
    /^(\d{2}-\d{2}-\d{4}):(\d{2}-\d{2}-\d{4})$/
  );
  if (!dateMatch) return null;

  if (!isValidDate(dateMatch[1]) || !isValidDate(dateMatch[2])) return null;

  // Middle lines = usernames (one per line, or comma-separated)
  const usernames: string[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    // Each line can have one username or comma-separated usernames
    const parts = lines[i].split(',').map(u => u.trim().toLowerCase()).filter(u => u.length > 0);
    usernames.push(...parts);
  }

  if (usernames.length === 0) return null;

  return {
    accountName: headerMatch[1],
    gameCategory: headerMatch[2].toUpperCase(),
    usernames,
    dateStart: dateMatch[1],
    dateEnd: dateMatch[2],
  };
}

/**
 * Basic DD-MM-YYYY validation
 */
function isValidDate(ddmmyyyy: string): boolean {
  const parts = ddmmyyyy.split('-');
  if (parts.length !== 3) return false;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  return d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2020 && y <= 2100;
}

/**
 * Find an account by name (case-insensitive) across ALL providers.
 * Returns the account + whether browser is running.
 */
async function findAccountByName(name: string): Promise<{
  account: { id: number; name: string; panelUrl: string; provider: string; status: string } | null;
  browserRunning: boolean;
}> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true, name: true, panelUrl: true, provider: true, status: true },
  });

  const nameLower = name.toLowerCase();
  const matched = accounts.find(
    a => a.name.toLowerCase() === nameLower
      || a.name.toLowerCase().includes(nameLower)
      || nameLower.includes(a.name.toLowerCase())
  );

  if (!matched) return { account: null, browserRunning: false };

  return { account: matched, browserRunning: contextManager.isRunning(matched.id) };
}

/**
 * Wait for bot to reach 'running' status after startBot.
 * Polls DB status every 2s. Returns true if ready, false if failed/timeout.
 */
async function waitForBotReady(accountId: number, onLog: (msg: string, level?: string) => void, timeoutMs: number = 60000): Promise<boolean> {
  const start = Date.now();
  const pollInterval = 2000;

  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, pollInterval));

    const acc = await prisma.account.findUnique({
      where: { id: accountId },
      select: { status: true },
    });

    if (!acc) return false;

    switch (acc.status) {
      case 'running':
        return true;
      case 'error':
      case 'stopped':
      case 'idle':
        return false;
      case 'waiting_otp':
        return false; // Need manual OTP
      default:
        // 'starting', 'logging_in' etc - keep waiting
        onLog(`Bot status: ${acc.status}, waiting...`);
    }
  }

  onLog('Bot start timeout', 'warning');
  return false;
}

/**
 * Process an NTO command from Telegram.
 * Supports both NUKE and PAY4D providers.
 * Auto-starts bot if not running, then runs NTO check.
 */
async function processNtoCommand(
  chatId: number | string,
  messageId: number,
  command: ParsedNtoCommand,
  senderName: string,
): Promise<void> {
  const { account, browserRunning } = await findAccountByName(command.accountName);

  if (!account) {
    await sendTelegramMessageToChat(
      chatId,
      `❌ <b>Account "${command.accountName}" tidak ditemukan di database.</b>\n` +
      `Pastikan nama account sudah benar.`,
      messageId,
    );
    return;
  }

  const provider = account.provider;
  const dateDisplay = `${command.dateStart} s/d ${command.dateEnd}`;

  // Broadcast helper
  const broadcast = (global as any).wsBroadcast;
  const onLog = (msg: string, level: string = 'info') => {
    logger.info(`[TG][${provider}] ${msg}`);
    if (broadcast) {
      broadcast({
        type: 'BOT_LOG',
        data: { accountId: account.id, provider, message: `[Telegram] ${msg}`, level },
      });
    }
  };

  // === Auto-start bot if not running ===
  if (!browserRunning) {
    await sendTelegramMessageToChat(
      chatId,
      `🚀 <b>Bot "${account.name}" belum running, starting otomatis...</b>\n` +
      `Mohon tunggu proses login...`,
      messageId,
    );

    onLog(`Auto-starting bot for "${account.name}"...`);

    try {
      const automationService = await getAutomationService();
      await automationService.startBot(account.id);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await sendTelegramMessageToChat(
        chatId,
        `❌ <b>Gagal start bot "${account.name}":</b> ${errMsg}`,
        messageId,
      );
      return;
    }

    // Wait for login to complete (poll status, max 90s for PAY4D since captcha+PIN takes longer)
    const timeout = provider === 'PAY4D' ? 90000 : 60000;
    const loginOk = await waitForBotReady(account.id, onLog, timeout);

    if (!loginOk) {
      const freshAccount = await prisma.account.findUnique({ where: { id: account.id } });
      if (freshAccount?.status === 'waiting_otp') {
        await sendTelegramMessageToChat(
          chatId,
          `🔐 <b>Bot "${account.name}" membutuhkan OTP.</b>\n` +
          `Silakan submit OTP melalui panel → http://localhost:6969\n` +
          `Setelah OTP berhasil, kirim ulang command NTO.`,
          messageId,
        );
      } else {
        await sendTelegramMessageToChat(
          chatId,
          `❌ <b>Bot "${account.name}" gagal login.</b> (Status: ${freshAccount?.status})\n` +
          `Error: ${freshAccount?.lastError || 'unknown'}\n` +
          `Cek panel → http://localhost:6969`,
          messageId,
        );
      }
      return;
    }

    onLog(`Bot "${account.name}" ready!`, 'success');
  }

  // === Verify browser page is available ===
  const page = contextManager.getPage(account.id);
  if (!page) {
    await sendTelegramMessageToChat(
      chatId,
      `❌ <b>Browser untuk "${account.name}" tidak ditemukan.</b>\nSilakan restart bot.`,
      messageId,
    );
    return;
  }

  // Send acknowledgment
  await sendTelegramMessageToChat(
    chatId,
    `⏳ <b>NTO Check dimulai</b>\n` +
    `Account: <b>${account.name}</b> (${provider})\n` +
    `Game: <b>${command.gameCategory}</b>\n` +
    `Username: <b>${command.usernames.join(', ')}</b>\n` +
    `Tanggal: <b>${dateDisplay}</b>\n\n` +
    `Mohon tunggu, sedang memproses...`,
    messageId,
  );

  onLog(`Telegram command from ${senderName}: ${command.gameCategory} ${command.usernames.join(',')} ${dateDisplay}`);

  // === Run NTO check via automationService (handles provider routing) ===
  const automationService = await getAutomationService();

  // Map game category for the specific provider
  // Victory has no game category filter — the category from the command is ignored
  const mappedCategory = provider === 'PAY4D'
    ? PAY4D_CATEGORY_MAP[command.gameCategory] || 'Slots'
    : command.gameCategory as GameCategory;

  if (provider === 'VICTORY') {
    onLog(`Victory has no game category filter, "${command.gameCategory}" will be ignored`);
  }

  const result: NtoCheckResult = await automationService.checkNto(account.id, {
    dateStart: command.dateStart,
    dateEnd: command.dateEnd,
    usernames: command.usernames,
    gameCategory: mappedCategory,
    maxPages: 5,
  });

  // For PAY4D: filter CSV results to only include requested usernames
  let filteredRows = result.rows;
  if (provider === 'PAY4D' && command.usernames.length > 0) {
    const usernameSet = new Set(command.usernames.map(u => u.toLowerCase()));
    filteredRows = result.rows.filter(r => usernameSet.has(r.username.toLowerCase()));

    // Add empty rows for usernames not found in results
    for (const username of command.usernames) {
      const found = filteredRows.some(r => r.username.toLowerCase() === username.toLowerCase());
      if (!found) {
        filteredRows.push({ username, betCount: '0', userTO: '0', userNTO: '0' });
      }
    }

    onLog(`PAY4D: filtered ${result.rows.length} CSV rows → ${filteredRows.length} matching usernames`);
  }

  // Format and send results
  const resultMsg = formatResultMessage(filteredRows, command, dateDisplay, senderName, account.name, provider);
  await sendTelegramMessageToChat(chatId, resultMsg, messageId);

  // Save to database
  try {
    await prisma.ntoResult.create({
      data: {
        accountId: account.id,
        provider,
        value: `TG:${command.gameCategory} ${command.usernames.join(',')}`,
        rawData: JSON.stringify({
          source: 'telegram',
          command,
          rows: filteredRows,
          totalCsvRows: result.rows.length,
          senderName,
        }),
      },
    });
  } catch (e) {
    logger.warn(`Failed to save NTO result: ${e}`);
  }

  onLog(`NTO complete: ${filteredRows.length} rows for ${command.usernames.length} username(s)`, 'success');

  // Auto-close browser after task is done (session saved in profile)
  try {
    await automationService.stopBot(account.id);
    onLog(`Browser closed for "${account.name}" (session saved)`);
  } catch (e) {
    logger.warn(`Failed to auto-close browser: ${e}`);
  }
}

/**
 * Format NTO results for Telegram reply.
 */
function formatResultMessage(
  rows: NtoRow[],
  command: ParsedNtoCommand,
  dateDisplay: string,
  senderName: string,
  accountName: string,
  provider: string,
): string {
  let msg = `📊 <b>NTO Report</b>\n`;
  msg += `Account: <b>${accountName}</b> (${provider})\n`;
  msg += `Game: <b>${command.gameCategory}</b>\n`;
  msg += `Tanggal: <b>${dateDisplay}</b>\n`;
  msg += `Diminta: <b>${senderName}</b>\n\n`;

  if (provider === 'VICTORY') {
    // Victory: only Username + Valid Bet
    msg += `<pre>`;
    msg += `${'Username'.padEnd(16)} ${'Valid Bet'.padStart(15)}\n`;
    msg += `${'─'.repeat(32)}\n`;

    for (const r of rows) {
      msg += `${r.username.substring(0, 15).padEnd(16)} ${r.userTO.padStart(15)}\n`;
    }
    msg += `</pre>`;

    const valid = rows.filter(r => r.userTO !== 'ERR');
    if (valid.length > 1) {
      const totalValidBet = valid.reduce((s, r) => s + parseFloat(r.userTO.replace(/,/g, '') || '0'), 0);
      msg += `\n<b>Total Valid Bet: ${totalValidBet.toLocaleString()}</b>`;
    }
  } else if (provider === 'PAY4D') {
    // PAY4D: Username + Bet only
    msg += `<pre>`;
    msg += `${'Username'.padEnd(16)} ${'Bet'.padStart(15)}\n`;
    msg += `${'─'.repeat(32)}\n`;

    for (const r of rows) {
      msg += `${r.username.substring(0, 15).padEnd(16)} ${r.betCount.padStart(15)}\n`;
    }
    msg += `</pre>`;

    const valid = rows.filter(r => r.betCount !== '-');
    if (valid.length > 1) {
      const totalBet = valid.reduce((s, r) => s + parseFloat(r.betCount.replace(/,/g, '') || '0'), 0);
      msg += `\n<b>Total Bet: ${totalBet.toLocaleString()}</b>`;
    }
  } else {
    // NUKE: Username + Bet + TO + NTO
    msg += `<pre>`;
    msg += `${'Username'.padEnd(16)} ${'Bet'.padStart(7)} ${'TO'.padStart(12)} ${'NTO'.padStart(12)}\n`;
    msg += `${'─'.repeat(49)}\n`;

    for (const r of rows) {
      msg += `${r.username.substring(0, 15).padEnd(16)} ${r.betCount.padStart(7)} ${r.userTO.padStart(12)} ${r.userNTO.padStart(12)}\n`;
    }
    msg += `</pre>`;

    const valid = rows.filter(r => r.userTO !== 'ERR');
    if (valid.length > 1) {
      const totalBet = valid.reduce((s, r) => s + parseInt(r.betCount.replace(/,/g, '') || '0', 10), 0);
      const totalTO = valid.reduce((s, r) => s + parseFloat(r.userTO.replace(/,/g, '') || '0'), 0);
      const totalNTO = valid.reduce((s, r) => s + parseFloat(r.userNTO.replace(/,/g, '') || '0'), 0);
      msg += `\n<b>Total: Bet ${totalBet.toLocaleString()} | TO ${totalTO.toLocaleString()} | NTO ${totalNTO.toLocaleString()}</b>`;
    }
  }

  return msg;
}

// ============================================================
// Telegram Long Polling Listener
// ============================================================

class TelegramListener {
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Telegram listener already running');
      return;
    }

    const config = await getTelegramConfig();
    if (!config) {
      logger.warn('Telegram listener: missing bot token or chat ID');
      return;
    }

    // Clear any existing webhook and flush old updates to avoid conflict
    try {
      await fetch(`${TELEGRAM_API}${config.botToken}/deleteWebhook?drop_pending_updates=true`);
      // Small delay to let Telegram release the previous getUpdates connection
      await new Promise(r => setTimeout(r, 1000));
      // Flush: get latest update_id so we only process new messages
      const flush = await fetch(`${TELEGRAM_API}${config.botToken}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset: -1, limit: 1, timeout: 0 }),
      });
      const flushData = await flush.json() as any;
      if (flushData.ok && flushData.result?.length > 0) {
        this.offset = flushData.result[flushData.result.length - 1].update_id + 1;
        logger.debug(`Telegram: flushed old updates, offset set to ${this.offset}`);
      }
    } catch (e) {
      logger.warn(`Telegram flush error (non-fatal): ${e}`);
    }

    this.running = true;
    logger.info('Telegram bot listener started (long polling)');

    const broadcast = (global as any).wsBroadcast;
    if (broadcast) {
      broadcast({
        type: 'BOT_LOG',
        data: { accountId: 0, provider: 'SYSTEM', message: 'Telegram bot listener started', level: 'success' },
      });
    }

    this.pollLoop(config.botToken);
  }

  stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    logger.info('Telegram bot listener stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async pollLoop(botToken: string): Promise<void> {
    while (this.running) {
      try {
        await this.poll(botToken);
      } catch (err) {
        if (!this.running) break;
        logger.warn(`Telegram poll error: ${err}`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  private async poll(botToken: string): Promise<void> {
    this.abortController = new AbortController();

    const url = `${TELEGRAM_API}${botToken}/getUpdates`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offset: this.offset,
        timeout: 30,
        allowed_updates: ['message'],
      }),
      signal: this.abortController.signal,
    });

    const data = await res.json() as any;

    if (!data.ok) {
      logger.error('Telegram getUpdates failed', { error: data.description });
      await new Promise(r => setTimeout(r, 3000));
      return;
    }

    const updates = data.result || [];
    if (updates.length > 0) {
      logger.debug(`Telegram: received ${updates.length} update(s)`);
    }

    for (const update of updates) {
      this.offset = update.update_id + 1;

      if (update.message?.text) {
        await this.handleMessage(update.message);
      }
    }
  }

  private async handleMessage(message: any): Promise<void> {
    const text = message.text?.trim();
    if (!text) return;

    const chatId = message.chat.id;
    const messageId = message.message_id;
    const senderName = message.from?.first_name || message.from?.username || 'Unknown';

    logger.debug(`Telegram msg from ${senderName} in chat ${chatId}: "${text.substring(0, 80)}"`);

    // Strip leading /nto or /nto@botname command prefix (group privacy mode compatibility)
    let cleanText = text;
    if (cleanText.match(/^\/nto(@\S+)?\b/i)) {
      cleanText = cleanText.replace(/^\/nto(@\S+)?\s*/i, '').trim();
    }

    // Must contain "NTO" keyword somewhere
    const upper = cleanText.toUpperCase();
    if (!upper.includes('NTO')) return;

    logger.info(`Telegram NTO command from ${senderName}: "${cleanText}"`);

    // Parse command
    const command = parseNtoCommand(cleanText);
    if (!command) {
      await sendTelegramMessageToChat(
        chatId,
        `❌ <b>Format tidak valid.</b>\n\n` +
        `<b>Format 1 (satu baris):</b>\n` +
        `<code>Captain77 SLOT NTO drmollor,belety 01-03-2026:03-03-2026</code>\n\n` +
        `<b>Format 2 (multi baris):</b>\n` +
        `<code>Captain77 SLOT NTO\n\ndrmollor\nbelety\njunam12\n\n01-03-2026:03-03-2026</code>`,
        messageId,
      );
      return;
    }

    // Queue per account — same account runs sequentially, different accounts run in parallel
    queueForAccount(command.accountName, async () => {
      try {
        await processNtoCommand(chatId, messageId, command, senderName);
      } catch (err) {
        logger.error(`NTO command error: ${err}`);
        await sendTelegramMessageToChat(
          chatId,
          `❌ <b>Error:</b> ${err instanceof Error ? err.message : String(err)}`,
          messageId,
        ).catch(() => {});
      }
    });
  }
}

export const telegramListener = new TelegramListener();
