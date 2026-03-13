import { Router } from 'express';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { asyncHandler } from '../utils/errors';
import { validate, settingUpdateSchema } from '../utils/validation';
import { telegramListener } from '../automation/utils/telegram-listener';
import { tarikdbScheduler } from '../automation/utils/tarikdb-scheduler';
import { livereportScheduler } from '../automation/utils/livereport-scheduler';
import { unifiedSPScheduler } from '../automation/utils/summary-performance-scheduler';

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
  'notification.telegramChatIdLiveReport': { value: '', type: 'string' },
  'livereport.scheduler.enabled': { value: 'false', type: 'boolean' },
  'livereport.scheduler.interval': { value: '60', type: 'number' },
  'livereport.scheduler.accountIds': { value: '[]', type: 'json' },
  'livereport.scheduler.dailyRecapTime': { value: '00:10', type: 'string' },
  'livereport.scheduler.weeklyRecap': { value: 'true', type: 'boolean' },
  'livereport.scheduler.monthlyRecap': { value: 'true', type: 'boolean' },
  'notification.telegramChatIdGantiNomor': { value: '', type: 'string' },
  'notification.telegramChatIdSummaryPerformance': { value: '', type: 'string' },
  'livereport.nameMapping': { value: '{}', type: 'json' },
  'livereport.blacklist': { value: '[]', type: 'json' },
  // Summary Performance unified scheduler
  'summaryperformance.scheduler.enabled': { value: 'false', type: 'boolean' },
  'summaryperformance.scheduler.interval': { value: '60', type: 'number' },
  'summaryperformance.nuke.scheduler.accountIds': { value: '[]', type: 'json' },
  'summaryperformance.victory.scheduler.accountIds': { value: '[]', type: 'json' },
  'summaryperformance.pay4d.scheduler.accountIds': { value: '[]', type: 'json' },
};

// GET /api/settings
router.get('/', asyncHandler(async (_req, res) => {
  let settings = await prisma.setting.findMany();

  // Seed missing defaults (handles both fresh install and upgrades)
  const existingKeys = new Set(settings.map(s => s.key));
  let seeded = false;
  for (const [key, { value, type }] of Object.entries(DEFAULT_SETTINGS)) {
    if (!existingKeys.has(key)) {
      await prisma.setting.create({ data: { key, value, type } });
      seeded = true;
    }
  }
  if (seeded) {
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

// --- Live Report Scheduler Control ---

router.post('/livereport-scheduler/start', asyncHandler(async (_req, res) => {
  if (livereportScheduler.isRunning()) {
    return res.json({ success: true, message: 'Live Report scheduler already running' });
  }
  livereportScheduler.start();
  res.json({ success: true, message: 'Live Report scheduler started' });
}));

router.post('/livereport-scheduler/stop', asyncHandler(async (_req, res) => {
  livereportScheduler.stop();
  res.json({ success: true, message: 'Live Report scheduler stopped' });
}));

router.get('/livereport-scheduler/status', asyncHandler(async (_req, res) => {
  const lastRunSetting = await prisma.setting.findUnique({ where: { key: 'livereport.scheduler.lastRun' } });
  let lastRun = null;
  try { lastRun = lastRunSetting?.value ? JSON.parse(lastRunSetting.value) : null; } catch { /* ignore */ }

  const intervalSetting = await prisma.setting.findUnique({ where: { key: 'livereport.scheduler.interval' } });

  res.json({
    success: true,
    data: {
      running: livereportScheduler.isRunning(),
      executing: livereportScheduler.isExecuting(),
      lastRun,
      intervalMinutes: parseInt(intervalSetting?.value || '60', 10),
    },
  });
}));

router.post('/livereport-scheduler/run-now', asyncHandler(async (req, res) => {
  if (livereportScheduler.isExecuting()) {
    return res.status(409).json({ success: false, error: { code: 'BUSY', message: 'Live Report scheduler is already executing' } });
  }
  const recapType = req.body?.recapType as 'daily' | 'weekly' | 'monthly' | undefined;
  const accountId = req.body?.accountId ? Number(req.body.accountId) : undefined;
  livereportScheduler.runNow(recapType, accountId).catch(e => logger.error(`[LiveReport] runNow error: ${e}`));
  const msg = accountId ? `Live Report triggered for account #${accountId}` : 'Live Report triggered, running in background';
  res.json({ success: true, message: msg });
}));

// --- Name Mapping Upload (Excel) ---

router.post('/livereport-namemapping/upload', asyncHandler(async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No file uploaded' } });
  }

  const file = req.files.file as any;
  if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Only .xlsx files accepted' } });
  }

  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    if (file.tempFilePath) {
      await wb.xlsx.readFile(file.tempFilePath);
    } else {
      await wb.xlsx.load(file.data);
    }

    const ws = wb.worksheets[0];
    if (!ws) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No worksheet found' } });
    }

    // Load existing mapping to merge
    const existing = await prisma.setting.findUnique({ where: { key: 'livereport.nameMapping' } });
    let mapping: Record<string, string> = {};
    try { mapping = JSON.parse(existing?.value || '{}'); } catch { }

    let imported = 0;
    ws.eachRow((row: any) => {
      const realName = String(row.getCell(1).value || '').trim();
      const username = String(row.getCell(2).value || '').trim().toLowerCase();
      if (realName && username) {
        mapping[username] = realName;
        imported++;
      }
    });

    await prisma.setting.upsert({
      where: { key: 'livereport.nameMapping' },
      update: { value: JSON.stringify(mapping) },
      create: { key: 'livereport.nameMapping', value: JSON.stringify(mapping), type: 'json' },
    });

    res.json({ success: true, data: { imported, total: Object.keys(mapping).length } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ success: false, error: { code: 'PARSE_ERROR', message: `Failed to parse Excel: ${msg}` } });
  }
}));

// --- GANTI NOMOR Listener Control (v1.9.0: routes to unified listener) ---

router.post('/gantinomor-listener/start', asyncHandler(async (_req, res) => {
  if (telegramListener.isRunning()) {
    return res.json({ success: true, message: 'Unified listener already running (includes GANTI NOMOR)' });
  }
  await telegramListener.start();
  res.json({ success: true, message: 'Unified listener started (includes GANTI NOMOR)' });
}));

router.post('/gantinomor-listener/stop', asyncHandler(async (_req, res) => {
  telegramListener.stop();
  res.json({ success: true, message: 'Unified listener stopped' });
}));

router.get('/gantinomor-listener/status', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { running: telegramListener.isRunning() } });
}));

// --- Summary Performance Scheduler Control (unified) ---

router.post('/sp-scheduler/start', asyncHandler(async (_req, res) => {
  if (unifiedSPScheduler.isRunning()) {
    return res.json({ success: true, message: 'Summary Performance scheduler already running' });
  }
  unifiedSPScheduler.start();
  res.json({ success: true, message: 'Summary Performance scheduler started' });
}));

router.post('/sp-scheduler/stop', asyncHandler(async (_req, res) => {
  unifiedSPScheduler.stop();
  res.json({ success: true, message: 'Summary Performance scheduler stopped' });
}));

router.get('/sp-scheduler/status', asyncHandler(async (_req, res) => {
  const lastRunSetting = await prisma.setting.findUnique({ where: { key: 'summaryperformance.scheduler.lastRun' } });
  let lastRun = null;
  try { lastRun = lastRunSetting?.value ? JSON.parse(lastRunSetting.value) : null; } catch { /* ignore */ }

  const intervalSetting = await prisma.setting.findUnique({ where: { key: 'summaryperformance.scheduler.interval' } });

  res.json({
    success: true,
    data: {
      running: unifiedSPScheduler.isRunning(),
      executing: unifiedSPScheduler.isExecuting(),
      lastRun,
      intervalMinutes: parseInt(intervalSetting?.value || '60', 10),
    },
  });
}));

router.post('/sp-scheduler/run-now', asyncHandler(async (_req, res) => {
  if (unifiedSPScheduler.isExecuting()) {
    return res.status(409).json({ success: false, error: { code: 'BUSY', message: 'Summary Performance scheduler is already executing' } });
  }
  unifiedSPScheduler.runNow().catch(e => logger.error(`[SP] runNow error: ${e}`));
  res.json({ success: true, message: 'Summary Performance triggered, running in background' });
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
