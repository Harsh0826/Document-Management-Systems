import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { Where } from '../lib/http.js';
import { isoDate, nonEmpty, pagination, parse, trimmed, uuid } from '../lib/validate.js';
import { authenticate, currentUser, requirePermission } from '../middleware/auth.js';
import { applyScope, loadEmployeeInScope } from '../services/access.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notifications.js';

/** Document requests ("tasks"): staff/admin ask an employee to upload a missing document. */
export const requestsRouter = Router();
requestsRouter.use(authenticate);

const SELECT = `
  SELECT r.*, eu.first_name || ' ' || eu.last_name AS employee_name, c.name AS client_name, cat.name AS category_name,
         ru.first_name || ' ' || ru.last_name AS requested_by_name, d.title AS fulfilled_document_title,
         (r.due_date - CURRENT_DATE) AS days_until_due
    FROM document_requests r
    JOIN employees e ON e.id = r.employee_id
    JOIN users eu ON eu.id = e.user_id
    JOIN clients c ON c.id = r.client_id
    LEFT JOIN document_categories cat ON cat.id = r.category_id
    LEFT JOIN users ru ON ru.id = r.requested_by
    LEFT JOIN documents d ON d.id = r.fulfilled_document_id`;

const serialize = (r: Record<string, any>) => ({
  id: r.id,
  clientId: r.client_id,
  clientName: r.client_name,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  categoryId: r.category_id,
  categoryName: r.category_name,
  title: r.title,
  instructions: r.instructions,
  dueDate: r.due_date,
  daysUntilDue: r.days_until_due,
  status: r.status,
  requestedByName: r.requested_by_name,
  fulfilledDocumentId: r.fulfilled_document_id,
  fulfilledDocumentTitle: r.fulfilled_document_title,
  fulfilledAt: r.fulfilled_at,
  createdAt: r.created_at,
});

requestsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  if (user.role === 'staff' && !user.permissions.has('documents.view')) throw forbidden();
  const f = parse(
    pagination.extend({ status: z.enum(['open', 'fulfilled', 'cancelled']).optional(), employeeId: uuid.optional(), clientId: uuid.optional() }),
    req.query,
  );
  const w = new Where();
  applyScope(w, user, 'r');
  if (f.status) w.add('r.status = ?', f.status);
  if (f.employeeId) w.add('r.employee_id = ?', f.employeeId);
  if (f.clientId) w.add('r.client_id = ?', f.clientId);
  const [{ rows: count }, { rows }] = await Promise.all([
    db().query<{ n: number }>(`SELECT count(*) AS n FROM document_requests r ${w.sql}`, w.params),
    db().query(`${SELECT} ${w.sql} ORDER BY r.status = 'open' DESC, r.due_date NULLS LAST, r.created_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, w.params),
  ]);
  res.json({ total: count[0].n, page: f.page, pageSize: f.pageSize, items: rows.map(serialize) });
});

const createSchema = z.object({
  employeeIds: z.array(uuid).min(1).max(200),
  categoryId: uuid.optional().nullable(),
  title: nonEmpty(200),
  instructions: trimmed(2000).optional(),
  dueDate: z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => v || null),
});

requestsRouter.post('/', requirePermission('requests.manage'), async (req, res) => {
  const user = currentUser(req);
  const b = parse(createSchema, req.body);
  if (b.dueDate && b.dueDate < new Date().toISOString().slice(0, 10)) throw badRequest('Validation failed', { fields: { dueDate: 'Due date cannot be in the past' } });
  const ids = await db().tx(async (q) => {
    if (b.categoryId) {
      const cat = await q.query('SELECT 1 FROM document_categories WHERE id = $1', [b.categoryId]);
      if (!cat.rows.length) throw badRequest('Unknown category');
    }
    const created: string[] = [];
    for (const employeeId of new Set(b.employeeIds)) {
      const emp = await loadEmployeeInScope(user, employeeId, q);
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO document_requests (client_id, employee_id, category_id, title, instructions, due_date, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [emp.client_id, employeeId, b.categoryId ?? null, b.title, b.instructions || null, b.dueDate, user.id],
      );
      created.push(rows[0].id);
      await notify([emp.user_id], {
        type: 'document_requested',
        title: 'Document requested',
        message: `Please upload: ${b.title}${b.dueDate ? ` (due ${b.dueDate})` : ''}`,
        link: '/requests',
        entityType: 'document_request',
        entityId: rows[0].id,
      }, q);
      await audit(req, { action: 'request.created', entityType: 'document_request', entityId: rows[0].id, clientId: emp.client_id, metadata: { title: b.title, employeeId } }, q);
    }
    return created;
  });
  const { rows } = await db().query(`${SELECT} WHERE r.id = ANY($1::uuid[]) ORDER BY r.created_at`, [ids]);
  res.status(201).json(rows.map(serialize));
});

requestsRouter.post('/:id/cancel', requirePermission('requests.manage'), async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  const w = new Where();
  w.add('r.id = ?', id);
  applyScope(w, user, 'r');
  const { rows } = await db().query<{ id: string; status: string; client_id: string }>(`SELECT r.id, r.status, r.client_id FROM document_requests r ${w.sql}`, w.params);
  if (!rows[0]) throw notFound('Request');
  if (rows[0].status !== 'open') throw badRequest('Only open requests can be cancelled');
  await db().query(`UPDATE document_requests SET status = 'cancelled' WHERE id = $1`, [id]);
  await audit(req, { action: 'request.cancelled', entityType: 'document_request', entityId: id, clientId: rows[0].client_id });
  const { rows: out } = await db().query(`${SELECT} WHERE r.id = $1`, [id]);
  res.json(serialize(out[0]));
});
