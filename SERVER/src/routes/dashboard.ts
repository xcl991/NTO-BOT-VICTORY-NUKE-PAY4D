import { Router } from 'express';
import prisma from '../utils/prisma';
import { asyncHandler } from '../utils/errors';

const router = Router();

// GET /api/dashboard/stats
router.get('/stats', asyncHandler(async (req, res) => {
  const { feature } = req.query;
  const accountWhere: any = feature ? { feature: String(feature) } : {};

  const [totalAccounts, activeAccounts, ntoToday, providers] = await Promise.all([
    prisma.account.count({ where: accountWhere }),
    prisma.account.count({ where: { ...accountWhere, status: { in: ['running', 'checking_nto'] } } }),
    prisma.ntoResult.count({
      where: {
        checkedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        ...(feature ? { account: { feature: String(feature) } } : {}),
      },
    }),
    Promise.all(['NUKE', 'VICTORY', 'PAY4D'].map(async (provider) => {
      const provWhere = { ...accountWhere, provider };
      const [total, active, lastNto] = await Promise.all([
        prisma.account.count({ where: provWhere }),
        prisma.account.count({ where: { ...provWhere, status: { in: ['running', 'checking_nto'] } } }),
        prisma.ntoResult.findFirst({
          where: { provider, ...(feature ? { account: { feature: String(feature) } } : {}) },
          orderBy: { checkedAt: 'desc' },
        }),
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
