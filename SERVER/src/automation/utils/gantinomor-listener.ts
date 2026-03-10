import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import { contextManager } from '../browser/context-manager';
import { sendTelegramMessageToChat } from './telegram';
import { waitForBotReady } from './telegram-listener';

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

// Per-account command queue (keyed by accountId for bot-level queueing)
const accountQueues = new Map<string, Promise<void>>();

function queueForKey(key: string, fn: () => Promise<void>): void {
  const prev = accountQueues.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  accountQueues.set(key, next);
  next.finally(() => {
    if (accountQueues.get(key) === next) accountQueues.delete(key);
  });
}

// ============================================================
// Config
// ============================================================

interface GantiNomorConfig {
  botToken: string;
  chatId: string;
}

async function getGantiNomorConfig(): Promise<GantiNomorConfig | null> {
  const tokenSetting = await prisma.setting.findUnique({ where: { key: 'notification.telegramBotTokenGantiNomor' } });
  const chatIdSetting = await prisma.setting.findUnique({ where: { key: 'notification.telegramChatIdGantiNomor' } });

  if (!tokenSetting?.value || !chatIdSetting?.value) return null;
  return { botToken: tokenSetting.value, chatId: chatIdSetting.value };
}

// ============================================================
// Command Parser
// ============================================================

interface ParsedGantiNomorCommand {
  accountName: string;
  oldCs?: string;
  newCs?: string;
  oldMst?: string;
  newMst?: string;
}

function parseSingleCommand(text: string): ParsedGantiNomorCommand | null {
  const rawLines = text.trim().split('\n').map(l => l.trim());
  if (rawLines.length === 0) return null;

  const headerMatch = rawLines[0].match(/^(.+?)\s+GANTI\s*NOMOR$/i);
  if (!headerMatch) return null;

  const accountName = headerMatch[1].trim();
  let oldCs: string | undefined;
  let newCs: string | undefined;
  let oldMst: string | undefined;
  let newMst: string | undefined;

  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line) continue;
    const oldCsMatch = line.match(/^old\s+cs\s*:\s*(\d+)$/i);
    if (oldCsMatch) { oldCs = oldCsMatch[1]; continue; }
    const newCsMatch = line.match(/^new\s+cs\s*:\s*(\d+)$/i);
    if (newCsMatch) { newCs = newCsMatch[1]; continue; }
    const oldMstMatch = line.match(/^old\s+mst\s*:\s*(\d+)$/i);
    if (oldMstMatch) { oldMst = oldMstMatch[1]; continue; }
    const newMstMatch = line.match(/^new\s+mst\s*:\s*(\d+)$/i);
    if (newMstMatch) { newMst = newMstMatch[1]; continue; }
  }

  const hasCsPair = oldCs && newCs;
  const hasMstPair = oldMst && newMst;
  if (!hasCsPair && !hasMstPair) return null;
  return { accountName, oldCs, newCs, oldMst, newMst };
}

/**
 * Parse message text into one or more GANTI NOMOR commands.
 * Supports multi-command separated by `---`.
 */
function parseGantiNomorCommands(text: string): ParsedGantiNomorCommand[] {
  const blocks = text.split(/^-{3,}$/m).map(b => b.trim()).filter(Boolean);
  const commands: ParsedGantiNomorCommand[] = [];
  for (const block of blocks) {
    const cmd = parseSingleCommand(block);
    if (cmd) commands.push(cmd);
  }
  return commands;
}

// ============================================================
// Account Resolver
// ============================================================

interface ResolvedAccount {
  id: number;
  name: string;
  provider: string;
  panelUrl: string;
  status: string;
}

/**
 * Resolve account for a GANTI NOMOR command.
 * - Header "cutt.ly ganti nomor" → CUTTLY provider (any active CUTTLY GANTINOMOR account)
 * - Otherwise (e.g. "captain77 ganti nomor") → NUKE provider (match by account name)
 * No fallback between providers — explicit routing by command header.
 */
async function resolveAccount(accountName: string): Promise<{ account: ResolvedAccount; provider: 'NUKE' | 'CUTTLY' } | null> {
  const nameLower = accountName.toLowerCase().trim();
  const isCuttly = nameLower === 'cutt.ly' || nameLower === 'cuttly';

  if (isCuttly) {
    // CUTT.LY: use any active CUTTLY GANTINOMOR account
    const cuttlyAccount = await prisma.account.findFirst({
      where: { isActive: true, feature: 'GANTINOMOR', provider: 'CUTTLY' },
      select: { id: true, name: true, panelUrl: true, provider: true, status: true },
    });
    if (cuttlyAccount) {
      return { account: cuttlyAccount, provider: 'CUTTLY' };
    }
    return null;
  }

  // NUKE: match by account name
  const nukeAccounts = await prisma.account.findMany({
    where: { isActive: true, feature: 'GANTINOMOR', provider: 'NUKE' },
    select: { id: true, name: true, panelUrl: true, provider: true, status: true },
  });

  const nukeMatch = nukeAccounts.find(
    a => a.name.toLowerCase() === nameLower
      || a.name.toLowerCase().includes(nameLower)
      || nameLower.includes(a.name.toLowerCase())
  );
  if (nukeMatch) {
    return { account: nukeMatch, provider: 'NUKE' };
  }

  return null;
}

// ============================================================
// Bot Helper (start if not running)
// ============================================================

async function ensureBotRunning(
  account: ResolvedAccount,
  botToken: string,
  chatId: number | string,
  messageId: number,
  onLog: (msg: string, level?: string) => void,
): Promise<boolean> {
  const browserRunning = contextManager.isRunning(account.id);
  if (browserRunning) return true;

  await sendTelegramMessageToChat(chatId, `🚀 <b>Bot "${account.name}" belum running, starting otomatis...</b>\nMohon tunggu proses login...`, messageId, botToken);
  onLog(`Auto-starting bot for "${account.name}"...`);

  try {
    const automationService = await getAutomationService();
    await automationService.startBot(account.id);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await sendTelegramMessageToChat(chatId, `❌ <b>Gagal start bot "${account.name}":</b> ${errMsg}`, messageId, botToken);
    return false;
  }

  const loginOk = await waitForBotReady(account.id, onLog, 60000);
  if (!loginOk) {
    const freshAccount = await prisma.account.findUnique({ where: { id: account.id } });
    if (freshAccount?.status === 'waiting_otp') {
      await sendTelegramMessageToChat(chatId, `🔐 <b>Bot "${account.name}" membutuhkan OTP.</b>\nSilakan submit OTP melalui panel.`, messageId, botToken);
    } else {
      await sendTelegramMessageToChat(chatId, `❌ <b>Bot "${account.name}" gagal login.</b> (Status: ${freshAccount?.status})\nError: ${freshAccount?.lastError || 'unknown'}`, messageId, botToken);
    }
    return false;
  }

  onLog(`Bot "${account.name}" ready!`, 'success');
  return true;
}

// ============================================================
// Process Single Command
// ============================================================

async function processSingleCommand(
  botToken: string,
  chatId: number | string,
  messageId: number,
  command: ParsedGantiNomorCommand,
  account: ResolvedAccount,
  senderName: string,
  onLog: (msg: string, level?: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const page = contextManager.getPage(account.id);
  if (!page) {
    await sendTelegramMessageToChat(chatId, `❌ <b>Browser untuk "${account.name}" tidak ditemukan.</b>\nSilakan restart bot.`, messageId, botToken);
    return { success: false, error: 'Browser not found' };
  }

  // Acknowledgment
  const changeParts: string[] = [];
  if (command.oldCs && command.newCs) changeParts.push(`CS: <b>${command.oldCs}</b> → <b>${command.newCs}</b>`);
  if (command.oldMst && command.newMst) changeParts.push(`MST: <b>${command.oldMst}</b> → <b>${command.newMst}</b>`);

  await sendTelegramMessageToChat(
    chatId,
    `⏳ <b>GANTI NOMOR — ${command.accountName}</b>\nAccount: <b>${account.name}</b> (${account.provider})\n${changeParts.join('\n')}\n\nSedang memproses...`,
    messageId,
    botToken,
  );

  onLog(`[${command.accountName}] cs=${command.oldCs || '-'}→${command.newCs || '-'} mst=${command.oldMst || '-'}→${command.newMst || '-'}`);

  const automationService = await getAutomationService();
  const result = await automationService.changeNumber(account.id, {
    oldCs: command.oldCs, newCs: command.newCs,
    oldMst: command.oldMst, newMst: command.newMst,
  });

  if (result.success) {
    const doneParts: string[] = [];
    if (result.changed.cs) doneParts.push(`CS: <b>${command.oldCs}</b> → <b>${result.changed.cs}</b>`);
    if (result.changed.mst) doneParts.push(`MST: <b>${command.oldMst}</b> → <b>${result.changed.mst}</b>`);
    await sendTelegramMessageToChat(
      chatId,
      `✅ <b>${command.accountName} — Berhasil!</b>\n${doneParts.join('\n')}`,
      messageId,
      botToken,
    );
  } else {
    await sendTelegramMessageToChat(
      chatId,
      `❌ <b>${command.accountName} — Gagal</b>\nError: ${result.error}`,
      messageId,
      botToken,
    );
  }

  return { success: result.success, error: result.error };
}

// ============================================================
// Process All Commands from Message
// ============================================================

async function processGantiNomorMessage(
  botToken: string,
  chatId: number | string,
  messageId: number,
  commands: ParsedGantiNomorCommand[],
  senderName: string,
): Promise<void> {
  // Group commands by resolved account
  const nukeCommands: { command: ParsedGantiNomorCommand; account: ResolvedAccount }[] = [];
  const cuttlyCommands: { command: ParsedGantiNomorCommand; account: ResolvedAccount }[] = [];
  const failedCommands: string[] = [];

  for (const cmd of commands) {
    const resolved = await resolveAccount(cmd.accountName);
    if (!resolved) {
      failedCommands.push(cmd.accountName);
      continue;
    }
    if (resolved.provider === 'NUKE') {
      nukeCommands.push({ command: cmd, account: resolved.account });
    } else {
      cuttlyCommands.push({ command: cmd, account: resolved.account });
    }
  }

  if (failedCommands.length > 0) {
    await sendTelegramMessageToChat(
      chatId,
      `⚠️ <b>Account tidak ditemukan:</b> ${failedCommands.join(', ')}\n<i>Gunakan "cutt.ly GANTI NOMOR" untuk CUTT.LY atau nama akun NUKE (misal "Captain77 GANTI NOMOR")</i>`,
      messageId,
      botToken,
    );
  }

  const broadcast = (global as any).wsBroadcast;

  // Process NUKE commands (each has its own account, start/stop per account)
  for (const { command, account } of nukeCommands) {
    const onLog = (msg: string, level: string = 'info') => {
      logger.info(`[TG][GANTINOMOR][NUKE] ${msg}`);
      if (broadcast) broadcast({ type: 'BOT_LOG', data: { accountId: account.id, provider: 'NUKE', message: `[Telegram GANTINOMOR] ${msg}`, level } });
    };

    const ready = await ensureBotRunning(account, botToken, chatId, messageId, onLog);
    if (!ready) continue;

    await processSingleCommand(botToken, chatId, messageId, command, account, senderName, onLog);

    // Auto-close NUKE browser after each command
    try {
      const automationService = await getAutomationService();
      await automationService.stopBot(account.id);
      onLog(`Browser closed for "${account.name}" (session saved)`);
    } catch (e) {
      logger.warn(`Failed to auto-close NUKE browser: ${e}`);
    }
  }

  // Process CUTT.LY commands (all share one account, start once → process all → stop once)
  if (cuttlyCommands.length > 0) {
    const account = cuttlyCommands[0].account; // All CUTT.LY commands share same account
    const onLog = (msg: string, level: string = 'info') => {
      logger.info(`[TG][GANTINOMOR][CUTTLY] ${msg}`);
      if (broadcast) broadcast({ type: 'BOT_LOG', data: { accountId: account.id, provider: 'CUTTLY', message: `[Telegram GANTINOMOR] ${msg}`, level } });
    };

    const ready = await ensureBotRunning(account, botToken, chatId, messageId, onLog);
    if (ready) {
      const results: string[] = [];

      for (const { command } of cuttlyCommands) {
        const r = await processSingleCommand(botToken, chatId, messageId, command, account, senderName, onLog);
        results.push(`${command.accountName}: ${r.success ? '✅' : '❌'}`);
      }

      // Summary if multiple commands
      if (cuttlyCommands.length > 1) {
        await sendTelegramMessageToChat(
          chatId,
          `📋 <b>GANTI NOMOR Summary (CUTT.LY)</b>\n\n${results.join('\n')}\n\nDiminta: <b>${senderName}</b>`,
          messageId,
          botToken,
        );
      }

      // Auto-close CUTT.LY browser once after all commands
      try {
        const automationService = await getAutomationService();
        await automationService.stopBot(account.id);
        onLog(`Browser closed for "${account.name}" (session saved)`);
      } catch (e) {
        logger.warn(`Failed to auto-close CUTTLY browser: ${e}`);
      }
    }
  }

  // Final summary for mixed NUKE + CUTTLY
  if (nukeCommands.length > 0 && cuttlyCommands.length > 0) {
    onLogGlobal(`Processed ${nukeCommands.length} NUKE + ${cuttlyCommands.length} CUTT.LY commands from ${senderName}`);
  }
}

function onLogGlobal(msg: string) {
  logger.info(`[TG][GANTINOMOR] ${msg}`);
}

// ============================================================
// Telegram Listener (separate bot for GANTI NOMOR)
// ============================================================

class GantiNomorTelegramListener {
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('GANTI NOMOR listener already running');
      return;
    }

    const config = await getGantiNomorConfig();
    if (!config) {
      logger.warn('GANTI NOMOR listener: missing bot token or chat ID');
      return;
    }

    // Clear webhook and flush
    try {
      await fetch(`${TELEGRAM_API}${config.botToken}/deleteWebhook?drop_pending_updates=true`);
      await new Promise(r => setTimeout(r, 1000));
      const flush = await fetch(`${TELEGRAM_API}${config.botToken}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset: -1, limit: 1, timeout: 0 }),
      });
      const flushData = await flush.json() as any;
      if (flushData.ok && flushData.result?.length > 0) {
        this.offset = flushData.result[flushData.result.length - 1].update_id + 1;
      }
    } catch (e) {
      logger.warn(`GANTI NOMOR flush error (non-fatal): ${e}`);
    }

    this.running = true;
    logger.info('GANTI NOMOR Telegram listener started (long polling)');

    const broadcast = (global as any).wsBroadcast;
    if (broadcast) {
      broadcast({ type: 'BOT_LOG', data: { accountId: 0, provider: 'SYSTEM', message: 'GANTI NOMOR Telegram listener started', level: 'success' } });
    }

    this.pollLoop(config.botToken, config.chatId);
  }

  stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    logger.info('GANTI NOMOR Telegram listener stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async pollLoop(botToken: string, configChatId: string): Promise<void> {
    while (this.running) {
      try {
        await this.poll(botToken, configChatId);
      } catch (err) {
        if (!this.running) break;
        logger.warn(`GANTI NOMOR poll error: ${err}`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  private async poll(botToken: string, configChatId: string): Promise<void> {
    this.abortController = new AbortController();

    const url = `${TELEGRAM_API}${botToken}/getUpdates`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: this.offset, timeout: 30, allowed_updates: ['message'] }),
      signal: this.abortController.signal,
    });

    const data = await res.json() as any;
    if (!data.ok) {
      logger.error('GANTI NOMOR getUpdates failed', { error: data.description });
      await new Promise(r => setTimeout(r, 3000));
      return;
    }

    for (const update of (data.result || [])) {
      this.offset = update.update_id + 1;
      if (update.message?.text) {
        await this.handleMessage(update.message, botToken, configChatId);
      }
    }
  }

  private async handleMessage(message: any, botToken: string, configChatId: string): Promise<void> {
    const text = message.text?.trim();
    if (!text) return;

    const chatId = message.chat.id;
    const messageId = message.message_id;
    const senderName = message.from?.first_name || message.from?.username || 'Unknown';

    // Only accept from configured chat
    if (String(chatId) !== configChatId) {
      logger.debug(`GANTI NOMOR: ignoring message from chat ${chatId} (expected ${configChatId})`);
      return;
    }

    // Strip bot command prefix
    let cleanText = text;
    if (cleanText.match(/^\/ganti(nomor)?(@\S+)?\b/i)) {
      cleanText = cleanText.replace(/^\/ganti(nomor)?(@\S+)?\s*/i, '').trim();
    }

    const upper = cleanText.toUpperCase();
    if (!upper.includes('GANTI NOMOR') && !upper.includes('GANTINOMOR')) return;

    logger.info(`GANTI NOMOR command from ${senderName}: "${cleanText.substring(0, 120)}"`);

    // Parse all commands (supports --- separator for multiple)
    const commands = parseGantiNomorCommands(cleanText);
    if (commands.length === 0) {
      await sendTelegramMessageToChat(
        chatId,
        `❌ <b>Format tidak valid.</b>\n\n` +
        `<b>CUTT.LY (shortlink):</b>\n` +
        `<code>cutt.ly GANTI NOMOR\nold mst:62896688686\nnew mst:62898978987</code>\n\n` +
        `<b>NUKE (identity page):</b>\n` +
        `<code>Captain77 GANTI NOMOR\nold mst:62896688686\nnew mst:62898978987</code>\n\n` +
        `<b>Multi-command (pisah ---) :</b>\n` +
        `<code>cutt.ly GANTI NOMOR\nold mst:62896688686\nnew mst:62898978987\n---\nCaptain77 GANTI NOMOR\nold cs:676767\nnew cs:646464</code>\n\n` +
        `<i>Wajib ada pasangan old + new (minimal salah satu: cs atau mst)</i>`,
        messageId,
        botToken,
      );
      return;
    }

    logger.info(`Parsed ${commands.length} GANTI NOMOR command(s) from ${senderName}`);

    // Queue all commands from this message together (keyed by message to avoid interleaving)
    queueForKey(`msg_${messageId}`, async () => {
      try {
        await processGantiNomorMessage(botToken, chatId, messageId, commands, senderName);
      } catch (err) {
        logger.error(`GANTI NOMOR message error: ${err}`);
        await sendTelegramMessageToChat(chatId, `❌ <b>Error:</b> ${err instanceof Error ? err.message : String(err)}`, messageId, botToken).catch(() => {});
      }
    });
  }
}

export const gantiNomorListener = new GantiNomorTelegramListener();
