import { Request, Response, NextFunction } from 'express';
import logger from './logger';

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  NOT_FOUND = 'NOT_FOUND',
  ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
  CONFLICT = 'CONFLICT',
  DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  AUTOMATION_ERROR = 'AUTOMATION_ERROR',
  BROWSER_ERROR = 'BROWSER_ERROR',
}

const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  ACCOUNT_NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_ENTRY: 409,
  INTERNAL_ERROR: 500,
  DATABASE_ERROR: 500,
  AUTOMATION_ERROR: 500,
  BROWSER_ERROR: 500,
};

export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = ERROR_STATUS[code] || 500;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      error: { code: this.code, message: this.message, details: this.details },
    };
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(ErrorCode.VALIDATION_ERROR, message, details);
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string) {
    super(ErrorCode.NOT_FOUND, `${resource} not found`);
  }
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    logger.warn(`API Error: ${err.code} - ${err.message}`, { code: err.code });
    return res.status(err.statusCode).json(err.toJSON());
  }
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
}
