import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const limitHandler = (_req: Request, _res: Response, next: NextFunction) =>
  next(new AppError(429, 'Too many requests, please try again later', 'rate_limited'));

/** General API limiter. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: limitHandler,
});

/** Strict limiter for credential endpoints (per IP). Account lockout adds per-account protection. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  skipSuccessfulRequests: true,
  handler: limitHandler,
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: limitHandler,
});

/**
 * CSRF guard for cookie-authenticated endpoints (refresh/logout). Cross-site forms cannot set custom
 * headers, and SameSite=Strict already blocks cross-site cookies; this is defence in depth.
 */
export function requireXhr(req: Request, _res: Response, next: NextFunction) {
  if (req.get('x-requested-with') !== 'XMLHttpRequest') {
    throw new AppError(403, 'Missing X-Requested-With header', 'csrf');
  }
  next();
}
