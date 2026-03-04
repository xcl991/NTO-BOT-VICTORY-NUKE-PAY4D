import fs from 'fs';
import path from 'path';
import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import type { NtoRow } from '../flows/nto-check-flow';

const TELEGRAM_API = 'https://api.telegram.org/bot';

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Get Telegram config from database settings
 */
export async function getTelegramConfig(): Promise<TelegramConfig | null> {
  const tokenSetting = await prisma.setting.findUnique({ where: { key: 'notification.telegramBotToken' } });
  const chatIdSetting = await prisma.setting.findUnique({ where: { key: 'notification.telegramChatId' } });

  if (!tokenSetting?.value || !chatIdSetting?.value) {
    logger.warn('Telegram config not set (missing bot token or chat ID)');
    return null;
  }

  return { botToken: tokenSetting.value, chatId: chatIdSetting.value };
}

/**
 * Send a text message to Telegram group
 */
export async function sendTelegramMessage(text: string, replyToMessageId?: number): Promise<boolean> {
  const config = await getTelegramConfig();
  if (!config) return false;

  try {
    const url = `${TELEGRAM_API}${config.botToken}/sendMessage`;
    const body: any = {
      chat_id: config.chatId,
      text,
      parse_mode: 'HTML',
    };
    if (replyToMessageId) body.reply_to_message_id = replyToMessageId;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json() as any;
    if (!data.ok) {
      logger.error('Telegram sendMessage failed', { error: data.description });
      return false;
    }

    logger.info('Telegram message sent successfully');
    return true;
  } catch (error) {
    logger.error('Telegram send error', { error });
    return false;
  }
}

/**
 * Send a text message to a specific Telegram chat (for replies to different groups)
 */
export async function sendTelegramMessageToChat(chatId: string | number, text: string, replyToMessageId?: number): Promise<boolean> {
  const config = await getTelegramConfig();
  if (!config) return false;

  try {
    const url = `${TELEGRAM_API}${config.botToken}/sendMessage`;
    const body: any = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    };
    if (replyToMessageId) body.reply_to_message_id = replyToMessageId;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json() as any;
    if (!data.ok) {
      logger.error('Telegram sendMessageToChat failed', { error: data.description });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Telegram send to chat error', { error });
    return false;
  }
}

/**
 * Send a document to a specific chat
 */
export async function sendTelegramDocumentToChat(chatId: string | number, filePath: string, caption?: string, replyToMessageId?: number): Promise<boolean> {
  const config = await getTelegramConfig();
  if (!config) return false;

  try {
    const url = `${TELEGRAM_API}${config.botToken}/sendDocument`;
    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('document', new Blob([fileBuffer]), filename);
    if (caption) formData.append('caption', caption);
    if (replyToMessageId) formData.append('reply_to_message_id', String(replyToMessageId));
    formData.append('parse_mode', 'HTML');

    const res = await fetch(url, { method: 'POST', body: formData });
    const data = await res.json() as any;

    if (!data.ok) {
      logger.error('Telegram sendDocumentToChat failed', { error: data.description });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Telegram document to chat error', { error });
    return false;
  }
}

/**
 * Send a file (document) to Telegram group
 */
export async function sendTelegramDocument(filePath: string, caption?: string): Promise<boolean> {
  const config = await getTelegramConfig();
  if (!config) return false;

  try {
    const url = `${TELEGRAM_API}${config.botToken}/sendDocument`;
    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    const formData = new FormData();
    formData.append('chat_id', config.chatId);
    formData.append('document', new Blob([fileBuffer]), filename);
    if (caption) formData.append('caption', caption);
    formData.append('parse_mode', 'HTML');

    const res = await fetch(url, { method: 'POST', body: formData });
    const data = await res.json() as any;

    if (!data.ok) {
      logger.error('Telegram sendDocument failed', { error: data.description });
      return false;
    }

    logger.info(`Telegram document sent: ${filename}`);
    return true;
  } catch (error) {
    logger.error('Telegram document send error', { error });
    return false;
  }
}

/**
 * Send a photo (screenshot) to Telegram group
 */
export async function sendTelegramPhoto(filePath: string, caption?: string): Promise<boolean> {
  const config = await getTelegramConfig();
  if (!config) return false;

  try {
    const url = `${TELEGRAM_API}${config.botToken}/sendPhoto`;
    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    const formData = new FormData();
    formData.append('chat_id', config.chatId);
    formData.append('photo', new Blob([fileBuffer]), filename);
    if (caption) formData.append('caption', caption);
    formData.append('parse_mode', 'HTML');

    const res = await fetch(url, { method: 'POST', body: formData });
    const data = await res.json() as any;

    if (!data.ok) {
      logger.error('Telegram sendPhoto failed', { error: data.description });
      return false;
    }

    logger.info(`Telegram photo sent: ${filename}`);
    return true;
  } catch (error) {
    logger.error('Telegram photo send error', { error });
    return false;
  }
}

/**
 * Format NTO results as a Telegram message
 */
export function formatNtoTelegramMessage(
  rows: NtoRow[],
  options?: { provider?: string; accountName?: string; dateRange?: string; summary?: NtoRow },
): string {
  const provider = options?.provider || 'NUKE';
  const date = options?.dateRange || new Date().toISOString().split('T')[0];
  const account = options?.accountName || '';

  let msg = `<b>📊 NTO Report - ${provider}</b>\n`;
  if (account) msg += `Account: <b>${account}</b>\n`;
  msg += `Date: <b>${date}</b>\n`;
  msg += `Total: <b>${rows.length}</b> entries\n\n`;

  // Show top entries (limit to avoid message too long)
  const maxShow = Math.min(rows.length, 50);
  msg += `<pre>`;
  msg += `${'Username'.padEnd(18)} ${'Bet'.padStart(6)} ${'TO'.padStart(12)} ${'NTO'.padStart(12)}\n`;
  msg += `${'─'.repeat(50)}\n`;

  for (let i = 0; i < maxShow; i++) {
    const r = rows[i];
    msg += `${r.username.substring(0, 17).padEnd(18)} ${r.betCount.padStart(6)} ${r.userTO.padStart(12)} ${r.userNTO.padStart(12)}\n`;
  }

  if (rows.length > maxShow) {
    msg += `... and ${rows.length - maxShow} more\n`;
  }

  if (options?.summary) {
    msg += `${'─'.repeat(50)}\n`;
    msg += `${'SUMMARY'.padEnd(18)} ${options.summary.betCount.padStart(6)} ${options.summary.userTO.padStart(12)} ${options.summary.userNTO.padStart(12)}\n`;
  }
  msg += `</pre>`;

  return msg;
}

/**
 * Send NTO report to Telegram: text summary + Excel file
 */
export async function sendNtoReportToTelegram(
  rows: NtoRow[],
  excelPath?: string,
  screenshotPath?: string,
  options?: { provider?: string; accountName?: string; dateRange?: string; summary?: NtoRow },
): Promise<boolean> {
  // Send text summary
  const msg = formatNtoTelegramMessage(rows, options);
  const textSent = await sendTelegramMessage(msg);

  // Send Excel file if available
  if (excelPath && fs.existsSync(excelPath)) {
    const caption = `📎 NTO Report Excel - ${options?.provider || 'NUKE'} - ${options?.dateRange || 'today'}`;
    await sendTelegramDocument(excelPath, caption);
  }

  // Send screenshot if available
  if (screenshotPath && fs.existsSync(screenshotPath)) {
    const caption = `📸 NTO Report Screenshot - ${options?.provider || 'NUKE'}`;
    await sendTelegramPhoto(screenshotPath, caption);
  }

  return textSent;
}
