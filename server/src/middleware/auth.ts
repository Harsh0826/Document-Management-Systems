import type { NextFunction, Request, Response } from 'express';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { isSessionActive, loadAuthUser, verifyAccessToken } from '../services/auth.js';
import type { RoleName } from '../types.js';

/** Verifies the bearer JWT, then reloads the user so deactivation and role changes apply instantly. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  let claims;
  try {
    claims = verifyAccessToken(header.slice(7));
  } catch {
    throw unauthorized('Session expired or invalid');
  }
  if (!(await isSessionActive(claims.sid, claims.sub))) throw unauthorized('Session has been revoked');
  const user = await loadAuthUser(claims.sub);
  if (!user || user.status !== 'active') throw unauthorized('Account is not active');
  // Users whose role requires MFA must finish enrolling before touching any data.
  if (user.mfaSetupRequired && !req.originalUrl.startsWith('/api/auth/')) {
    throw new AppError(403, 'Set up two-factor authentication to continue', 'mfa_setup_required');
  }
  req.user = user;
  req.sessionId = claims.sid;
  next();
}

export const requireRole =
  (...roles: RoleName[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

/** Narrowing helper for handlers that run after `authenticate`. */
export function currentUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}
