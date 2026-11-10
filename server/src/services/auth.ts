import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env, mfaRequiredRoles } from '../config/env.js';
import { db, type Queryable } from '../db/index.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import type { AuthUser, RoleName } from '../types.js';

export const hashPassword = (plain: string) => bcrypt.hash(plain, env.BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// A constant hash used to keep timing similar when the email does not exist.
let dummyHash: string | null = null;
export async function burnPasswordCheck(plain: string) {
  dummyHash ??= await bcrypt.hash('dummy-password-for-timing', env.BCRYPT_ROUNDS);
  await bcrypt.compare(plain, dummyHash);
}

// ---- Access tokens --------------------------------------------------------------------
interface AccessClaims {
  sub: string;
  sid: string;
  role: RoleName;
}

export function signAccessToken(userId: string, sessionId: string, role: RoleName): string {
  return jwt.sign({ sid: sessionId, role } satisfies Omit<AccessClaims, 'sub'>, env.JWT_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
    issuer: 'dms',
    audience: 'dms-api',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'dms',
    audience: 'dms-api',
  }) as AccessClaims;
}

// ---- Refresh sessions -----------------------------------------------------------------
const refreshTtlMs = () => env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 10_000;
const sessionMaxMs = () => env.SESSION_MAX_DAYS * 24 * 60 * 60 * 1000;

export async function createSession(
  userId: string,
  meta: { ip: string | null; userAgent: string | null },
  familyId: string = randomUUID(),
  q: Queryable = db(),
  familyStartedAt: Date = new Date(),
) {
  const refreshToken = randomToken(32);
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO auth_sessions (user_id, family_id, refresh_token_hash, ip, user_agent, expires_at, family_started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [userId, familyId, sha256(refreshToken), meta.ip, meta.userAgent, new Date(Date.now() + refreshTtlMs()), familyStartedAt],
  );
  return { sessionId: rows[0].id, refreshToken, expiresAt: new Date(Date.now() + refreshTtlMs()) };
}

type RotateResult =
  | { ok: true; userId: string; role: RoleName; sessionId: string; refreshToken: string; expiresAt: Date }
  | { ok: false; reason: 'invalid' | 'reused' | 'expired' | 'inactive' | 'race' };

/**
 * Rotates a refresh token. Presenting an already-rotated token means it was stolen or replayed:
 * the whole session family is revoked.
 */
export async function rotateSession(refreshToken: string, meta: { ip: string | null; userAgent: string | null }): Promise<RotateResult> {
  return db().tx(async (q) => {
    const { rows } = await q.query<{
      id: string;
      user_id: string;
      family_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      rotated_at: Date | null;
      family_started_at: Date;
      status: string;
      role: RoleName;
    }>(
      `SELECT s.id, s.user_id, s.family_id, s.expires_at, s.revoked_at, s.rotated_at, s.family_started_at, u.status, r.name AS role
         FROM auth_sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
        WHERE s.refresh_token_hash = $1 FOR UPDATE OF s`,
      [sha256(refreshToken)],
    );
    const s = rows[0];
    if (!s) return { ok: false, reason: 'invalid' } as const;
    // Two tabs refreshing at the same moment both present the same token. Within a short grace window
    // we neither revoke nor mint a new session (a replayed token must never yield one); the browser
    // already holds the rotated cookie, so the client simply retries.
    const concurrentRefresh = s.rotated_at && !s.revoked_at && Date.now() - new Date(s.rotated_at).getTime() < ROTATION_GRACE_MS;
    if (concurrentRefresh) return { ok: false, reason: 'race' } as const;
    if (s.rotated_at || s.revoked_at) {
      await q.query('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1', [s.family_id]);
      return { ok: false, reason: 'reused' } as const;
    }
    if (new Date(s.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' } as const;
    // Absolute cap: rotating forever must not keep a sign-in alive indefinitely.
    if (new Date(s.family_started_at).getTime() + sessionMaxMs() < Date.now()) return { ok: false, reason: 'expired' } as const;
    if (s.status !== 'active') return { ok: false, reason: 'inactive' } as const;

    await q.query('UPDATE auth_sessions SET rotated_at = COALESCE(rotated_at, now()) WHERE id = $1', [s.id]);
    const next = await createSession(s.user_id, meta, s.family_id, q, new Date(s.family_started_at));
    return { ok: true, userId: s.user_id, role: s.role, ...next } as const;
  });
}

export async function revokeSessionByToken(refreshToken: string) {
  await db().query(
    `UPDATE auth_sessions SET revoked_at = now()
      WHERE family_id = (SELECT family_id FROM auth_sessions WHERE refresh_token_hash = $1)`,
    [sha256(refreshToken)],
  );
}

export async function revokeAllSessions(userId: string, q: Queryable = db()) {
  await q.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

/** A session id from an access token is only valid while its family has not been revoked. */
export async function isSessionActive(sessionId: string, userId: string): Promise<boolean> {
  const { rows } = await db().query<{ ok: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM auth_sessions f
        WHERE f.family_id = s.family_id AND f.revoked_at IS NOT NULL
     ) AND s.expires_at > now()
       AND s.family_started_at > now() - make_interval(days => $2::int) AS ok
       FROM auth_sessions s WHERE s.id = $1 AND s.user_id = $3`,
    [sessionId, env.SESSION_MAX_DAYS, userId],
  );
  return rows[0]?.ok === true;
}

// ---- Loading the authenticated user ---------------------------------------------------
export async function loadAuthUser(userId: string): Promise<(AuthUser & { status: string }) | null> {
  const { rows } = await db().query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    status: string;
    role: RoleName;
    mfa_enabled: boolean;
  }>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.status, r.name AS role, u.mfa_enabled_at IS NOT NULL AS mfa_enabled
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1`,
    [userId],
  );
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    status: u.status,
    role: u.role,
    mfaEnabled: u.mfa_enabled,
    mfaSetupRequired: mfaRequiredRoles.has(u.role) && !u.mfa_enabled,
  };
}

export function serializeAuthUser(u: AuthUser) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    mfaEnabled: u.mfaEnabled,
    mfaSetupRequired: u.mfaSetupRequired,
  };
}

export function signMfaToken(userId: string): string {
  return jwt.sign({}, env.JWT_SECRET, { subject: userId, expiresIn: 300, algorithm: 'HS256', issuer: 'dms', audience: 'dms-mfa' });
}

export function verifyMfaToken(token: string): { sub: string } {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'dms', audience: 'dms-mfa' }) as { sub: string };
}

// ---- Single-use tokens (invites / resets) --------------------------------------------
export async function issueUserToken(
  userId: string,
  purpose: 'invite' | 'password_reset',
  createdBy: string | null,
  ttlHours: number,
  q: Queryable = db(),
): Promise<string> {
  const token = randomToken(32);
  await q.query(`UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
  await q.query(`INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at, created_by) VALUES ($1, $2, $3, $4, $5)`, [
    userId,
    purpose,
    sha256(token),
    new Date(Date.now() + ttlHours * 3600_000),
    createdBy,
  ]);
  return token;
}

type TokenPurpose = 'invite' | 'password_reset';

export async function findValidUserToken(token: string, purposes: TokenPurpose | TokenPurpose[], q: Queryable = db()) {
  const { rows } = await q.query<{ id: string; user_id: string; purpose: TokenPurpose }>(
    `SELECT id, user_id, purpose FROM user_tokens
      WHERE token_hash = $1 AND purpose = ANY($2::text[]) AND used_at IS NULL AND expires_at > now()
      ${q === db() ? '' : 'FOR UPDATE'}`,
    [sha256(token), Array.isArray(purposes) ? purposes : [purposes]],
  );
  return rows[0] ?? null;
}

export const inviteUrl = (token: string) => `${env.APP_URL}/accept-invite?token=${encodeURIComponent(token)}`;
