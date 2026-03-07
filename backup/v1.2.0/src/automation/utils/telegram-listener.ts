import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import { contextManager } from '../browser/context-manager';
import type { NtoCheckResult, NtoRow, GameCategory } from '../flows/nto-check-flow';
import type { Pay4dGameCategory } from '../flows/pay4d-nto-check-flow';
import type { TarikDbRow, TarikDbCheckResult } from '../flows/nuke-tarikdb-check-flow';
import {
  getTelegramConfig,
  sendTelegramMessageToChat,
  sendTelegramDocumentToChat,
  sendTelegramMessageWithKeyboard,
  answerCallbackQuery,
  editMessageText,
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

// ============================================================
// TARIK DB Command Parser
// ============================================================

interface ParsedTarikDbCommand {
  accountName: string;
  mode: 'date_range' | 'old_user';
  // date_range mode:
  username?: string;     // Optional single username filter
  dateStart?: string;    // DD-MM-YYYY (required for date_range)
  dateEnd?: string;      // DD-MM-YYYY (required for date_range)
  // old_user mode:
  usernames?: string[];  // Multiple usernames (required for old_user)
}

/**
 * Parse a Telegram TARIK DB command.
 *
 * Format 1 - Date Range (targeted, with username):
 *   Captain77 TARIK DB
 *   esia77
 *   01-03-2026:05-03-2026
 *
 * Format 2 - Date Range (general, no username):
 *   Captain77 TARIK DB
 *
 *   01-03-2026:05-03-2026
 *
 * Format 3 - Old User (no dates, multi-username):
 *   Captain77 TARIK DB
 *   ID1
 *   ID2
 *   ID3
 */
function parseTarikDbCommand(text: string): ParsedTarikDbCommand | null {
  // Normalize text: split into lines (keep empty lines for parsing)
  const rawLines = text.trim().split('\n').map(l => l.trim());

  // First line must contain "TARIK DB"
  const headerMatch = rawLines[0].match(/^(\S+)\s+TARIK\s*DB$/i);
  if (!headerMatch) return null;

  const accountName = headerMatch[1];

  // Find non-empty lines after header
  const nonEmptyLines = rawLines.filter(l => l.length > 0);

  if (nonEmptyLines.length < 2) return null; // Need at least header + something

  // Check if last non-empty line is a date range
  const lastLine = nonEmptyLines[nonEmptyLines.length - 1];
  const dateMatch = lastLine.match(/^(\d{2}-\d{2}-\d{4}):(\d{2}-\d{2}-\d{4})$/);

  if (dateMatch && isValidDate(dateMatch[1]) && isValidDate(dateMatch[2])) {
    // === DATE RANGE MODE (existing flow) ===
    let username: string | undefined;
    if (nonEmptyLines.length >= 3) {
      const middleLines = nonEmptyLines.slice(1, -1);
      const usernames = middleLines
        .flatMap(l => l.split(','))
        .map(u => u.trim().toLowerCase())
        .filter(u => u.length > 0);
      if (usernames.length > 0) {
        username = usernames[0];
      }
    }

    return {
      accountName,
      mode: 'date_range',
      username,
      dateStart: dateMatch[1],
      dateEnd: dateMatch[2],
    };
  } else {
    // === OLD USER MODE (no dates, all lines after header = usernames) ===
    const usernames = nonEmptyLines.slice(1)
      .flatMap(l => l.split(','))
      .map(u => u.trim().toLowerCase())
      .filter(u => u.length > 0);

    if (usernames.length === 0) return null; // Need at least 1 username

    return {
      accountName,
      mode: 'old_user',
      usernames,
    };
  }
}

// ============================================================
// TARIK DB Command Processor
// ============================================================

/**
 * Process a TARIK DB command from Telegram.
 * Supports NUKE and VICTORY providers. Auto-starts bot if not running.
 */
async function processTarikDbCommand(
  chatId: number | string,
  messageId: number,
  command: ParsedTarikDbCommand,
  senderName: string,
): Promise<void> {
  const { account, browserRunning } = await findAccountByName(command.accountName, 'TARIKDB');

  if (!account) {
    await sendTelegramMessageToChat(
      chatId,
      `❌ <b>Account "${command.accountName}" tidak ditemukan di database.</b>\n` +
      `Pastikan nama account sudah benar dan feature = TARIKDB.`,
      messageId,
    );
    return;
  }

  const provider = account.provider;
  const isOldUser = command.mode === 'old_user';
  const dateDisplay = isOldUser ? 'Old User' : `${command.dateStart} s/d ${command.dateEnd}`;

  const broadcast = (global as any).wsBroadcast;
  const onLog = (msg: string, level: string = 'info') => {
    logger.info(`[TG][TARIKDB][${provider}] ${msg}`);
    if (broadcast) {
      broadcast({
        type: 'BOT_LOG',
        data: { accountId: account.id, provider, message: `[Telegram TARIKDB] ${msg}`, level },
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

    const loginOk = await waitForBotReady(account.id, onLog, 60000);

    if (!loginOk) {
      const freshAccount = await prisma.account.findUnique({ where: { id: account.id } });
      if (freshAccount?.status === 'waiting_otp') {
        await sendTelegramMessageToChat(
          chatId,
          `🔐 <b>Bot "${account.name}" membutuhkan OTP.</b>\n` +
          `Silakan submit OTP melalui panel → http://localhost:6969\n` +
          `Setelah OTP berhasil, kirim ulang command TARIK DB.`,
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
  let ackInfo: string;
  if (isOldUser) {
    ackInfo = `Mode: <b>Old User</b>\nTarget: <b>${command.usernames!.join(', ')}</b>`;
  } else {
    const modeLabel = command.username ? `Username: <b>${command.username}</b>` : '<b>Semua member</b>';
    ackInfo = `${modeLabel}\nTanggal: <b>${dateDisplay}</b>`;
  }
  await sendTelegramMessageToChat(
    chatId,
    `⏳ <b>TARIK DB dimulai</b>\n` +
    `Account: <b>${account.name}</b> (${provider})\n` +
    `${ackInfo}\n\n` +
    `Mohon tunggu, sedang memproses...`,
    messageId,
  );

  onLog(`TARIK DB command from ${senderName}: ${isOldUser ? `old_user [${command.usernames!.join(',')}]` : `${command.username || 'ALL'} ${dateDisplay}`}`);

  // === Run TARIK DB check ===
  const automationService = await getAutomationService();

  const result: TarikDbCheckResult = await automationService.checkTarikDb(account.id, {
    dateStart: command.dateStart,
    dateEnd: command.dateEnd,
    username: command.username,
    usernames: command.usernames,
    maxPages: isOldUser ? 1 : 10,
  });

  // Format and send results
  const resultMsg = formatTarikDbResultMessage(result.rows, command, dateDisplay, senderName, account.name, provider);
  await sendTelegramMessageToChat(chatId, resultMsg, messageId);

  // Export Excel and send as document
  if (result.success && result.rows.length > 0) {
    try {
      const excelPath = await automationService.exportTarikDbExcel(account.id);
      await sendTelegramDocumentToChat(
        chatId,
        excelPath,
        `📎 TARIK DB Report - ${account.name} (${provider}) - ${dateDisplay}`,
        messageId,
      );
      onLog('Excel sent to Telegram');
    } catch (e) {
      onLog(`Excel export/send failed: ${e}`, 'warning');
    }
  }

  onLog(`TARIK DB complete: ${result.rows.length} member(s)`, 'success');

  // Auto-close browser
  try {
    await automationService.stopBot(account.id);
    onLog(`Browser closed for "${account.name}" (session saved)`);
  } catch (e) {
    logger.warn(`Failed to auto-close browser: ${e}`);
  }
}

/**
 * Format TARIK DB results for Telegram reply.
 * Sorts: REGIS + DEPO first, then REGIS ONLY (matching Python reference behavior).
 */
export function formatTarikDbResultMessage(
  rows: TarikDbRow[],
  command: ParsedTarikDbCommand,
  dateDisplay: string,
  senderName: string,
  accountName: string,
  provider: string,
): string {
  const isOldUser = command.mode === 'old_user';

  // Sort: REGIS + DEPO first, then REGIS ONLY, then NOT FOUND
  const sorted = [...rows].sort((a, b) => {
    const priority = (s: string) => s.includes('DEPO') ? 0 : s.includes('NOT FOUND') ? 2 : 1;
    return priority(a.status) - priority(b.status);
  });

  const regisDepoCount = sorted.filter(r => r.status.includes('DEPO')).length;
  const notFoundCount = sorted.filter(r => r.status.includes('NOT FOUND')).length;
  const regisOnlyCount = sorted.length - regisDepoCount - notFoundCount;

  let msg = `📊 <b>TARIK DB Report${isOldUser ? ' (Old User)' : ''}</b>\n`;
  msg += `Account: <b>${accountName}</b> (${provider})\n`;
  if (!isOldUser) msg += `Tanggal: <b>${dateDisplay}</b>\n`;
  if (command.username) msg += `Username: <b>${command.username}</b>\n`;
  msg += `Diminta: <b>${senderName}</b>\n\n`;

  if (sorted.length === 0) {
    msg += `<i>Tidak ada data member ditemukan.</i>`;
    return msg;
  }

  msg += `✅ <b>${regisDepoCount}</b> REGIS+DEPO\n`;
  msg += `⚪ <b>${regisOnlyCount}</b> REGIS ONLY\n`;
  if (notFoundCount > 0) msg += `❓ <b>${notFoundCount}</b> NOT FOUND\n`;
  msg += `\n`;

  msg += `<pre>`;
  msg += `${'Username'.padEnd(16)} ${'Phone'.padEnd(15)} ${'Status'.padEnd(14)}\n`;
  msg += `${'─'.repeat(46)}\n`;

  const maxShow = Math.min(sorted.length, 50);
  for (let i = 0; i < maxShow; i++) {
    const r = sorted[i];
    const statusShort = r.status.includes('DEPO') ? 'REGIS+DEPO' : r.status.includes('NOT FOUND') ? 'NOT FOUND' : 'REGIS ONLY';
    msg += `${r.username.substring(0, 15).padEnd(16)} ${r.phone.substring(0, 14).padEnd(15)} ${statusShort.padEnd(14)}\n`;
  }

  if (sorted.length > maxShow) {
    msg += `... dan ${sorted.length - maxShow} lainnya\n`;
  }
  msg += `</pre>`;

  msg += `\nTotal: <b>${sorted.length}</b> member(s)`;

  return msg;
}

/**
 * Format wallet value with thousand separator
 */
function formatWallet(val: string): string {
  const num = parseFloat(val.replace(/,/g, ''));
  if (isNaN(num)) return val;
  return num.toLocaleString('id-ID');
}

/**
 * Find an account by name (case-insensitive), filtered by feature.
 * Returns the account + whether browser is running.
 */
async function findAccountByName(name: string, feature?: string): Promise<{
  account: { id: number; name: string; panelUrl: string; provider: string; status: string } | null;
  browserRunning: boolean;
}> {
  const where: any = { isActive: true };
  if (feature) where.feature = feature;
  const accounts = await prisma.account.findMany({
    where,
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
export async function waitForBotReady(accountId: number, onLog: (msg: string, level?: string) => void, timeoutMs: number = 60000): Promise<boolean> {
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
  const { account, browserRunning } = await findAccountByName(command.accountName, 'NTO');

  if (!account) {
    await sendTelegramMessageToChat(
      chatId,
      `❌ <b>Account "${command.accountName}" tidak ditemukan di database.</b>\n` +
      `Pastikan nama account sudah benar dan feature = NTO.`,
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
  const mappedCategory = provider === 'PAY4D'
    ? PAY4D_CATEGORY_MAP[command.gameCategory] || 'Slots'
    : command.gameCategory as GameCategory;

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
    // Victory: Username + Valid Bet (summed from matching game category providers)
    msg += `<pre>`;
    msg += `${'Username'.padEnd(16)} ${'Prov'.padStart(5)} ${'Valid Bet'.padStart(15)}\n`;
    msg += `${'─'.repeat(38)}\n`;

    for (const r of rows) {
      msg += `${r.username.substring(0, 15).padEnd(16)} ${r.betCount.padStart(5)} ${r.userTO.padStart(15)}\n`;
    }
    msg += `</pre>`;

    const valid = rows.filter(r => r.userTO !== 'ERR');
    if (valid.length > 1) {
      const totalValidBet = valid.reduce((s, r) => s + parseFloat(r.userTO.replace(/[.,]/g, (m) => m === '.' ? '' : '.') || '0'), 0);
      msg += `\n<b>Total Valid Bet: ${totalValidBet.toLocaleString('id-ID')}</b>`;
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

// Pending TARIK DB approval request
interface PendingTarikDbRequest {
  accountName: string;
  usernames?: string[];
  username?: string;
  dateStart?: string;
  dateEnd?: string;
  mode: 'date_range' | 'old_user';
  requestedBy: { id: number; username: string; firstName: string };
  requestedAt: Date;
  messageId: number;
  chatId: number | string;
  originalMessageId: number;
}

class TelegramListener {
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;
  private pendingRequests = new Map<string, PendingTarikDbRequest>();

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
    logger.info('Telegram bot listener started (long polling, unified NTO + TARIK DB)');

    const broadcast = (global as any).wsBroadcast;
    if (broadcast) {
      broadcast({
        type: 'BOT_LOG',
        data: { accountId: 0, provider: 'SYSTEM', message: 'Telegram bot listener started (NTO + TARIK DB)', level: 'success' },
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
        allowed_updates: ['message', 'callback_query'],
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

      if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      } else if (update.message?.text) {
        await this.handleMessage(update.message);
      }
    }
  }

  /**
   * Get admin user IDs from database setting.
   * Empty array = all users are admin (no approval needed).
   */
  private async getAdminUserIds(): Promise<number[]> {
    try {
      const setting = await prisma.setting.findUnique({ where: { key: 'notification.adminUserIds' } });
      if (!setting?.value) return [];
      const parsed = JSON.parse(setting.value);
      return Array.isArray(parsed) ? parsed.map(Number).filter(n => !isNaN(n)) : [];
    } catch {
      return [];
    }
  }

  /**
   * Handle inline keyboard callback queries (Approve/Cancel for TARIK DB).
   */
  private async handleCallbackQuery(callbackQuery: any): Promise<void> {
    const config = await getTelegramConfig();
    if (!config) return;

    const userId = callbackQuery.from?.id;
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;
    const callbackData = callbackQuery.data as string;
    const clickerName = callbackQuery.from?.first_name || callbackQuery.from?.username || 'Unknown';

    if (!callbackData || !chatId || !messageId) return;

    // Parse callback data: "approve_tdb_XXXXX" or "cancel_tdb_XXXXX"
    const parts = callbackData.split('_');
    if (parts.length < 3 || parts[1] !== 'tdb') return;

    const action = parts[0]; // "approve" or "cancel"
    const requestId = parts.slice(2).join('_'); // rejoin in case requestId has underscores

    // Check admin authorization
    const adminIds = await this.getAdminUserIds();
    if (adminIds.length > 0 && !adminIds.includes(userId)) {
      await answerCallbackQuery(config.botToken, callbackQuery.id, 'Hanya admin yang bisa approve/cancel', true);
      return;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      await answerCallbackQuery(config.botToken, callbackQuery.id, 'Request sudah expired atau sudah diproses', true);
      return;
    }

    if (action === 'approve') {
      await answerCallbackQuery(config.botToken, callbackQuery.id, 'Approved! Processing...', false);
      await editMessageText(
        chatId,
        messageId,
        `✅ <b>TARIK DB Approved</b> oleh <b>${clickerName}</b>\n\n` +
        `Account: <b>${pending.accountName}</b>\n` +
        `Mode: <b>${pending.mode === 'old_user' ? 'Old User' : 'Date Range'}</b>\n` +
        `Processing...`,
      );

      this.pendingRequests.delete(requestId);

      // Build command and execute
      const command: ParsedTarikDbCommand = {
        accountName: pending.accountName,
        mode: pending.mode,
        username: pending.username,
        usernames: pending.usernames,
        dateStart: pending.dateStart,
        dateEnd: pending.dateEnd,
      };

      const senderName = pending.requestedBy.firstName || pending.requestedBy.username || 'Unknown';

      queueForAccount(command.accountName, async () => {
        try {
          await processTarikDbCommand(pending.chatId, pending.originalMessageId, command, senderName);
        } catch (err) {
          logger.error(`Approved TARIKDB command error: ${err}`);
          await sendTelegramMessageToChat(
            pending.chatId,
            `❌ <b>Error:</b> ${err instanceof Error ? err.message : String(err)}`,
            pending.originalMessageId,
          ).catch(() => {});
        }
      });

    } else if (action === 'cancel') {
      await answerCallbackQuery(config.botToken, callbackQuery.id, 'Cancelled', false);
      await editMessageText(
        chatId,
        messageId,
        `❌ <b>TARIK DB Cancelled</b> oleh <b>${clickerName}</b>\n\n` +
        `Account: <b>${pending.accountName}</b>\n` +
        `Request dari: <b>${pending.requestedBy.firstName}</b>`,
      );
      this.pendingRequests.delete(requestId);
    }
  }

  /**
   * Send an approval request message with Approve/Cancel inline keyboard.
   */
  private async sendApprovalRequest(
    chatId: number | string,
    originalMessageId: number,
    command: ParsedTarikDbCommand,
    from: any,
  ): Promise<void> {
    const requestId = Date.now().toString(36);
    const senderName = from?.first_name || from?.username || 'Unknown';
    const senderUsername = from?.username ? `@${from.username}` : senderName;

    let targetInfo: string;
    if (command.mode === 'old_user') {
      targetInfo = `Mode: <b>Old User</b>\nTarget: <b>${command.usernames!.join(', ')}</b>`;
    } else {
      const dateDisplay = `${command.dateStart} s/d ${command.dateEnd}`;
      targetInfo = `Mode: <b>Date Range</b>\nTanggal: <b>${dateDisplay}</b>`;
      if (command.username) targetInfo += `\nUsername: <b>${command.username}</b>`;
    }

    const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const text =
      `🔐 <b>TARIK DB Request</b>\n\n` +
      `Dari: <b>${senderUsername}</b> (ID: ${from?.id})\n` +
      `Waktu: <b>${now}</b>\n` +
      `Account: <b>${command.accountName}</b>\n` +
      `${targetInfo}\n\n` +
      `<i>Menunggu approval admin...</i>`;

    const result = await sendTelegramMessageWithKeyboard(
      text,
      [[
        { text: '✅ Approve', callback_data: `approve_tdb_${requestId}` },
        { text: '❌ Cancel', callback_data: `cancel_tdb_${requestId}` },
      ]],
      chatId,
      originalMessageId,
    );

    if (result.ok && result.messageId) {
      this.pendingRequests.set(requestId, {
        accountName: command.accountName,
        usernames: command.usernames,
        username: command.username,
        dateStart: command.dateStart,
        dateEnd: command.dateEnd,
        mode: command.mode,
        requestedBy: {
          id: from?.id || 0,
          username: from?.username || '',
          firstName: from?.first_name || '',
        },
        requestedAt: new Date(),
        messageId: result.messageId,
        chatId,
        originalMessageId,
      });

      logger.info(`TARIK DB approval request created: ${requestId} from ${senderName}`);
    }
  }

  /**
   * Check if a chat ID matches the configured group for a command type.
   * If no specific chat ID is configured, allow from any group.
   */
  private async isChatAllowed(chatId: number | string, commandType: 'NTO' | 'TARIKDB'): Promise<boolean> {
    const config = await getTelegramConfig();
    if (!config) return false;

    const chatIdStr = String(chatId);

    if (commandType === 'NTO') {
      // NTO: must be from NTO group (notification.telegramChatId)
      // If no TARIK DB chat ID configured, allow NTO from NTO group only (backward compat)
      if (!config.chatIdTarikDb) return chatIdStr === config.chatId;
      return chatIdStr === config.chatId;
    } else {
      // TARIK DB: must be from TARIK DB group (notification.telegramChatIdTarikDb)
      // If no TARIK DB chat ID configured, allow from NTO group (backward compat)
      if (!config.chatIdTarikDb) return chatIdStr === config.chatId;
      return chatIdStr === config.chatIdTarikDb;
    }
  }

  private async handleMessage(message: any): Promise<void> {
    const text = message.text?.trim();
    if (!text) return;

    const chatId = message.chat.id;
    const messageId = message.message_id;
    const senderName = message.from?.first_name || message.from?.username || 'Unknown';

    logger.debug(`Telegram msg from ${senderName} in chat ${chatId}: "${text.substring(0, 80)}"`);

    // Strip leading bot command prefixes (/nto or /tarik + @botname)
    let cleanText = text;
    if (cleanText.match(/^\/tarik(db)?(@\S+)?\b/i)) {
      cleanText = cleanText.replace(/^\/tarik(db)?(@\S+)?\s*/i, '').trim();
    } else if (cleanText.match(/^\/nto(@\S+)?\b/i)) {
      cleanText = cleanText.replace(/^\/nto(@\S+)?\s*/i, '').trim();
    }

    const upper = cleanText.toUpperCase();

    // Route: TARIK DB keyword first (more specific), then NTO
    if (upper.includes('TARIKDB') || upper.includes('TARIK DB') || upper.includes('TARIK')) {
      // Check if this chat is allowed for TARIK DB commands
      if (!(await this.isChatAllowed(chatId, 'TARIKDB'))) {
        logger.debug(`TARIK DB command ignored from chat ${chatId} (wrong group)`);
        return;
      }
      logger.info(`Telegram [TARIKDB] command from ${senderName}: "${cleanText}"`);

      const tarikCommand = parseTarikDbCommand(cleanText);
      if (!tarikCommand) {
        await sendTelegramMessageToChat(
          chatId,
          `❌ <b>Format tidak valid.</b>\n\n` +
          `<b>Format 1 (targeted + tanggal):</b>\n` +
          `<code>Captain77 TARIK DB\nesia77\n01-03-2026:05-03-2026</code>\n\n` +
          `<b>Format 2 (semua member + tanggal):</b>\n` +
          `<code>Captain77 TARIK DB\n\n01-03-2026:05-03-2026</code>\n\n` +
          `<b>Format 3 (old user, tanpa tanggal):</b>\n` +
          `<code>Captain77 TARIK DB\nID1\nID2\nID3</code>`,
          messageId,
        );
        return;
      }

      // Check admin approval requirement
      const adminIds = await this.getAdminUserIds();
      const senderId = message.from?.id;
      const isAdmin = adminIds.length === 0 || adminIds.includes(senderId);
      const isPrivateChat = message.chat.type === 'private';

      if (isAdmin || isPrivateChat) {
        // Admin or private chat: execute directly
        queueForAccount(tarikCommand.accountName, async () => {
          try {
            await processTarikDbCommand(chatId, messageId, tarikCommand, senderName);
          } catch (err) {
            logger.error(`TARIKDB command error: ${err}`);
            await sendTelegramMessageToChat(
              chatId,
              `❌ <b>Error:</b> ${err instanceof Error ? err.message : String(err)}`,
              messageId,
            ).catch(() => {});
          }
        });
      } else {
        // Non-admin in group: send approval request
        await this.sendApprovalRequest(chatId, messageId, tarikCommand, message.from);
      }
    } else if (upper.includes('NTO')) {
      // Check if this chat is allowed for NTO commands
      if (!(await this.isChatAllowed(chatId, 'NTO'))) {
        logger.debug(`NTO command ignored from chat ${chatId} (wrong group)`);
        return;
      }

      logger.info(`Telegram [NTO] command from ${senderName}: "${cleanText}"`);

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
    // else: message doesn't contain NTO or TARIK keywords — ignore
  }
}

export const telegramListener = new TelegramListener();
// Backward compat aliases
export const ntoTelegramListener = telegramListener;
export const tarikdbTelegramListener = telegramListener;
