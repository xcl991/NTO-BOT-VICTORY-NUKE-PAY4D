import { Router } from 'express';
import path from 'path';
import prisma from '../utils/prisma';
import { asyncHandler } from '../utils/errors';
import { validate, ntoCheckSchema, ntoExportSchema, ntoTelegramSchema } from '../utils/validation';
import logger from '../utils/logger';
import { automationService } from '../automation';

const router = Router();

// GET /api/nto - list NTO results with filters
router.get('/', asyncHandler(async (req, res) => {
  const { provider, accountId, limit } = req.query;
  const where: any = {};
  if (provider) where.provider = String(provider);
  if (accountId) where.accountId = Number(accountId);

  const results = await prisma.ntoResult.findMany({
    where,
    include: { account: { select: { name: true, provider: true } } },
    orderBy: { checkedAt: 'desc' },
    take: Number(limit) || 50,
  });
  res.json({ success: true, data: results });
}));

// GET /api/nto/latest - latest NTO per account
router.get('/latest', asyncHandler(async (req, res) => {
  const { provider } = req.query;
  const where = provider ? { provider: String(provider) } : {};

  const accounts = await prisma.account.findMany({
    where,
    select: { id: true, name: true, provider: true, lastNto: true, status: true },
  });

  const latestResults = await Promise.all(
    accounts.map(async (acc) => {
      const latest = await prisma.ntoResult.findFirst({
        where: { accountId: acc.id },
        orderBy: { checkedAt: 'desc' },
      });
      return { ...acc, latestResult: latest };
    })
  );

  res.json({ success: true, data: latestResults });
}));

// GET /api/nto/stats
router.get('/stats', asyncHandler(async (_req, res) => {
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const [totalToday, totalAll, byProvider] = await Promise.all([
    prisma.ntoResult.count({ where: { checkedAt: { gte: today } } }),
    prisma.ntoResult.count(),
    Promise.all(['NUKE', 'VICTORY', 'PAY4D'].map(async (p) => ({
      provider: p,
      today: await prisma.ntoResult.count({ where: { provider: p, checkedAt: { gte: today } } }),
      total: await prisma.ntoResult.count({ where: { provider: p } }),
    }))),
  ]);
  res.json({ success: true, data: { totalToday, totalAll, byProvider } });
}));

// POST /api/nto/check - run NTO check for an account
router.post('/check', validate(ntoCheckSchema), asyncHandler(async (req, res) => {
  const { accountId, dateStart, dateEnd, usernames, gameCategory, maxPages } = req.body;
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });

  logger.info(`NTO check starting for account: ${account.name} (${gameCategory}, ${usernames.length} users)`);

  // Run NTO check in background
  automationService.checkNto(accountId, { dateStart, dateEnd, usernames, gameCategory, maxPages }).catch(err => {
    logger.error(`checkNto error for account #${accountId}: ${err}`);
  });

  res.json({ success: true, message: `NTO check starting for ${account.name} (${usernames.length} usernames)` });
}));

// POST /api/nto/export - export NTO results to Excel
router.post('/export', validate(ntoExportSchema), asyncHandler(async (req, res) => {
  const { accountId, ntoResultId } = req.body;
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });

  try {
    const filePath = await automationService.exportNtoExcel(accountId, ntoResultId);
    res.json({ success: true, data: { filePath, filename: path.basename(filePath) } });
  } catch (err: any) {
    res.status(400).json({ success: false, error: { code: 'EXPORT_ERROR', message: err.message } });
  }
}));

// GET /api/nto/download/:filename - download exported Excel file
router.get('/download/:filename', asyncHandler(async (req, res) => {
  const filename = String(req.params.filename);
  // Prevent path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_FILENAME', message: 'Invalid filename' } });
  }

  const filePath = path.join(__dirname, '../../../data/exports', filename);
  const fs = await import('fs');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'File not found' } });
  }

  res.download(filePath);
}));

// POST /api/nto/telegram - send NTO report to Telegram
router.post('/telegram', validate(ntoTelegramSchema), asyncHandler(async (req, res) => {
  const { accountId, ntoResultId } = req.body;
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });

  try {
    const sent = await automationService.sendNtoTelegram(accountId, ntoResultId);
    res.json({ success: true, data: { sent } });
  } catch (err: any) {
    res.status(400).json({ success: false, error: { code: 'TELEGRAM_ERROR', message: err.message } });
  }
}));

// GET /api/nto/result/:id - get a single NTO result with full row data
router.get('/result/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const result = await prisma.ntoResult.findUnique({
    where: { id },
    include: { account: { select: { name: true, provider: true } } },
  });
  if (!result) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'NTO result not found' } });

  // Parse raw data
  let parsed = null;
  if (result.rawData) {
    try { parsed = JSON.parse(result.rawData); } catch {}
  }

  res.json({ success: true, data: { ...result, parsed } });
}));

export default router;
