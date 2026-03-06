import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import logger from './utils/logger';
import { errorHandler } from './utils/errors';
import prisma from './utils/prisma';
import { telegramListener } from './automation/utils/telegram-listener';

// Routes
import accountsRouter from './routes/accounts';
import dashboardRouter from './routes/dashboard';
import botRouter from './routes/bot';
import ntoRouter from './routes/nto';
import settingsRouter from './routes/settings';

const app = express();
const server = createServer(app);
const PORT = Number(process.env.PORT) || 6969;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  if (!req.path.startsWith('/assets') && req.path !== '/favicon.ico') {
    logger.debug(`${req.method} ${req.path}`);
  }
  next();
});

// --- API Routes ---
app.use('/api/accounts', accountsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/bot', botRouter);
app.use('/api/nto', ntoRouter);
app.use('/api/settings', settingsRouter);

// System info
app.get('/api', async (_req, res) => {
  const [accounts, sessions, ntoResults] = await Promise.all([
    prisma.account.count(),
    prisma.botSession.count(),
    prisma.ntoResult.count(),
  ]);
  res.json({
    success: true,
    data: {
      name: 'BOT NTO',
      version: '1.0.0',
      uptime: process.uptime(),
      database: { accounts, sessions, ntoResults },
    },
  });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    },
  });
});

// --- Static files (Panel) ---
const panelDir = path.join(__dirname, '../../panel');
app.use(express.static(panelDir));
app.get('/', (_req, res) => res.sendFile(path.join(panelDir, 'index.html')));
// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(panelDir, 'index.html'));
});

// --- Error handler ---
app.use(errorHandler);

// --- WebSocket ---
const wss = new WebSocketServer({ server, path: '/ws' });
const wsClients = new Set<WebSocket>();

function wsBroadcast(data: any) {
  const msg = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// Expose broadcast globally for routes to use
(global as any).wsBroadcast = wsBroadcast;

wss.on('connection', (ws) => {
  wsClients.add(ws);
  logger.debug(`WebSocket client connected (total: ${wsClients.size})`);
  ws.on('close', () => {
    wsClients.delete(ws);
    logger.debug(`WebSocket client disconnected (total: ${wsClients.size})`);
  });
  ws.on('error', (err) => logger.warn('WebSocket error', { error: err.message }));
});

// --- Startup ---
function ensureDirectories() {
  const dirs = ['data', 'data/logs', 'data/screenshots', 'data/exports', 'profiles'];
  for (const dir of dirs) {
    const fullPath = path.join(__dirname, '../..', dir);
    if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
  }
}

async function start() {
  ensureDirectories();

  // Test database connection
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (err) {
    logger.error('Database connection failed', { error: err });
    process.exit(1);
  }

  server.listen(PORT, async () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════╗');
    console.log('  ║                                       ║');
    console.log('  ║         🤖 BOT NTO Panel v1.0         ║');
    console.log('  ║                                       ║');
    console.log(`  ║   → http://localhost:${PORT}             ║`);
    console.log('  ║                                       ║');
    console.log('  ║   Providers: NUKE │ VICTORY │ PAY4D   ║');
    console.log('  ║                                       ║');
    console.log('  ╚═══════════════════════════════════════╝');
    console.log('');
    logger.info(`Server running on port ${PORT}`);

    // Auto-start Telegram listener if bot token and chat ID are configured
    try {
      const botToken = await prisma.setting.findUnique({ where: { key: 'notification.telegramBotToken' } });
      const chatId = await prisma.setting.findUnique({ where: { key: 'notification.telegramChatId' } });
      if (botToken?.value && chatId?.value) {
        logger.info('Telegram config found, auto-starting listener...');
        telegramListener.start().catch(e => logger.warn(`Telegram listener start error: ${e}`));
      } else {
        logger.info('Telegram not configured, skipping auto-start');
      }
    } catch (e) {
      logger.warn(`Could not check Telegram auto-start setting: ${e}`);
    }
  });
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');
  telegramListener.stop();
  try {
    const { contextManager } = await import('./automation/browser/context-manager');
    await contextManager.closeAll();
    logger.info('All browsers closed');
  } catch (e) {
    logger.warn(`Error closing browsers: ${e}`);
  }
  await prisma.$disconnect();
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
