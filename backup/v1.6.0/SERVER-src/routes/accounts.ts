import { Router } from 'express';
import prisma from '../utils/prisma';
import { asyncHandler } from '../utils/errors';
import { validate, createAccountSchema, updateAccountSchema } from '../utils/validation';
import logger from '../utils/logger';

const router = Router();

// GET /api/accounts - list all (with optional ?provider= and ?feature= filter)
router.get('/', asyncHandler(async (req, res) => {
  const { provider, feature } = req.query;
  const where: any = {};
  if (provider) where.provider = String(provider);
  if (feature) where.feature = String(feature);
  const accounts = await prisma.account.findMany({
    where,
    select: { id: true, provider: true, feature: true, name: true, panelUrl: true, username: true, pinCode: true, twoFaSecret: true, proxy: true, status: true, lastNto: true, lastError: true, isActive: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: accounts });
}));

// GET /api/accounts/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const account = await prisma.account.findUnique({
    where: { id: Number(req.params.id) },
    select: { id: true, provider: true, feature: true, name: true, panelUrl: true, username: true, pinCode: true, twoFaSecret: true, proxy: true, status: true, lastNto: true, lastError: true, isActive: true, createdAt: true, updatedAt: true },
  });
  if (!account) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });
  res.json({ success: true, data: account });
}));

// POST /api/accounts
router.post('/', validate(createAccountSchema), asyncHandler(async (req, res) => {
  const { provider, feature, name, panelUrl, username, password, pinCode, twoFaSecret, proxy } = req.body;
  const account = await prisma.account.create({
    data: { provider, feature: feature || 'NTO', name, panelUrl, username, password, pinCode, twoFaSecret, proxy: proxy || null },
  });
  await prisma.activityLog.create({
    data: { action: 'account_created', provider, accountId: account.id, details: `Account "${name}" created`, status: 'success' },
  });
  logger.info(`Account created: ${name} (${provider})`);
  // Broadcast via WebSocket
  const broadcast = (global as any).wsBroadcast;
  if (broadcast) broadcast({ type: 'ACCOUNT_CREATED', data: { id: account.id, provider, name } });
  res.status(201).json({ success: true, data: { id: account.id, provider, feature: account.feature, name, panelUrl, username, status: account.status } });
}));

// PUT /api/accounts/:id
router.put('/:id', validate(updateAccountSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.account.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });
  // Normalize proxy: empty string → null (remove proxy)
  const updateData = { ...req.body };
  if ('proxy' in updateData && !updateData.proxy) updateData.proxy = null;
  const account = await prisma.account.update({ where: { id }, data: updateData });
  await prisma.activityLog.create({
    data: { action: 'account_updated', provider: account.provider, accountId: id, details: `Account "${account.name}" updated`, status: 'info' },
  });
  res.json({ success: true, data: { id: account.id, provider: account.provider, name: account.name } });
}));

// DELETE /api/accounts/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.account.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });
  await prisma.account.delete({ where: { id } });
  await prisma.activityLog.create({
    data: { action: 'account_deleted', provider: existing.provider, accountId: id, details: `Account "${existing.name}" deleted`, status: 'warning' },
  });
  const broadcast = (global as any).wsBroadcast;
  if (broadcast) broadcast({ type: 'ACCOUNT_DELETED', data: { id, provider: existing.provider } });
  res.json({ success: true });
}));

// POST /api/accounts/bulk-delete
router.post('/bulk-delete', asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ids array required' } });
  }
  await prisma.account.deleteMany({ where: { id: { in: ids.map(Number) } } });
  await prisma.activityLog.create({
    data: { action: 'accounts_bulk_deleted', details: `${ids.length} accounts deleted`, status: 'warning' },
  });
  res.json({ success: true, deleted: ids.length });
}));

export default router;
