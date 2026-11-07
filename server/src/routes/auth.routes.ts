import { Router, type CookieOptions, type Response } from 'express';
import { z } from 'zod';
import { isProd } from '../config/env.js';
import { db } from '../db/index.js';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';
import { clientIp, userAgent } from '../lib/http.js';
import { email, nonEmpty, parse, password, trimmed } from '../lib/validate.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import { authLimiter, requireXhr } from '../middleware/security.js';
import { audit } from '../services/audit.js';
import {
  burnPasswordCheck,
  createSession,
  findValidUserToken,
  hashPassword,
  loadAuthUser,
  revokeSessionByToken,
  rotateSession,
  serializeAuthUser,
  signAccessToken,
  verifyPassword,
} from '../services/auth.js';
import type { RoleName } from '../types.js';

export const authRouter = Router();

const COOKIE = 'dms_rt';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

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
  portal: z.enum(['admin', 'employee']),
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email: mail, password: pwd, portal } = parse(loginSchema, req.body);
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
  const fail = async (reason: string, message = 'Invalid email or password') => {
    await audit(req, { action: 'auth.login_failed', entityType: 'user', entityId: u?.id ?? null, actorId: u?.id ?? null, actorEmail: mail, metadata: { reason, portal } });
    throw new AppError(401, message, 'invalid_credentials');
  };

  if (!u || !u.password_hash) {
    await burnPasswordCheck(pwd);
    return fail(u ? 'invite_pending' : 'unknown_email');
  }
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    return fail('locked', `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);
  }
  if (!(await verifyPassword(pwd, u.password_hash))) {
    const attempts = u.failed_login_attempts + 1;
    const lock = attempts >= MAX_FAILED;
    await db().query(
      `UPDATE users SET failed_login_attempts = $2, locked_until = $3 WHERE id = $1`,
      [u.id, lock ? 0 : attempts, lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null],
    );
    return fail(lock ? 'locked_now' : 'bad_password');
  }
  if (u.status !== 'active') return fail('inactive', 'This account has been deactivated. Contact your administrator.');

  const allowed: Record<typeof portal, RoleName[]> = { admin: ['admin', 'staff'], employee: ['employee'] };
  if (!allowed[portal].includes(u.role)) {
    await audit(req, { action: 'auth.login_wrong_portal', entityType: 'user', entityId: u.id, actorId: u.id, actorEmail: u.email, metadata: { portal } });
    throw new AppError(
      403,
      portal === 'admin' ? 'Employees must sign in through the Employee portal.' : 'Administrators and staff must sign in through the Admin portal.',
      'wrong_portal',
    );
  }

  await db().query(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [u.id]);
  const session = await createSession(u.id, { ip: clientIp(req), userAgent: userAgent(req) });
  const user = (await loadAuthUser(u.id))!;
  await audit(req, { action: 'auth.login', entityType: 'user', entityId: u.id, actorId: u.id, actorEmail: u.email, metadata: { portal } });

  setRefreshCookie(res, session.refreshToken, session.expiresAt);
  res.json({ accessToken: signAccessToken(u.id, session.sessionId, u.role), user: serializeAuthUser(user) });
});

// ---- POST /api/auth/refresh ------------------------------------------------------------
authRouter.post('/refresh', requireXhr, async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (!token || typeof token !== 'string') throw unauthorized('No session');
  const r = await rotateSession(token, { ip: clientIp(req), userAgent: userAgent(req) });
  if (!r.ok) {
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
  const t = await findValidUserToken(String(req.params.token), 'invite');
  if (!t) throw new AppError(410, 'This invitation link is invalid or has expired', 'invite_invalid');
  const { rows } = await db().query<{ email: string; first_name: string; last_name: string; role: RoleName }>(
    `SELECT u.email, u.first_name, u.last_name, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [t.user_id],
  );
  const u = rows[0];
  res.json({ email: u.email, firstName: u.first_name, lastName: u.last_name, portal: u.role === 'employee' ? 'employee' : 'admin' });
});

const acceptSchema = z.object({ token: z.string().min(10).max(200), password });

authRouter.post('/accept-invite', authLimiter, async (req, res) => {
  const { token, password: pwd } = parse(acceptSchema, req.body);
  const hash = await hashPassword(pwd);
  const result = await db().tx(async (q) => {
    const t = await findValidUserToken(token, 'invite', q);
    if (!t) throw new AppError(410, 'This invitation link is invalid or has expired', 'invite_invalid');
    const { rows } = await q.query<{ status: string; email: string; role: RoleName }>(
      `SELECT u.status, u.email, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 FOR UPDATE OF u`,
      [t.user_id],
    );
    if (rows[0].status === 'deactivated') throw badRequest('This account has been deactivated');
    await q.query(`UPDATE user_tokens SET used_at = now() WHERE id = $1`, [t.id]);
    await q.query(
      `UPDATE users SET password_hash = $2, status = 'active', password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
      [t.user_id, hash],
    );
    await audit(req, { action: 'auth.invite_accepted', entityType: 'user', entityId: t.user_id, actorId: t.user_id, actorEmail: rows[0].email }, q);
    return { portal: rows[0].role === 'employee' ? 'employee' : 'admin' };
  });
  res.json(result);
});

// ---- Authenticated self-service --------------------------------------------------------------
authRouter.get('/me', authenticate, async (req, res) => {
  const user = currentUser(req);
  const { rows } = await db().query<Record<string, unknown>>(
    `SELECT u.phone, u.job_title, u.last_login_at, u.created_at,
            e.employee_number, e.department, e.position, e.hire_date,
            c.id AS client_id, c.name AS client_name
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       LEFT JOIN clients c ON c.id = e.client_id
      WHERE u.id = $1`,
    [user.id],
  );
  const p = rows[0];
  res.json({
    user: serializeAuthUser(user),
    profile: {
      phone: p.phone,
      jobTitle: p.job_title,
      lastLoginAt: p.last_login_at,
      createdAt: p.created_at,
      employeeNumber: p.employee_number,
      department: p.department,
      position: p.position,
      hireDate: p.hire_date,
      clientId: p.client_id,
      clientName: p.client_name,
    },
  });
});

const profileSchema = z.object({
  firstName: nonEmpty(100),
  lastName: nonEmpty(100),
  phone: trimmed(40).optional().nullable(),
  jobTitle: trimmed(100).optional().nullable(),
});

authRouter.patch('/profile', authenticate, async (req, res) => {
  const user = currentUser(req);
  const b = parse(profileSchema, req.body);
  await db().query(
    `UPDATE users SET first_name = $2, last_name = $3, phone = NULLIF($4, ''), job_title = NULLIF($5, '') WHERE id = $1`,
    [user.id, b.firstName, b.lastName, b.phone ?? null, b.jobTitle ?? null],
  );
  await audit(req, { action: 'user.profile_updated', entityType: 'user', entityId: user.id });
  res.json({ ok: true });
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
