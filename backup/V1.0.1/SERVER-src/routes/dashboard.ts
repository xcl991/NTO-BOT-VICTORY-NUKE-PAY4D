import { Router } from 'express';
import prisma from '../utils/prisma';
import { asyncHandler } from '../utils/errors';

const router = Router();

// GET /api/dashboard/stats
router.get('/stats', asyncHandler(async (_req, res) => {
  const [totalAccounts, activeAccounts, ntoToday, providers] = await Promise.all([
    prisma.account.count(),
    prisma.account.count({ where: { status: { in: ['running', 'checking_nto'] } } }),
    prisma.ntoResult.count({
      where: { checkedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    }),
    Promise.all(['NUKE', 'VICTORY', 'PAY4D'].map(async (provider) => {
      const [total, active, lastNto] = await Promise.all([
        prisma.account.count({ where: { provider } }),
        prisma.account.count({ where: { provider, status: { in: ['running', 'checking_nto'] } } }),
        prisma.ntoResult.findFirst({ where: { provider }, orderBy: { checkedAt: 'desc' } }),
      ]);
      return { provider, total, active, lastNto: lastNto?.value || null, lastCheck: lastNto?.checkedAt || null };
    })),
  ]);

  res.json({
    success: true,
    data: {
      totalAccounts,
      activeAccounts,
      ntoChecksToday: ntoToday,
      providers,
    },
  });
}));

// GET /api/dashboard/activity
router.get('/activity', asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const activities = await prisma.activityLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json({ success: true, data: activities });
}));

export default router;
