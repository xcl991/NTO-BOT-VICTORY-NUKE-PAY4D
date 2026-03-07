import { Router } from 'express';
import prisma from '../utils/prisma';
import { asyncHandler } from '../utils/errors';
import { validate, botStartSchema, botStopSchema, botStartAllSchema, botOtpSchema } from '../utils/validation';
import logger from '../utils/logger';
import { automationService } from '../automation';

const router = Router();

// POST /api/bot/start - start bot for a single account
router.post('/start', validate(botStartSchema), asyncHandler(async (req, res) => {
  const { accountId } = req.body;
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });

  logger.info(`Bot starting for account: ${account.name} (${account.provider})`);

  // Launch automation in background (don't await - it runs async)
  automationService.startBot(accountId).catch(err => {
    logger.error(`startBot error for account #${accountId}: ${err}`);
  });

  res.json({ success: true, message: `Bot starting for ${account.name}` });
}));

// POST /api/bot/stop
router.post('/stop', validate(botStopSchema), asyncHandler(async (req, res) => {
  const { accountId } = req.body;
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });

  await automationService.stopBot(accountId);

  res.json({ success: true });
}));

// POST /api/bot/start-all
router.post('/start-all', validate(botStartAllSchema), asyncHandler(async (req, res) => {
  const { provider } = req.body;
  const accounts = await prisma.account.findMany({ where: { provider, isActive: true } });

  // Launch all bots in background
  automationService.startAllBots(provider).catch(err => {
    logger.error(`startAllBots error for ${provider}: ${err}`);
  });

  res.json({ success: true, message: `Starting ${accounts.length} bots for ${provider}` });
}));

// POST /api/bot/stop-all
router.post('/stop-all', validate(botStartAllSchema), asyncHandler(async (req, res) => {
  const { provider } = req.body;

  const count = await automationService.stopAllBots(provider);

  res.json({ success: true, stopped: count });
}));

// GET /api/bot/status
router.get('/status', asyncHandler(async (req, res) => {
  const { provider } = req.query;
  const where = provider ? { provider: String(provider), status: { notIn: ['idle', 'stopped'] as string[] } } : { status: { notIn: ['idle', 'stopped'] as string[] } };
  const accounts = await prisma.account.findMany({
    where,
    select: { id: true, provider: true, name: true, status: true, lastNto: true, lastError: true },
  });
  res.json({ success: true, data: accounts });
}));

// POST /api/bot/submit-otp
router.post('/submit-otp', validate(botOtpSchema), asyncHandler(async (req, res) => {
  const { accountId, otp } = req.body;
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });

  logger.info(`OTP submitted for ${account.name}`);

  await automationService.submitOtp(accountId, otp);

  res.json({ success: true });
}));

// GET /api/bot/screenshot/:accountId
router.get('/screenshot/:accountId', asyncHandler(async (req, res) => {
  const accountId = Number(req.params.accountId);
  const filePath = await automationService.screenshot(accountId);
  if (!filePath) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No browser running or screenshot failed' } });
  res.json({ success: true, data: { path: filePath } });
}));

export default router;
