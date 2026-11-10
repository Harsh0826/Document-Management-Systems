import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { env, isTest } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { audit } from '../services/audit.js';

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
 * Exfiltration guard: caps how many preview/download links one user can mint per hour. Hitting the cap
 * is written to the audit log so admins can spot bulk-harvesting of documents.
 */
export const downloadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.DOWNLOADS_PER_HOUR,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest && !process.env.TEST_DOWNLOAD_LIMIT,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anonymous',
  handler: (req, _res, next) => {
    audit(req, { action: 'document.download_rate_limited', metadata: { limitPerHour: env.DOWNLOADS_PER_HOUR } })
      .catch(() => undefined)
      .finally(() => next(new AppError(429, 'Download limit reached. Please try again later or contact your administrator.', 'download_rate_limited')));
  },
});

/** Correlates logs, audit entries and error reports for one request. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  (req as Request & { id: string }).id = id;
  res.set('X-Request-Id', id);
  next();
}

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
