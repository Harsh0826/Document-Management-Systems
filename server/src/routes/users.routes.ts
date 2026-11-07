import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { db, type Queryable } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { Where, type Paged } from '../lib/http.js';
import { email, isoDate, likeEscape, nonEmpty, pagination, parse, password, trimmed, uuid } from '../lib/validate.js';
import { authenticate, currentUser, requirePermission } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { hashPassword, inviteUrl, issueUserToken, revokeAllSessions } from '../services/auth.js';
import { ensureEmployeeRoot } from '../services/folders.js';
import { notify } from '../services/notifications.js';
import { ALL_PERMISSIONS, STAFF_GRANTABLE, type PermissionKey, type RoleName } from '../types.js';

export const usersRouter = Router();
usersRouter.use(authenticate, requirePermission('users.manage'));

const permissionKey = z.enum(ALL_PERMISSIONS as [PermissionKey, ...PermissionKey[]]);
const optText = (max: number) => trimmed(max).optional().nullable().transform((v) => (v ? v : null));
const optDate = z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));

// ---- Helpers ---------------------------------------------------------------------------
async function roleId(q: Queryable, role: RoleName) {
  const { rows } = await q.query<{ id: number }>('SELECT id FROM roles WHERE name = $1', [role]);
  return rows[0].id;
}

async function setStaffPermissions(q: Queryable, userId: string, perms: PermissionKey[], grantedBy: string) {
  const invalid = perms.filter((p) => !STAFF_GRANTABLE.includes(p));
  if (invalid.length) throw badRequest(`These permissions cannot be granted to staff: ${invalid.join(', ')}`);
  await q.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);
  if (perms.length) {
    await q.query(
      `INSERT INTO user_permissions (user_id, permission_id, granted_by)
       SELECT $1, id, $3 FROM permissions WHERE key = ANY($2::text[])`,
      [userId, perms, grantedBy],
    );
  }
}

async function setStaffClients(q: Queryable, userId: string, clientIds: string[], assignedBy: string) {
  const ids = [...new Set(clientIds)];
  if (ids.length) {
    const { rows } = await q.query<{ n: number }>('SELECT count(*) AS n FROM clients WHERE id = ANY($1::uuid[])', [ids]);
    if (rows[0].n !== ids.length) throw badRequest('One or more clients do not exist');
  }
  await q.query('DELETE FROM staff_client_assignments WHERE staff_user_id = $1', [userId]);
  if (ids.length) {
    await q.query(
      `INSERT INTO staff_client_assignments (staff_user_id, client_id, assigned_by) SELECT $1, c, $3 FROM unnest($2::uuid[]) AS c`,
      [userId, ids, assignedBy],
    );
  }
}

async function getUserDetail(id: string) {
  const { rows } = await db().query<Record<string, any>>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.job_title, u.status, r.name AS role,
            u.last_login_at, u.created_at, u.updated_at, u.locked_until,
            e.id AS employee_id, e.client_id, c.name AS client_name, e.employee_number, e.department, e.position, e.hire_date,
            ARRAY(SELECT p.key FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = u.id ORDER BY p.key) AS granted_permissions,
            ARRAY(SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = u.role_id ORDER BY p.key) AS role_permissions,
            COALESCE((SELECT json_agg(json_build_object('id', c2.id, 'name', c2.name, 'code', c2.code) ORDER BY c2.name)
               FROM staff_client_assignments sca JOIN clients c2 ON c2.id = sca.client_id WHERE sca.staff_user_id = u.id), '[]'::json) AS assigned_clients,
            (SELECT count(*) FROM documents d WHERE d.employee_id = e.id AND d.deleted_at IS NULL) AS document_count
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN employees e ON e.user_id = u.id
       LEFT JOIN clients c ON c.id = e.client_id
      WHERE u.id = $1`,
    [id],
  );
  const u = rows[0];
  if (!u) throw notFound('User');
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    phone: u.phone,
    jobTitle: u.job_title,
    status: u.status,
    role: u.role,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    lockedUntil: u.locked_until,
    employee: u.employee_id
      ? {
          id: u.employee_id,
          clientId: u.client_id,
          clientName: u.client_name,
          employeeNumber: u.employee_number,
          department: u.department,
          position: u.position,
          hireDate: u.hire_date,
          documentCount: u.document_count,
        }
      : null,
    grantedPermissions: u.granted_permissions,
    rolePermissions: u.role_permissions,
    assignedClients: u.assigned_clients,
  };
}

// ---- GET /api/users/permissions -----------------------------------------------------------
usersRouter.get('/permissions', async (_req, res) => {
  const { rows } = await db().query<{ key: PermissionKey; description: string }>('SELECT key, description FROM permissions ORDER BY id');
  res.json(rows.map((p) => ({ ...p, grantableToStaff: STAFF_GRANTABLE.includes(p.key) })));
});

// ---- GET /api/users ----------------------------------------------------------------------------
const listSchema = pagination.extend({
  q: trimmed(100).optional(),
  role: z.enum(['admin', 'staff', 'employee']).optional(),
  status: z.enum(['invited', 'active', 'deactivated']).optional(),
  clientId: uuid.optional(),
});

usersRouter.get('/', async (req, res) => {
  const f = parse(listSchema, req.query);
  const w = new Where();
  if (f.q) {
    const like = `%${likeEscape(f.q)}%`;
    w.add(`(u.first_name || ' ' || u.last_name) ILIKE ? OR u.email ILIKE ? OR e.employee_number ILIKE ?`, like, like, like);
  }
  if (f.role) w.add('r.name = ?', f.role);
  if (f.status) w.add('u.status = ?', f.status);
  if (f.clientId) {
    w.add('(e.client_id = ? OR EXISTS (SELECT 1 FROM staff_client_assignments s WHERE s.staff_user_id = u.id AND s.client_id = ?))', f.clientId, f.clientId);
  }
  const from = `FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN employees e ON e.user_id = u.id LEFT JOIN clients c ON c.id = e.client_id ${w.sql}`;
  const [{ rows: count }, { rows }] = await Promise.all([
    db().query<{ n: number }>(`SELECT count(*) AS n ${from}`, w.params),
    db().query<Record<string, any>>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.status, r.name AS role, u.job_title, u.last_login_at, u.created_at,
              e.id AS employee_id, e.employee_number, e.department, c.id AS client_id, c.name AS client_name,
              (SELECT count(*) FROM staff_client_assignments s WHERE s.staff_user_id = u.id) AS assigned_client_count,
              (SELECT count(*) FROM documents d WHERE d.employee_id = e.id AND d.deleted_at IS NULL) AS document_count
       ${from}
       ORDER BY u.created_at DESC
       LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      w.params,
    ),
  ]);
  const out: Paged<unknown> = {
    total: count[0].n,
    page: f.page,
    pageSize: f.pageSize,
    items: rows.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      status: u.status,
      role: u.role,
      jobTitle: u.job_title,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
      employeeId: u.employee_id,
      employeeNumber: u.employee_number,
      department: u.department,
      clientId: u.client_id,
      clientName: u.client_name,
      assignedClientCount: u.assigned_client_count,
      documentCount: u.document_count,
    })),
  };
  res.json(out);
});

usersRouter.get('/:id', async (req, res) => {
  res.json(await getUserDetail(parse(uuid, req.params.id)));
});

// ---- POST /api/users  (create + invite) ---------------------------------------------------------
const createSchema = z
  .object({
    email,
    firstName: nonEmpty(100),
    lastName: nonEmpty(100),
    role: z.enum(['admin', 'staff', 'employee']),
    phone: optText(40),
    jobTitle: optText(100),
    // employee
    clientId: uuid.optional(),
    employeeNumber: optText(50),
    department: optText(100),
    position: optText(100),
    hireDate: optDate,
    // staff
    permissions: z.array(permissionKey).max(20).default([]),
    clientIds: z.array(uuid).max(500).default([]),
    // optional initial password; without it the user receives an invitation link
    password: password.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'employee' && !v.clientId) ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'Select the employee’s company' });
  });

usersRouter.post('/', async (req, res) => {
  const actor = currentUser(req);
  const b = parse(createSchema, req.body);
  const passwordHash = b.password ? await hashPassword(b.password) : null;

  const result = await db().tx(async (q) => {
    const dupe = await q.query('SELECT 1 FROM users WHERE lower(email) = $1', [b.email]);
    if (dupe.rows.length) throw conflict('A user with this email already exists', { fields: { email: 'Email already in use' } });

    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone, job_title, role_id, status, password_changed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [b.email, passwordHash, b.firstName, b.lastName, b.phone, b.jobTitle, await roleId(q, b.role), passwordHash ? 'active' : 'invited', passwordHash ? new Date() : null, actor.id],
    );
    const userId = rows[0].id;

    if (b.role === 'employee') {
      const client = await q.query('SELECT 1 FROM clients WHERE id = $1', [b.clientId]);
      if (!client.rows.length) throw badRequest('Client does not exist');
      if (b.employeeNumber) {
        const taken = await q.query('SELECT 1 FROM employees WHERE client_id = $1 AND employee_number = $2', [b.clientId, b.employeeNumber]);
        if (taken.rows.length) throw conflict('Employee number already used for this client', { fields: { employeeNumber: 'Already in use' } });
      }
      const { rows: emp } = await q.query<{ id: string }>(
        `INSERT INTO employees (user_id, client_id, employee_number, department, position, hire_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [userId, b.clientId, b.employeeNumber, b.department, b.position, b.hireDate],
      );
      await ensureEmployeeRoot(emp[0].id, q);
    }
    if (b.role === 'staff') {
      await setStaffPermissions(q, userId, b.permissions, actor.id);
      await setStaffClients(q, userId, b.clientIds, actor.id);
    }

    const token = passwordHash ? null : await issueUserToken(userId, 'invite', actor.id, env.INVITE_TTL_HOURS, q);
    await audit(req, { action: 'user.created', entityType: 'user', entityId: userId, clientId: b.clientId ?? null, metadata: { role: b.role, email: b.email, invited: !passwordHash } }, q);
    await notify([userId], { type: 'account', title: 'Welcome to DMS', message: 'Your account has been created. Complete your profile and upload any requested documents.', link: '/profile' }, q);
    return { userId, token };
  });

  res.status(201).json({
    user: await getUserDetail(result.userId),
    inviteUrl: result.token ? inviteUrl(result.token) : null,
    inviteExpiresInHours: result.token ? env.INVITE_TTL_HOURS : null,
  });
});

// ---- PATCH /api/users/:id -----------------------------------------------------------------------
const updateSchema = z.object({
  email: email.optional(),
  firstName: nonEmpty(100).optional(),
  lastName: nonEmpty(100).optional(),
  phone: optText(40),
  jobTitle: optText(100),
  role: z.enum(['admin', 'staff']).optional(), // admin ⇄ staff only; employees are tied to a client record
  employeeNumber: optText(50),
  department: optText(100),
  position: optText(100),
  hireDate: optDate,
});

usersRouter.patch('/:id', async (req, res) => {
  const actor = currentUser(req);
  const id = parse(uuid, req.params.id);
  const b = parse(updateSchema, req.body);
  const before = await getUserDetail(id);

  await db().tx(async (q) => {
    if (b.email && b.email !== before.email.toLowerCase()) {
      const dupe = await q.query('SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2', [b.email, id]);
      if (dupe.rows.length) throw conflict('A user with this email already exists', { fields: { email: 'Email already in use' } });
    }
    if (b.role && b.role !== before.role) {
      if (before.role === 'employee') throw badRequest('Employee accounts cannot change role');
      if (id === actor.id) throw badRequest('You cannot change your own role');
      if (before.role === 'admin') await assertNotLastAdmin(q, id);
      await q.query('UPDATE users SET role_id = $2 WHERE id = $1', [id, await roleId(q, b.role)]);
      if (b.role === 'admin') {
        await q.query('DELETE FROM user_permissions WHERE user_id = $1', [id]);
        await q.query('DELETE FROM staff_client_assignments WHERE staff_user_id = $1', [id]);
      }
    }
    await q.query(
      `UPDATE users SET email = COALESCE($2, email), first_name = COALESCE($3, first_name), last_name = COALESCE($4, last_name),
              phone = CASE WHEN $5::boolean THEN $6 ELSE phone END,
              job_title = CASE WHEN $7::boolean THEN $8 ELSE job_title END
        WHERE id = $1`,
      [id, b.email ?? null, b.firstName ?? null, b.lastName ?? null, 'phone' in req.body, b.phone, 'jobTitle' in req.body, b.jobTitle],
    );
    if (before.employee) {
      if (b.employeeNumber) {
        const taken = await q.query('SELECT 1 FROM employees WHERE client_id = $1 AND employee_number = $2 AND id <> $3', [before.employee.clientId, b.employeeNumber, before.employee.id]);
        if (taken.rows.length) throw conflict('Employee number already used for this client', { fields: { employeeNumber: 'Already in use' } });
      }
      const has = (k: string) => k in req.body;
      await q.query(
        `UPDATE employees SET
           employee_number = CASE WHEN $2::boolean THEN $3 ELSE employee_number END,
           department = CASE WHEN $4::boolean THEN $5 ELSE department END,
           position = CASE WHEN $6::boolean THEN $7 ELSE position END,
           hire_date = CASE WHEN $8::boolean THEN $9::date ELSE hire_date END
         WHERE id = $1`,
        [before.employee.id, has('employeeNumber'), b.employeeNumber, has('department'), b.department, has('position'), b.position, has('hireDate'), b.hireDate],
      );
    }
    await audit(req, { action: 'user.updated', entityType: 'user', entityId: id, clientId: before.employee?.clientId ?? null, metadata: { changes: Object.keys(req.body ?? {}) } }, q);
  });
  res.json(await getUserDetail(id));
});

async function assertNotLastAdmin(q: Queryable, userId: string) {
  const { rows } = await q.query<{ n: number }>(
    `SELECT count(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.status = 'active' AND u.id <> $1`,
    [userId],
  );
  if (rows[0].n === 0) throw badRequest('At least one active administrator is required');
}

// ---- Staff permissions & client assignments ----------------------------------------------------------
const permsSchema = z.object({ permissions: z.array(permissionKey).max(20) });
usersRouter.put('/:id/permissions', async (req, res) => {
  const actor = currentUser(req);
  const id = parse(uuid, req.params.id);
  const { permissions } = parse(permsSchema, req.body);
  const user = await getUserDetail(id);
  if (user.role !== 'staff') throw badRequest('Permissions can only be configured for staff users');
  await db().tx(async (q) => {
    await setStaffPermissions(q, id, permissions, actor.id);
    await audit(req, { action: 'user.permissions_changed', entityType: 'user', entityId: id, metadata: { before: user.grantedPermissions, after: permissions } }, q);
  });
  res.json(await getUserDetail(id));
});

const clientsSchema = z.object({ clientIds: z.array(uuid).max(500) });
usersRouter.put('/:id/clients', async (req, res) => {
  const actor = currentUser(req);
  const id = parse(uuid, req.params.id);
  const { clientIds } = parse(clientsSchema, req.body);
  const user = await getUserDetail(id);
  if (user.role !== 'staff') throw badRequest('Client assignments apply to staff users only');
  await db().tx(async (q) => {
    await setStaffClients(q, id, clientIds, actor.id);
    await audit(req, { action: 'user.clients_changed', entityType: 'user', entityId: id, metadata: { clientIds } }, q);
  });
  res.json(await getUserDetail(id));
});

// ---- Status changes -----------------------------------------------------------------------------
usersRouter.post('/:id/deactivate', async (req, res) => {
  const actor = currentUser(req);
  const id = parse(uuid, req.params.id);
  if (id === actor.id) throw badRequest('You cannot deactivate your own account');
  const user = await getUserDetail(id);
  await db().tx(async (q) => {
    if (user.role === 'admin') await assertNotLastAdmin(q, id);
    await q.query(`UPDATE users SET status = 'deactivated' WHERE id = $1`, [id]);
    await q.query(`UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [id]);
    await revokeAllSessions(id, q);
    await audit(req, { action: 'user.deactivated', entityType: 'user', entityId: id, clientId: user.employee?.clientId ?? null }, q);
  });
  res.json(await getUserDetail(id));
});

usersRouter.post('/:id/activate', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows } = await db().query<{ has_password: boolean }>('SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('User');
  await db().query(`UPDATE users SET status = $2, failed_login_attempts = 0, locked_until = NULL WHERE id = $1`, [id, rows[0].has_password ? 'active' : 'invited']);
  await audit(req, { action: 'user.activated', entityType: 'user', entityId: id });
  res.json(await getUserDetail(id));
});

/** Issues a fresh invitation link (for users who have not set a password yet). */
usersRouter.post('/:id/invite', async (req, res) => {
  const actor = currentUser(req);
  const id = parse(uuid, req.params.id);
  const user = await getUserDetail(id);
  if (user.status !== 'invited') throw badRequest('Only users who have not accepted their invitation can be re-invited');
  const token = await issueUserToken(id, 'invite', actor.id, env.INVITE_TTL_HOURS);
  await audit(req, { action: 'user.invite_issued', entityType: 'user', entityId: id });
  res.json({ inviteUrl: inviteUrl(token), inviteExpiresInHours: env.INVITE_TTL_HOURS });
});
