import { Router, type CookieOptions, type Request, type Response } from 'express';
import { z } from 'zod';
import { isProd, mfaRequiredRoles } from '../config/env.js';
import { db, type Queryable } from '../db/index.js';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';
import { clientIp, userAgent } from '../lib/http.js';
import { email, parse, password } from '../lib/validate.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import { authLimiter, requireXhr } from '../middleware/security.js';
import { audit } from '../services/audit.js';
import {
  burnPasswordCheck,
  createSession,
  findValidUserToken,
  hashPassword,
  loadAuthUser,
  revokeAllSessions,
  revokeSessionByToken,
  rotateSession,
  serializeAuthUser,
  signAccessToken,
  signMfaToken,
  verifyMfaToken,
  verifyPassword,
} from '../services/auth.js';
import { clearMfa, confirmEnrollment, regenerateRecoveryCodes, remainingRecoveryCodes, startEnrollment, verifyUserMfa } from '../services/mfa.js';
import type { RoleName } from '../types.js';

export const authRouter = Router();

const COOKIE = 'dms_rt';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const GENERIC_LOGIN_ERROR = `Invalid email or password. After ${MAX_FAILED} failed attempts sign-in is paused for ${LOCK_MINUTES} minutes.`;

/**
 * Atomically counts a failed attempt (safe under parallel requests — the row lock serialises the
 * increments) and locks the account once the threshold is reached. Returns true when now locked.
 */
async function recordFailedAttempt(q: Queryable, userId: string): Promise<boolean> {
  const { rows } = await q.query<{ locked: boolean }>(
    `UPDATE users SET
        locked_until = CASE WHEN failed_login_attempts + 1 >= $2 THEN now() + make_interval(mins => $3::int) ELSE locked_until END,
        failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= $2 THEN 0 ELSE failed_login_attempts + 1 END
      WHERE id = $1
      RETURNING locked_until IS NOT NULL AND locked_until > now() AS locked`,
    [userId, MAX_FAILED, LOCK_MINUTES],
  );
  return rows[0]?.locked === true;
}

const cookieOpts = (expires?: Date): CookieOptions => ({
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict',
  path: '/api/auth',
  expires,
});

const setRefreshCookie = (res: Response, token: string, expires: Date) => res.cookie(COOKIE, token, cookieOpts(expires));
const clearRefreshCookie = (res: Response) => res.clearCookie(COOKIE, cookieOpts());

// ---- POST /api/auth/login --------------------------------------------------------------
const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Required').max(128),
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email: mail, password: pwd } = parse(loginSchema, req.body);
  const { rows } = await db().query<{
    id: string;
    email: string;
    password_hash: string | null;
    status: string;
    role: RoleName;
    failed_login_attempts: number;
    locked_until: Date | null;
  }>(
    `SELECT u.id, u.email, u.password_hash, u.status, r.name AS role, u.failed_login_attempts, u.locked_until
       FROM users u JOIN roles r ON r.id = u.role_id WHERE lower(u.email) = $1`,
    [mail],
  );
  const u = rows[0];
  // One message (and one bcrypt cost) for every failure so responses never reveal whether an
  // account exists, is locked, or is deactivated.
  const fail = async (reason: string) => {
    await audit(req, {
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: u?.id ?? null,
      actorId: u?.id ?? null,
      actorEmail: mail,
      metadata: { reason },
    });
    throw new AppError(401, GENERIC_LOGIN_ERROR, 'invalid_credentials');
  };

  if (!u || !u.password_hash) {
    await burnPasswordCheck(pwd);
    return fail(u ? 'invite_pending' : 'unknown_email');
  }
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    await burnPasswordCheck(pwd);
    return fail('locked');
  }
  if (!(await verifyPassword(pwd, u.password_hash))) {
    const locked = await recordFailedAttempt(db(), u.id);
    return fail(locked ? 'locked_now' : 'bad_password');
  }
  if (u.status !== 'active') return fail('inactive');

  // Second factor: the password alone never yields a session when MFA is enabled.
  const authUser = (await loadAuthUser(u.id))!;
  if (authUser.mfaEnabled) {
    await audit(req, { action: 'auth.password_verified', entityType: 'user', entityId: u.id, actorId: u.id, actorEmail: u.email });
    res.json({ mfaRequired: true, mfaToken: signMfaToken(u.id) });
    return;
  }
  await completeLogin(req, res, u.id, 'password');
});

/** Final step of any successful sign-in: resets counters, opens a session and returns tokens. */
async function completeLogin(req: Request, res: Response, userId: string, method: 'password' | 'totp' | 'recovery') {
  await db().query(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [userId]);
  const session = await createSession(userId, { ip: clientIp(req), userAgent: userAgent(req) });
  const user = (await loadAuthUser(userId))!;
  await audit(req, { action: 'auth.login', entityType: 'user', entityId: userId, actorId: userId, actorEmail: user.email, metadata: { method } });
  setRefreshCookie(res, session.refreshToken, session.expiresAt);
  res.json({ accessToken: signAccessToken(userId, session.sessionId, user.role), user: serializeAuthUser(user) });
}

// ---- POST /api/auth/login/mfa ----------------------------------------------------------
const mfaLoginSchema = z.object({ mfaToken: z.string().min(10).max(2000), code: z.string().trim().min(6).max(20) });

authRouter.post('/login/mfa', authLimiter, async (req, res) => {
  const { mfaToken, code } = parse(mfaLoginSchema, req.body);
  let claims;
  try {
    claims = verifyMfaToken(mfaToken);
  } catch {
    throw new AppError(401, 'Your sign-in attempt expired. Please enter your password again.', 'mfa_expired');
  }
  const result = await db().tx(async (q) => {
    const { rows } = await q.query<{ status: string; email: string; locked_until: Date | null }>(
      'SELECT status, email, locked_until FROM users WHERE id = $1 FOR UPDATE',
      [claims.sub],
    );
    const u = rows[0];
    if (!u || u.status !== 'active') return { ok: false as const, message: 'This account is not active.' };
    if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
      return { ok: false as const, message: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.` };
    }
    const method = await verifyUserMfa(claims.sub, code, q);
    if (!method) {
      const lock = await recordFailedAttempt(q, claims.sub);
      await audit(
        req,
        { action: 'auth.mfa_failed', entityType: 'user', entityId: claims.sub, actorId: claims.sub, actorEmail: u.email, metadata: { locked: lock } },
        q,
      );
      return { ok: false as const, message: lock ? `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.` : 'That code is not valid.' };
    }
    if (method === 'recovery') {
      await audit(req, { action: 'auth.mfa_recovery_code_used', entityType: 'user', entityId: claims.sub, actorId: claims.sub, actorEmail: u.email }, q);
    }
    return { ok: true as const, method };
  });
  if (!result.ok) throw new AppError(401, result.message, 'mfa_invalid');
  await completeLogin(req, res, claims.sub, result.method);
});

// ---- MFA self-service (enrollment / recovery codes / disable) ---------------------------------
authRouter.post('/mfa/setup', authenticate, authLimiter, async (req, res) => {
  const user = currentUser(req);
  if (user.mfaEnabled) throw badRequest('Two-factor authentication is already enabled');
  res.json(await startEnrollment(user.id, user.email));
});

authRouter.post('/mfa/enable', authenticate, authLimiter, async (req, res) => {
  const user = currentUser(req);
  const { code } = parse(z.object({ code: z.string().trim().length(6, 'Enter the 6-digit code') }), req.body);
  const recoveryCodes = await db().tx(async (q) => {
    const codes = await confirmEnrollment(user.id, code, q);
    // Any other existing sessions were opened without the second factor: sign them out.
    await q.query(
      `UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL
          AND family_id <> (SELECT family_id FROM auth_sessions WHERE id = $2)`,
      [user.id, req.sessionId],
    );
    await audit(req, { action: 'auth.mfa_enabled', entityType: 'user', entityId: user.id }, q);
    return codes;
  });
  res.json({ recoveryCodes });
});

const reauthSchema = z.object({ password: z.string().min(1).max(128), code: z.string().trim().min(6).max(20) });

/** Re-authenticates with password + current second factor before sensitive MFA changes. */
async function reauthenticate(req: Request, q: Queryable) {
  const user = currentUser(req);
  const b = parse(reauthSchema, req.body);
  const { rows } = await q.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  const okPwd = !!rows[0]?.password_hash && (await verifyPassword(b.password, rows[0].password_hash));
  const okCode = okPwd && (await verifyUserMfa(user.id, b.code, q));
  if (!okPwd || !okCode) throw badRequest('Validation failed', { fields: { [okPwd ? 'code' : 'password']: okPwd ? 'Invalid code' : 'Incorrect password' } });
  return user;
}

authRouter.post('/mfa/recovery-codes', authenticate, authLimiter, async (req, res) => {
  const recoveryCodes = await db().tx(async (q) => {
    const user = await reauthenticate(req, q);
    const codes = await regenerateRecoveryCodes(user.id, q);
    await audit(req, { action: 'auth.mfa_recovery_codes_regenerated', entityType: 'user', entityId: user.id }, q);
    return codes;
  });
  res.json({ recoveryCodes });
});

authRouter.post('/mfa/disable', authenticate, authLimiter, async (req, res) => {
  if (mfaRequiredRoles.has(currentUser(req).role)) throw badRequest('Two-factor authentication is required for your role and cannot be turned off');
  await db().tx(async (q) => {
    const user = await reauthenticate(req, q);
    await clearMfa(user.id, q);
    await audit(req, { action: 'auth.mfa_disabled', entityType: 'user', entityId: user.id }, q);
  });
  res.json({ ok: true });
});

authRouter.get('/mfa', authenticate, async (req, res) => {
  const user = currentUser(req);
  res.json({
    enabled: user.mfaEnabled,
    required: mfaRequiredRoles.has(user.role),
    recoveryCodesRemaining: user.mfaEnabled ? await remainingRecoveryCodes(user.id) : 0,
  });
});

// ---- POST /api/auth/refresh ------------------------------------------------------------
authRouter.post('/refresh', requireXhr, async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (!token || typeof token !== 'string') throw unauthorized('No session');
  const r = await rotateSession(token, { ip: clientIp(req), userAgent: userAgent(req) });
  if (!r.ok) {
    // Another tab rotated this token a moment ago: keep the (newer) cookie and let the client retry.
    if (r.reason === 'race') throw new AppError(409, 'Session refresh already in progress', 'refresh_race');
    clearRefreshCookie(res);
    if (r.reason === 'reused') await audit(req, { action: 'auth.refresh_reuse_detected', metadata: {} });
    throw unauthorized('Session expired');
  }
  const user = (await loadAuthUser(r.userId))!;
  setRefreshCookie(res, r.refreshToken, r.expiresAt);
  res.json({ accessToken: signAccessToken(r.userId, r.sessionId, r.role), user: serializeAuthUser(user) });
});

// ---- POST /api/auth/logout -------------------------------------------------------------
authRouter.post('/logout', requireXhr, async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (typeof token === 'string') await revokeSessionByToken(token);
  clearRefreshCookie(res);
  res.status(204).end();
});

// ---- Invitations -------------------------------------------------------------------------
authRouter.get('/invitations/:token', authLimiter, async (req, res) => {
  const t = await findValidUserToken(String(req.params.token), ['invite', 'password_reset']);
  if (!t) throw new AppError(410, 'This invitation link is invalid or has expired', 'invite_invalid');
  const { rows } = await db().query<{ email: string; first_name: string; last_name: string; role: RoleName }>(
    `SELECT u.email, u.first_name, u.last_name, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [t.user_id],
  );
  const u = rows[0];
  res.json({ email: u.email, firstName: u.first_name, lastName: u.last_name, purpose: t.purpose });
});

const acceptSchema = z.object({ token: z.string().min(10).max(200), password });

authRouter.post('/accept-invite', authLimiter, async (req, res) => {
  const { token, password: pwd } = parse(acceptSchema, req.body);
  const hash = await hashPassword(pwd);
  await db().tx(async (q) => {
    const t = await findValidUserToken(token, ['invite', 'password_reset'], q);
    if (!t) throw new AppError(410, 'This link is invalid or has expired', 'invite_invalid');
    const { rows } = await q.query<{ status: string; email: string }>(`SELECT status, email FROM users WHERE id = $1 FOR UPDATE`, [t.user_id]);
    if (rows[0].status === 'deactivated') throw badRequest('This account has been deactivated');
    await q.query(`UPDATE user_tokens SET used_at = now() WHERE id = $1`, [t.id]);
    await q.query(
      `UPDATE users SET password_hash = $2, status = 'active', password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
      [t.user_id, hash],
    );
    // A reset means the old password may be compromised: end every existing session.
    if (t.purpose === 'password_reset') await revokeAllSessions(t.user_id, q);
    await audit(
      req,
      {
        action: t.purpose === 'invite' ? 'auth.invite_accepted' : 'auth.password_reset',
        entityType: 'user',
        entityId: t.user_id,
        actorId: t.user_id,
        actorEmail: rows[0].email,
      },
      q,
    );
  });
  res.json({ ok: true });
});

// ---- Authenticated self-service --------------------------------------------------------------
authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: serializeAuthUser(currentUser(req)) });
});

const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: password })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'Choose a different password' });

authRouter.post('/change-password', authenticate, authLimiter, async (req, res) => {
  const user = currentUser(req);
  const b = parse(changePasswordSchema, req.body);
  const { rows } = await db().query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  if (!rows[0]?.password_hash || !(await verifyPassword(b.currentPassword, rows[0].password_hash))) {
    throw badRequest('Validation failed', { fields: { currentPassword: 'Current password is incorrect' } });
  }
  const hash = await hashPassword(b.newPassword);
  await db().tx(async (q) => {
    await q.query(`UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [user.id, hash]);
    // Sign out every other device; keep the current session family.
    await q.query(
      `UPDATE auth_sessions SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL
          AND family_id <> (SELECT family_id FROM auth_sessions WHERE id = $2)`,
      [user.id, req.sessionId],
    );
    await audit(req, { action: 'user.password_changed', entityType: 'user', entityId: user.id }, q);
  });
  res.json({ ok: true });
});
