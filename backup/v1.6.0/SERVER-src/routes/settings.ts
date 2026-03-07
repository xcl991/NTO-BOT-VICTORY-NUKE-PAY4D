import { Router } from 'express';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { asyncHandler } from '../utils/errors';
import { validate, settingUpdateSchema } from '../utils/validation';
import { telegramListener } from '../automation/utils/telegram-listener';
import { tarikdbScheduler } from '../automation/utils/tarikdb-scheduler';

const router = Router();

const DEFAULT_SETTINGS: Record<string, { value: string; type: string }> = {
  'browser.headless': { value: 'false', type: 'boolean' },
  'browser.slowMo': { value: '100', type: 'number' },
  'nto.checkInterval': { value: '30', type: 'number' },
  'nto.autoCheck': { value: 'true', type: 'boolean' },
  'notification.enabled': { value: 'false', type: 'boolean' },
  'notification.telegramBotToken': { value: '', type: 'string' },
  'notification.telegramChatId': { value: '', type: 'string' },
  'tarikdb.scheduler.enabled': { value: 'false', type: 'boolean' },
  'tarikdb.scheduler.time': { value: '08:00', type: 'string' },
  'tarikdb.scheduler.accountIds': { value: '[]', type: 'json' },
  'notification.adminUserIds': { value: '[]', type: 'json' },
  'notification.telegramChatIdTarikDb': { value: '', type: 'string' },
};

// GET /api/settings
router.get('/', asyncHandler(async (_req, res) => {
  let settings = await prisma.setting.findMany();

  // Seed defaults if empty
  if (settings.length === 0) {
    for (const [key, { value, type }] of Object.entries(DEFAULT_SETTINGS)) {
      await prisma.setting.create({ data: { key, value, type } });
    }
    settings = await prisma.setting.findMany();
  }

  res.json({ success: true, data: settings });
}));

// --- Telegram Listener Control (MUST be before /:key to avoid route conflicts) ---

// Feature-specific routes kept for backward compat — all point to same unified listener
router.post('/telegram/:feature/start', asyncHandler(async (_req, res) => {
  if (telegramListener.isRunning()) {
    return res.json({ success: true, message: 'Telegram listener already running' });
  }
  await telegramListener.start();
  res.json({ success: true, message: 'Telegram listener started' });
}));

router.post('/telegram/:feature/stop', asyncHandler(async (_req, res) => {
  telegramListener.stop();
  res.json({ success: true, message: 'Telegram listener stopped' });
}));

router.get('/telegram/:feature/status', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { running: telegramListener.isRunning() } });
}));

// Unified routes: /api/settings/telegram/start|stop|status
router.post('/telegram/start', asyncHandler(async (_req, res) => {
  if (telegramListener.isRunning()) {
    return res.json({ success: true, message: 'Telegram listener already running' });
  }
  await telegramListener.start();
  res.json({ success: true, message: 'Telegram listener started' });
}));

router.post('/telegram/stop', asyncHandler(async (_req, res) => {
  telegramListener.stop();
  res.json({ success: true, message: 'Telegram listener stopped' });
}));

router.get('/telegram/status', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { running: telegramListener.isRunning() } });
}));

// --- TARIK DB Scheduler Control ---

router.post('/tarikdb-scheduler/start', asyncHandler(async (_req, res) => {
  if (tarikdbScheduler.isRunning()) {
    return res.json({ success: true, message: 'Scheduler already running' });
  }
  tarikdbScheduler.start();
  res.json({ success: true, message: 'Scheduler started' });
}));

router.post('/tarikdb-scheduler/stop', asyncHandler(async (_req, res) => {
  tarikdbScheduler.stop();
  res.json({ success: true, message: 'Scheduler stopped' });
}));

router.get('/tarikdb-scheduler/status', asyncHandler(async (_req, res) => {
  const lastRunSetting = await prisma.setting.findUnique({ where: { key: 'tarikdb.scheduler.lastRun' } });
  let lastRun = null;
  try { lastRun = lastRunSetting?.value ? JSON.parse(lastRunSetting.value) : null; } catch { /* ignore */ }

  const timeSetting = await prisma.setting.findUnique({ where: { key: 'tarikdb.scheduler.time' } });

  res.json({
    success: true,
    data: {
      running: tarikdbScheduler.isRunning(),
      executing: tarikdbScheduler.isExecuting(),
      lastRun,
      scheduledTime: timeSetting?.value || '08:00',
    },
  });
}));

router.post('/tarikdb-scheduler/run-now', asyncHandler(async (_req, res) => {
  if (tarikdbScheduler.isExecuting()) {
    return res.status(409).json({ success: false, error: { code: 'BUSY', message: 'Scheduler is already executing' } });
  }
  // Run in background, don't await
  tarikdbScheduler.runNow().catch(e => logger.error(`[Scheduler] runNow error: ${e}`));
  res.json({ success: true, message: 'Scheduler triggered, running in background' });
}));

// --- 2Captcha Balance ---

// GET /api/settings/captcha/balance
router.get('/captcha/balance', asyncHandler(async (_req, res) => {
  const setting = await prisma.setting.findUnique({ where: { key: 'captcha_api_key' } });
  if (!setting?.value) {
    return res.json({ success: true, data: { balance: null, error: 'API key not configured' } });
  }

  try {
    const resp = await fetch(`http://2captcha.com/res.php?key=${setting.value}&action=getbalance&json=1`);
    const data = await resp.json() as { status: number; request: string };

    if (data.status === 1) {
      return res.json({ success: true, data: { balance: parseFloat(data.request) } });
    }
    res.json({ success: true, data: { balance: null, error: data.request } });
  } catch (e) {
    res.json({ success: true, data: { balance: null, error: String(e) } });
  }
}));

// --- 2Captcha Usage History ---

// GET /api/settings/captcha/history?limit=50
router.get('/captcha/history', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);

  const records = await prisma.captchaUsage.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const stats = await prisma.captchaUsage.aggregate({
    _count: { id: true },
    _sum: { cost: true },
    _avg: { cost: true },
  });

  res.json({
    success: true,
    data: {
      records,
      stats: {
        totalSolves: stats._count.id,
        totalCost: stats._sum.cost ?? 0,
        avgCost: stats._avg.cost ?? 0,
      },
    },
  });
}));

// --- Generic Settings CRUD (after specific routes) ---

// GET /api/settings/:key
router.get('/:key', asyncHandler(async (req, res) => {
  const key = String(req.params.key);
  const setting = await prisma.setting.findUnique({ where: { key } });
  if (!setting) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Setting not found' } });
  res.json({ success: true, data: setting });
}));

// PUT /api/settings/:key
router.put('/:key', validate(settingUpdateSchema), asyncHandler(async (req, res) => {
  const key = String(req.params.key);
  const { value, type } = req.body;
  const setting = await prisma.setting.upsert({
    where: { key },
    update: { value, ...(type ? { type } : {}) },
    create: { key, value, type: type || 'string' },
  });
  res.json({ success: true, data: setting });
}));

export default router;
