import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

const providerEnum = z.enum(['NUKE', 'VICTORY', 'PAY4D', 'CUTTLY']);
const featureEnum = z.enum(['NTO', 'TARIKDB', 'LIVEREPORT', 'GANTINOMOR', 'SUMMARYPERFORMANCE']);

export const createAccountSchema = z.object({
  provider: providerEnum,
  feature: featureEnum.optional().default('NTO'),
  name: z.string().min(1, 'Name is required').max(100),
  panelUrl: z.string().url('Must be a valid URL'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  pinCode: z.string().optional(),
  twoFaSecret: z.string().optional(),
  proxy: z.string().optional(),
  uplineUsername: z.string().optional(),
  cuttlyLinkCs: z.string().optional(),
  cuttlyLinkMst: z.string().optional(),
});

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  panelUrl: z.string().url().optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  pinCode: z.string().optional(),
  twoFaSecret: z.string().optional(),
  proxy: z.string().optional(),
  uplineUsername: z.string().optional(),
  cuttlyLinkCs: z.string().optional(),
  cuttlyLinkMst: z.string().optional(),
});

export const botStartSchema = z.object({
  accountId: z.number().int().positive(),
});

export const botStartAllSchema = z.object({
  provider: providerEnum,
});

export const botStopSchema = z.object({
  accountId: z.number().int().positive(),
});

export const botOtpSchema = z.object({
  accountId: z.number().int().positive(),
  otp: z.string().min(1, 'OTP is required'),
});

export const ntoCheckSchema = z.object({
  accountId: z.number().int().positive(),
  dateStart: z.string().min(1, 'dateStart is required (DD-MM-YYYY)'),
  dateEnd: z.string().min(1, 'dateEnd is required (DD-MM-YYYY)'),
  usernames: z.array(z.string().min(1)).min(1, 'At least one username required'),
  gameCategory: z.enum(['SPORTS', 'CASINO', 'GAMES', 'SLOT']),
  maxPages: z.number().int().positive().optional(),
});

export const ntoExportSchema = z.object({
  accountId: z.number().int().positive(),
  ntoResultId: z.number().int().positive().optional(),
});

export const ntoTelegramSchema = z.object({
  accountId: z.number().int().positive(),
  ntoResultId: z.number().int().positive().optional(),
});

export const settingUpdateSchema = z.object({
  value: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'json']).optional(),
});

export function validate(schema: z.ZodSchema, target: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: { errors } },
      });
    }
    req[target] = result.data;
    next();
  };
}
