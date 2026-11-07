import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { Where } from '../lib/http.js';
import { email, likeEscape, nonEmpty, pagination, parse, trimmed, uuid } from '../lib/validate.js';
import { authenticate, currentUser, requirePermission } from '../middleware/auth.js';
import { assertClientAccess, loadEmployeeInScope } from '../services/access.js';
import { audit } from '../services/audit.js';
import { ensureClientRoot } from '../services/folders.js';

// ============================== Clients ==============================
export const clientsRouter = Router();
clientsRouter.use(authenticate);

const clientRow = (c: Record<string, any>) => ({
  id: c.id,
  name: c.name,
  code: c.code,
  industry: c.industry,
  contactEmail: c.contact_email,
  isActive: c.is_active,
  createdAt: c.created_at,
  employeeCount: c.employee_count,
  documentCount: c.document_count,
  pendingCount: c.pending_count,
  staffCount: c.staff_count,
});

const CLIENT_SELECT = `
  SELECT c.*,
    (SELECT count(*) FROM employees e WHERE e.client_id = c.id) AS employee_count,
    (SELECT count(*) FROM documents d WHERE d.client_id = c.id AND d.deleted_at IS NULL) AS document_count,
    (SELECT count(*) FROM documents d WHERE d.client_id = c.id AND d.deleted_at IS NULL AND NOT d.is_archived AND d.status = 'pending_review') AS pending_count,
    (SELECT count(*) FROM staff_client_assignments s WHERE s.client_id = c.id) AS staff_count
  FROM clients c`;

clientsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const f = parse(z.object({ q: trimmed(100).optional(), includeInactive: z.enum(['true', 'false']).optional() }), req.query);
  const w = new Where();
  if (user.role === 'staff') w.add('c.id = ANY(?::uuid[])', user.clientIds);
  if (user.role === 'employee') w.add('c.id = ?', user.clientId);
  if (f.q) w.add('c.name ILIKE ? OR c.code ILIKE ?', `%${likeEscape(f.q)}%`, `%${likeEscape(f.q)}%`);
  if (f.includeInactive !== 'true') w.add('c.is_active');
  const { rows } = await db().query(`${CLIENT_SELECT} ${w.sql} ORDER BY c.name`, w.params);
  res.json(rows.map(clientRow));
});

clientsRouter.get('/:id', async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  assertClientAccess(user, id);
  const { rows } = await db().query(`${CLIENT_SELECT} WHERE c.id = $1`, [id]);
  if (!rows[0]) throw notFound('Client');
  res.json(clientRow(rows[0]));
});

const clientSchema = z.object({
  name: nonEmpty(200),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, '2–20 letters, digits or dashes'),
  industry: trimmed(100).optional().nullable(),
  contactEmail: z.union([email, z.literal(''), z.null()]).optional(),
  isActive: z.boolean().optional(),
});

clientsRouter.post('/', requirePermission('clients.manage'), async (req, res) => {
  const b = parse(clientSchema, req.body);
  const id = await db().tx(async (q) => {
    const dupe = await q.query('SELECT 1 FROM clients WHERE code = $1', [b.code]);
    if (dupe.rows.length) throw conflict('Client code already exists', { fields: { code: 'Already in use' } });
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO clients (name, code, industry, contact_email) VALUES ($1, $2, $3, $4) RETURNING id`,
      [b.name, b.code, b.industry || null, b.contactEmail || null],
    );
    await ensureClientRoot(rows[0].id, q);
    await audit(req, { action: 'client.created', entityType: 'client', entityId: rows[0].id, clientId: rows[0].id, metadata: { name: b.name, code: b.code } }, q);
    return rows[0].id;
  });
  const { rows } = await db().query(`${CLIENT_SELECT} WHERE c.id = $1`, [id]);
  res.status(201).json(clientRow(rows[0]));
});

clientsRouter.patch('/:id', requirePermission('clients.manage'), async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(clientSchema.partial(), req.body);
  await db().tx(async (q) => {
    const existing = await q.query<{ name: string }>('SELECT name FROM clients WHERE id = $1', [id]);
    if (!existing.rows[0]) throw notFound('Client');
    if (b.code) {
      const dupe = await q.query('SELECT 1 FROM clients WHERE code = $1 AND id <> $2', [b.code, id]);
      if (dupe.rows.length) throw conflict('Client code already exists', { fields: { code: 'Already in use' } });
    }
    await q.query(
      `UPDATE clients SET name = COALESCE($2, name), code = COALESCE($3, code),
              industry = CASE WHEN $4::boolean THEN $5 ELSE industry END,
              contact_email = CASE WHEN $6::boolean THEN $7 ELSE contact_email END,
              is_active = COALESCE($8, is_active)
        WHERE id = $1`,
      [id, b.name ?? null, b.code ?? null, 'industry' in req.body, b.industry || null, 'contactEmail' in req.body, b.contactEmail || null, b.isActive ?? null],
    );
    // Keep the root folder name in sync with the company name.
    if (b.name) await q.query(`UPDATE folders SET name = $2 WHERE client_id = $1 AND kind = 'client_root'`, [id, b.name]);
    await audit(req, { action: 'client.updated', entityType: 'client', entityId: id, clientId: id, metadata: { changes: Object.keys(req.body ?? {}) } }, q);
  });
  const { rows } = await db().query(`${CLIENT_SELECT} WHERE c.id = $1`, [id]);
  res.json(clientRow(rows[0]));
});

// ============================== Employees (scoped directory) ==============================
export const employeesRouter = Router();
employeesRouter.use(authenticate);

employeesRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const f = parse(pagination.extend({ q: trimmed(100).optional(), clientId: uuid.optional(), pageSize: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
  const w = new Where();
  if (user.role === 'staff') {
    if (!user.permissions.has('documents.view')) w.add('false');
    w.add('e.client_id = ANY(?::uuid[])', user.clientIds);
  }
  if (user.role === 'employee') w.add('e.id = ?', user.employeeId);
  if (f.clientId) w.add('e.client_id = ?', f.clientId);
  if (f.q) {
    const like = `%${likeEscape(f.q)}%`;
    w.add(`(u.first_name || ' ' || u.last_name) ILIKE ? OR u.email ILIKE ? OR e.employee_number ILIKE ?`, like, like, like);
  }
  const from = `FROM employees e JOIN users u ON u.id = e.user_id JOIN clients c ON c.id = e.client_id ${w.sql}`;
  const [{ rows: count }, { rows }] = await Promise.all([
    db().query<{ n: number }>(`SELECT count(*) AS n ${from}`, w.params),
    db().query<Record<string, any>>(
      `SELECT e.id, e.user_id, e.client_id, c.name AS client_name, e.employee_number, e.department, e.position, e.hire_date,
              u.first_name, u.last_name, u.email, u.status,
              (SELECT count(*) FROM documents d WHERE d.employee_id = e.id AND d.deleted_at IS NULL) AS document_count,
              (SELECT count(*) FROM documents d WHERE d.employee_id = e.id AND d.deleted_at IS NULL AND NOT d.is_archived AND d.status = 'pending_review') AS pending_count,
              (SELECT count(*) FROM documents d WHERE d.employee_id = e.id AND d.deleted_at IS NULL AND NOT d.is_archived AND d.status = 'expired') AS expired_count,
              (SELECT count(*) FROM document_requests r WHERE r.employee_id = e.id AND r.status = 'open') AS open_request_count
       ${from}
       ORDER BY u.last_name, u.first_name
       LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      w.params,
    ),
  ]);
  res.json({
    total: count[0].n,
    page: f.page,
    pageSize: f.pageSize,
    items: rows.map((e) => ({
      id: e.id,
      userId: e.user_id,
      clientId: e.client_id,
      clientName: e.client_name,
      employeeNumber: e.employee_number,
      department: e.department,
      position: e.position,
      hireDate: e.hire_date,
      firstName: e.first_name,
      lastName: e.last_name,
      email: e.email,
      status: e.status,
      documentCount: e.document_count,
      pendingCount: e.pending_count,
      expiredCount: e.expired_count,
      openRequestCount: e.open_request_count,
    })),
  });
});

employeesRouter.get('/:id', async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  await loadEmployeeInScope(user, id);
  const { rows } = await db().query<Record<string, any>>(
    `SELECT e.*, c.name AS client_name, u.first_name, u.last_name, u.email, u.status, u.phone, u.job_title,
            (SELECT json_object_agg(status, n) FROM (SELECT status, count(*) AS n FROM documents d WHERE d.employee_id = e.id AND d.deleted_at IS NULL AND NOT d.is_archived GROUP BY status) s) AS status_counts
       FROM employees e JOIN users u ON u.id = e.user_id JOIN clients c ON c.id = e.client_id WHERE e.id = $1`,
    [id],
  );
  const e = rows[0];
  res.json({
    id: e.id,
    userId: e.user_id,
    clientId: e.client_id,
    clientName: e.client_name,
    employeeNumber: e.employee_number,
    department: e.department,
    position: e.position,
    hireDate: e.hire_date,
    firstName: e.first_name,
    lastName: e.last_name,
    email: e.email,
    phone: e.phone,
    status: e.status,
    statusCounts: e.status_counts ?? {},
  });
});

// ============================== Categories ==============================
export const categoriesRouter = Router();
categoriesRouter.use(authenticate);

const categoryRow = (c: Record<string, any>) => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  description: c.description,
  isCertificate: c.is_certificate,
  requiresExpiry: c.requires_expiry,
  sortOrder: c.sort_order,
  documentCount: c.document_count,
});

categoriesRouter.get('/', async (_req, res) => {
  const { rows } = await db().query(
    `SELECT c.*, (SELECT count(*) FROM documents d WHERE d.category_id = c.id AND d.deleted_at IS NULL) AS document_count
       FROM document_categories c ORDER BY c.sort_order, c.name`,
  );
  res.json(rows.map(categoryRow));
});

const categorySchema = z.object({
  name: nonEmpty(100),
  description: trimmed(500).optional().nullable(),
  isCertificate: z.boolean().default(false),
  requiresExpiry: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(50),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'category';

categoriesRouter.post('/', requirePermission('clients.manage'), async (req, res) => {
  const b = parse(categorySchema, req.body);
  const dupe = await db().query('SELECT 1 FROM document_categories WHERE lower(name) = lower($1)', [b.name]);
  if (dupe.rows.length) throw conflict('A category with this name exists', { fields: { name: 'Already exists' } });
  const { rows } = await db().query(
    `INSERT INTO document_categories (name, slug, description, is_certificate, requires_expiry, sort_order)
     VALUES ($1, $2 || '-' || substr(md5(random()::text), 1, 6), $3, $4, $5, $6) RETURNING *, 0 AS document_count`,
    [b.name, slugify(b.name), b.description || null, b.isCertificate, b.requiresExpiry, b.sortOrder],
  );
  await audit(req, { action: 'category.created', entityType: 'category', entityId: rows[0].id as string, metadata: { name: b.name } });
  res.status(201).json(categoryRow(rows[0]));
});

categoriesRouter.patch('/:id', requirePermission('clients.manage'), async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(categorySchema.partial(), req.body);
  if (b.name) {
    const dupe = await db().query('SELECT 1 FROM document_categories WHERE lower(name) = lower($1) AND id <> $2', [b.name, id]);
    if (dupe.rows.length) throw conflict('A category with this name exists', { fields: { name: 'Already exists' } });
  }
  const { rows } = await db().query(
    `UPDATE document_categories SET name = COALESCE($2, name),
            description = CASE WHEN $3::boolean THEN $4 ELSE description END,
            is_certificate = COALESCE($5, is_certificate), requires_expiry = COALESCE($6, requires_expiry), sort_order = COALESCE($7, sort_order)
      WHERE id = $1 RETURNING *, (SELECT count(*) FROM documents d WHERE d.category_id = $1 AND d.deleted_at IS NULL) AS document_count`,
    [id, b.name ?? null, 'description' in req.body, b.description || null, b.isCertificate ?? null, b.requiresExpiry ?? null, b.sortOrder ?? null],
  );
  if (!rows[0]) throw notFound('Category');
  await audit(req, { action: 'category.updated', entityType: 'category', entityId: id, metadata: { changes: Object.keys(req.body ?? {}) } });
  res.json(categoryRow(rows[0]));
});

categoriesRouter.delete('/:id', requirePermission('clients.manage'), async (req, res) => {
  const id = parse(uuid, req.params.id);
  const used = await db().query<{ n: number }>('SELECT count(*) AS n FROM documents WHERE category_id = $1 AND deleted_at IS NULL', [id]);
  if (used.rows[0].n > 0) throw conflict(`This category is used by ${used.rows[0].n} document(s). Recategorize them first.`);
  const { rowCount } = await db().query('DELETE FROM document_categories WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Category');
  await audit(req, { action: 'category.deleted', entityType: 'category', entityId: id });
  res.status(204).end();
});
