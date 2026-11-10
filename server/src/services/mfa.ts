import { dataKey } from '../config/env.js';
import { db, type Queryable } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { decryptSecret, encryptSecret, generateRecoveryCodes, generateTotpSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from '../lib/totp.js';
import { APP_NAME } from './branding.js';

const hashCode = (c: string) => sha256(`recovery:${normalizeRecoveryCode(c)}`);

/** Starts (or restarts) enrollment: stores an encrypted pending secret and returns it for the authenticator app. */
export async function startEnrollment(userId: string, email: string) {
  const secret = generateTotpSecret();
  await db().query('UPDATE users SET mfa_pending_secret_enc = $2 WHERE id = $1', [userId, encryptSecret(secret, dataKey)]);
  return { secret, otpauthUrl: otpauthUrl(secret, email, APP_NAME) };
}

/** Confirms enrollment with a code from the app; returns one-time recovery codes (shown once). */
export async function confirmEnrollment(userId: string, code: string, q: Queryable = db()): Promise<string[]> {
  const { rows } = await q.query<{ pending: string | null }>('SELECT mfa_pending_secret_enc AS pending FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!rows[0]?.pending) throw badRequest('Start MFA setup first');
  const secret = decryptSecret(rows[0].pending, dataKey);
  const step = verifyTotp(secret, code.trim(), null);
  if (step === null) throw badRequest('Validation failed', { fields: { code: 'That code is not valid. Check the time on your phone and try again.' } });
  const codes = generateRecoveryCodes();
  await q.query(
    `UPDATE users SET mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = NULL, mfa_enabled_at = now(),
            mfa_last_step = $2, mfa_recovery_hashes = $3 WHERE id = $1`,
    [userId, step, codes.map(hashCode)],
  );
  return codes;
}

/**
 * Verifies a TOTP code (rejecting reuse of an already-accepted time-step) or a single-use recovery code.
 * Must run inside a transaction so concurrent attempts cannot reuse the same code.
 */
export async function verifyUserMfa(userId: string, code: string, q: Queryable): Promise<'totp' | 'recovery' | null> {
  const { rows } = await q.query<{ secret: string | null; last_step: number | null; hashes: string[] }>(
    'SELECT mfa_secret_enc AS secret, mfa_last_step AS last_step, mfa_recovery_hashes AS hashes FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );
  const u = rows[0];
  if (!u?.secret) return null;
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed)) {
    const step = verifyTotp(decryptSecret(u.secret, dataKey), trimmed, u.last_step === null ? null : Number(u.last_step));
    if (step === null) return null;
    await q.query('UPDATE users SET mfa_last_step = $2 WHERE id = $1', [userId, step]);
    return 'totp';
  }
  const h = hashCode(trimmed);
  if (!u.hashes.includes(h)) return null;
  await q.query('UPDATE users SET mfa_recovery_hashes = array_remove(mfa_recovery_hashes, $2) WHERE id = $1', [userId, h]);
  return 'recovery';
}

export async function regenerateRecoveryCodes(userId: string, q: Queryable): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await q.query('UPDATE users SET mfa_recovery_hashes = $2 WHERE id = $1', [userId, codes.map(hashCode)]);
  return codes;
}

export async function clearMfa(userId: string, q: Queryable = db()) {
  await q.query(
    `UPDATE users SET mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL, mfa_recovery_hashes = '{}' WHERE id = $1`,
    [userId],
  );
}

export async function remainingRecoveryCodes(userId: string): Promise<number> {
  const { rows } = await db().query<{ n: number }>('SELECT cardinality(mfa_recovery_hashes) AS n FROM users WHERE id = $1', [userId]);
  return rows[0]?.n ?? 0;
}
