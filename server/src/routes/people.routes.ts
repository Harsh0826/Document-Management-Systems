import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { db, type Queryable } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { email, nonEmpty, parse, uuid } from '../lib/validate.js';
import { authenticate, currentUser, requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { inviteUrl, issueUserToken, revokeAllSessions } from '../services/auth.js';
import { clearMfa } from '../services/mfa.js';

/** People: who can sign in, and whether they can manage documents. Administrators only. */
export const peopleRouter = Router();
peopleRouter.use(authenticate, requireRole('admin'));

const RESET_HOURS = 24;

const SELECT = `
  SELECT u.id, u.first_name, u.last_name, u.email, u.status, r.name AS role, u.last_login_at, u.created_at,
         u.mfa_enabled_at IS NOT NULL AS mfa_enabled
    FROM users u JOIN roles r ON r.id = u.role_id`;

const serialize = (p: Record<string, any>) => ({
  id: p.id,
  firstName: p.first_name,
  lastName: p.last_name,
  email: p.email,
  isAdmin: p.role === 'admin',
  status: p.status as 'invited' | 'active' | 'deactivated',
  lastLoginAt: p.last_login_at,
  addedAt: p.created_at,
  twoStepOn: p.mfa_enabled,
});

async function loadPerson(id: string, q: Queryable = db()) {
  const { rows } = await q.query(`${SELECT} WHERE u.id = $1`, [id]);
  if (!rows[0]) throw notFound('Person');
  return rows[0];
}

const roleId = async (q: Queryable, role: 'admin' | 'employee') => (await q.query<{ id: number }>('SELECT id FROM roles WHERE name = $1', [role])).rows[0].id;

async function assertAnotherAdmin(q: Queryable, exceptId: string) {
  const { rows } = await q.query<{ n: number }>(
    `SELECT count(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.status = 'active' AND u.id <> $1`,
    [exceptId],
  );
  if (rows[0].n === 0) throw badRequest('There must always be at least one administrator.');
}

peopleRouter.get('/', async (_req, res) => {
  const { rows } = await db().query(`${SELECT} ORDER BY u.status = 'deactivated', lower(u.first_name), lower(u.last_name)`);
  res.json(rows.map(serialize));
});

const addSchema = z.object({ firstName: nonEmpty(100), lastName: nonEmpty(100), email, isAdmin: z.boolean().default(false) });

peopleRouter.post('/', async (req, res) => {
  const actor = currentUser(req);
  const b = parse(addSchema, req.body);
  const { id, token } = await db().tx(async (q) => {
    const existing = await q.query<{ status: string }>('SELECT status FROM users WHERE lower(email) = $1', [b.email]);
    if (existing.rows[0]) {
      throw conflict(
        existing.rows[0].status === 'deactivated'
          ? `${b.email} was removed earlier. Find them in the list and choose "Give access again".`
          : `${b.email} already has access.`,
        { fields: { email: 'Already in the list' } },
      );
    }
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO users (email, first_name, last_name, role_id, status, created_by) VALUES ($1, $2, $3, $4, 'invited', $5) RETURNING id`,
      [b.email, b.firstName, b.lastName, await roleId(q, b.isAdmin ? 'admin' : 'employee'), actor.id],
    );
    const t = await issueUserToken(rows[0].id, 'invite', actor.id, env.INVITE_TTL_HOURS, q);
    await audit(req, { action: 'person.added', entityType: 'user', entityId: rows[0].id, metadata: { email: b.email, isAdmin: b.isAdmin } }, q);
    return { id: rows[0].id, token: t };
  });
  res.status(201).json({ person: serialize(await loadPerson(id)), inviteUrl: inviteUrl(token), expiresInHours: env.INVITE_TTL_HOURS });
});

/** "Can manage documents?" — switch between Admin and Employee. */
peopleRouter.patch('/:id', async (req, res) => {
  const actor = currentUser(req);
  const id = parse(uuid, req.params.id);
  const { isAdmin } = parse(z.object({ isAdmin: z.boolean() }), req.body);
  if (id === actor.id) throw badRequest('You cannot change your own access.');
  await db().tx(async (q) => {
    const p = await loadPerson(id, q);
    if (p.role === 'admin' && !isAdmin) await assertAnotherAdmin(q, id);
    await q.query('UPDATE users SET role_id = $2 WHERE id = $1', [id, await roleId(q, isAdmin ? 'admin' : 'employee')]);
    await revokeAllSessions(id, q); // new access level applies at next sign-in
    await audit(req, { action: isAdmin ? 'person.made_admin' : 'person.made_employee', entityType: 'user', entityId: id }, q);
  });
  res.json(serialize(await loadPerson(id)));
});

/** Single-use link to set a new password; signs the person out everywhere. */
peopleRouter.post('/:id/reset-password', async (req, res) => {
  const actor = currentUser(req);
  const id = parse(uuid, req.params.id);
  const result = await db().tx(async (q) => {
    const p = await loadPerson(id, q);
    if (p.status === 'deactivated') throw badRequest('Give this person access again first.');
    const purpose = p.status === 'invited' ? 'invite' : 'password_reset';
    const t = await issueUserToken(id, purpose, actor.id, purpose === 'invite' ? env.INVITE_TTL_HOURS : RESET_HOURS, q);
    await revokeAllSessions(id, q);
    await audit(req, { action: purpose === 'invite' ? 'person.invite_resent' : 'person.password_reset_sent', entityType: 'user', entityId: id }, q);
    return { url: inviteUrl(t), hours: purpose === 'invite' ? env.INVITE_TTL_HOURS : RESET_HOURS, kind: purpose === 'invite' ? 'invite' : 'reset' };
  });
  res.json(result);
});

peopleRouter.post('/:id/remove', async (req, res) => {
  const actor = currentUser(req);
  const id = parse(uuid, req.params.id);
  if (id === actor.id) throw badRequest('You cannot remove your own access.');
  await db().tx(async (q) => {
    const p = await loadPerson(id, q);
    if (p.role === 'admin') await assertAnotherAdmin(q, id);
    await q.query(`UPDATE users SET status = 'deactivated' WHERE id = $1`, [id]);
    await q.query('UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [id]);
    await revokeAllSessions(id, q);
    await audit(req, { action: 'person.removed', entityType: 'user', entityId: id }, q);
  });
  res.json(serialize(await loadPerson(id)));
});

peopleRouter.post('/:id/restore', async (req, res) => {
  const actor = currentUser(req);
  const id = parse(uuid, req.params.id);
  const out = await db().tx(async (q) => {
    const { rows } = await q.query<{ has_password: boolean }>('SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Person');
    const status = rows[0].has_password ? 'active' : 'invited';
    await q.query('UPDATE users SET status = $2, failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [id, status]);
    await audit(req, { action: 'person.restored', entityType: 'user', entityId: id }, q);
    return status === 'invited' ? await issueUserToken(id, 'invite', actor.id, env.INVITE_TTL_HOURS, q) : null;
  });
  res.json({ person: serialize(await loadPerson(id)), inviteUrl: out ? inviteUrl(out) : null, expiresInHours: out ? env.INVITE_TTL_HOURS : null });
});

/** For a lost phone: removes two-step sign-in so they can set it up again. */
peopleRouter.post('/:id/reset-two-step', async (req, res) => {
  const actor = currentUser(req);
  const id = parse(uuid, req.params.id);
  if (id === actor.id) throw badRequest('Use "My account" to change your own two-step sign-in.');
  await db().tx(async (q) => {
    await loadPerson(id, q);
    await clearMfa(id, q);
    await revokeAllSessions(id, q);
    await audit(req, { action: 'person.two_step_reset', entityType: 'user', entityId: id }, q);
  });
  res.json(serialize(await loadPerson(id)));
});
