import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { forbidden, notFound } from '../lib/errors.js';
import { Where } from '../lib/http.js';
import { isoDate, likeEscape, pagination, parse, trimmed, uuid } from '../lib/validate.js';
import { authenticate, currentUser, requirePermission } from '../middleware/auth.js';
import { applyScope } from '../services/access.js';
import { audit } from '../services/audit.js';
import { DOCUMENT_SELECT, serializeDocument } from '../services/documents.js';
import { contentDisposition, localStorageDriver } from '../services/storage.js';

// ============================== Notifications ==============================
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const f = parse(pagination.extend({ unreadOnly: z.enum(['true', 'false']).optional() }), req.query);
  const unread = f.unreadOnly === 'true' ? 'AND NOT is_read' : '';
  const [{ rows: count }, { rows }, { rows: unreadCount }] = await Promise.all([
    db().query<{ n: number }>(`SELECT count(*) AS n FROM notifications WHERE user_id = $1 ${unread}`, [user.id]),
    db().query<Record<string, any>>(
      `SELECT * FROM notifications WHERE user_id = $1 ${unread} ORDER BY created_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      [user.id],
    ),
    db().query<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [user.id]),
  ]);
  res.json({
    total: count[0].n,
    unread: unreadCount[0].n,
    page: f.page,
    pageSize: f.pageSize,
    items: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      link: n.link,
      entityType: n.entity_type,
      entityId: n.entity_id,
      isRead: n.is_read,
      createdAt: n.created_at,
    })),
  });
});

notificationsRouter.get('/unread-count', async (req, res) => {
  const user = currentUser(req);
  const { rows } = await db().query<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [user.id]);
  res.json({ unread: rows[0].n });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const user = currentUser(req);
  await db().query('UPDATE notifications SET is_read = TRUE, read_at = now() WHERE user_id = $1 AND NOT is_read', [user.id]);
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const user = currentUser(req);
  const { rowCount } = await db().query(
    'UPDATE notifications SET is_read = TRUE, read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2',
    [parse(uuid, req.params.id), user.id],
  );
  if (!rowCount) throw notFound('Notification');
  res.json({ ok: true });
});

// ============================== Audit logs ==============================
export const auditRouter = Router();
auditRouter.use(authenticate, requirePermission('audit.view'));

const auditSchema = pagination.extend({
  q: trimmed(100).optional(),
  action: trimmed(100).optional(),
  entityType: trimmed(50).optional(),
  entityId: trimmed(100).optional(),
  actorId: uuid.optional(),
  clientId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

auditRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const f = parse(auditSchema, req.query);
  const w = new Where();
  // Staff only see activity for their assigned clients.
  if (user.role === 'staff') w.add('a.client_id = ANY(?::uuid[])', user.clientIds);
  if (f.action) w.add('a.action = ?', f.action);
  if (f.entityType) w.add('a.entity_type = ?', f.entityType);
  if (f.entityId) w.add('a.entity_id = ?', f.entityId);
  if (f.actorId) w.add('a.actor_id = ?', f.actorId);
  if (f.clientId) w.add('a.client_id = ?', f.clientId);
  if (f.from) w.add('a.created_at >= ?::date', f.from);
  if (f.to) w.add(`a.created_at < ?::date + interval '1 day'`, f.to);
  if (f.q) {
    const like = `%${likeEscape(f.q)}%`;
    w.add(`a.actor_email ILIKE ? OR a.action ILIKE ? OR a.metadata::text ILIKE ?`, like, like, like);
  }
  const from = `FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN clients c ON c.id = a.client_id ${w.sql}`;
  const [{ rows: count }, { rows }] = await Promise.all([
    db().query<{ n: number }>(`SELECT count(*) AS n ${from}`, w.params),
    db().query<Record<string, any>>(
      `SELECT a.*, u.first_name || ' ' || u.last_name AS actor_name, c.name AS client_name,
              (SELECT d.title FROM documents d WHERE a.entity_type = 'document' AND d.id::text = a.entity_id) AS document_title ${from}
        ORDER BY a.created_at DESC, a.id DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      w.params,
    ),
  ]);
  res.json({
    total: count[0].n,
    page: f.page,
    pageSize: f.pageSize,
    items: rows.map((a) => ({
      id: String(a.id),
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      actorId: a.actor_id,
      actorName: a.actor_name,
      actorEmail: a.actor_email,
      clientId: a.client_id,
      clientName: a.client_name,
      ip: a.ip,
      userAgent: a.user_agent,
      metadata: a.metadata,
      documentTitle: a.document_title,
      createdAt: a.created_at,
    })),
  });
});

auditRouter.get('/actions', async (_req, res) => {
  const { rows } = await db().query<{ action: string }>('SELECT DISTINCT action FROM audit_logs ORDER BY action');
  res.json(rows.map((r) => r.action));
});

// ============================== Dashboard ==============================
export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  if (user.role === 'staff' && !user.permissions.has('documents.view')) throw forbidden();

  const w = new Where();
  w.add('d.deleted_at IS NULL');
  w.add('NOT d.is_archived');
  applyScope(w, user, 'd');
  const scope = w.sql;
  const p = w.params;

  const ew = new Where();
  applyScope(ew, user, 'e', 'id');

  const [stats, employees, byMonth, byCategory, recentUploads, pending, expiring, requests] = await Promise.all([
    db().query<Record<string, number>>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE d.status = 'pending_review') AS pending,
              count(*) FILTER (WHERE d.status = 'approved') AS approved,
              count(*) FILTER (WHERE d.status = 'rejected') AS rejected,
              count(*) FILTER (WHERE d.status = 'expired') AS expired,
              count(*) FILTER (WHERE d.status = 'renewal_required') AS renewal_required,
              count(*) FILTER (WHERE d.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 AND d.status IN ('approved', 'pending_review', 'renewal_required')) AS expiring_30,
              count(*) FILTER (WHERE d.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 60 AND d.status IN ('approved', 'pending_review', 'renewal_required')) AS expiring_60,
              count(*) FILTER (WHERE d.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90 AND d.status IN ('approved', 'pending_review', 'renewal_required')) AS expiring_90
         FROM documents d ${scope}`,
      p,
    ),
    db().query<{ n: number }>(`SELECT count(*) AS n FROM employees e ${ew.sql}`, ew.params),
    db().query<{ month: string; uploads: number }>(
      `SELECT to_char(m, 'YYYY-MM') AS month,
              (SELECT count(*) FROM document_versions v JOIN documents d ON d.id = v.document_id
                ${scope} AND date_trunc('month', v.created_at) = m) AS uploads
         FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m
        ORDER BY m`,
      p,
    ),
    db().query<{ name: string; count: number }>(
      `SELECT COALESCE(cat.name, 'Uncategorized') AS name, count(*) AS count
         FROM documents d LEFT JOIN document_categories cat ON cat.id = d.category_id ${scope}
        GROUP BY 1 ORDER BY 2 DESC`,
      p,
    ),
    db().query(`${DOCUMENT_SELECT} ${scope} ORDER BY v.created_at DESC NULLS LAST LIMIT 6`, p),
    db().query(`${DOCUMENT_SELECT} ${scope} AND d.status = 'pending_review' ORDER BY v.created_at ASC LIMIT 6`, p),
    db().query(
      `${DOCUMENT_SELECT} ${scope} AND d.expiry_date IS NOT NULL AND d.expiry_date <= CURRENT_DATE + 90
        ORDER BY d.expiry_date ASC LIMIT 6`,
      p,
    ),
    (() => {
      const rw = new Where();
      rw.add(`r.status = 'open'`);
      applyScope(rw, user, 'r');
      return db().query<{ n: number; overdue: number }>(
        `SELECT count(*) AS n, count(*) FILTER (WHERE r.due_date < CURRENT_DATE) AS overdue FROM document_requests r ${rw.sql}`,
        rw.params,
      );
    })(),
  ]);

  // Recent activity, scoped: admins see everything, staff see their clients' activity when they hold
  // audit.view (otherwise their own actions), employees see actions on their own documents.
  const aw = new Where();
  if (user.role === 'staff') {
    if (user.permissions.has('audit.view')) aw.add('a.client_id = ANY(?::uuid[])', user.clientIds);
    else aw.add('a.actor_id = ?', user.id);
  } else if (user.role === 'employee') {
    aw.add(
      `a.action IN ('document.uploaded', 'document.version_uploaded', 'document.reviewed', 'document.updated', 'request.created')
       AND (a.actor_id = ? OR a.entity_id IN (SELECT id::text FROM documents WHERE employee_id = ?)
            OR a.entity_id IN (SELECT id::text FROM document_requests WHERE employee_id = ?))`,
      user.id, user.employeeId, user.employeeId,
    );
  }
  aw.add(`a.action NOT IN ('document.viewed', 'auth.login', 'auth.login_failed', 'auth.login_wrong_portal')`);
  const { rows: activity } = await db().query<Record<string, any>>(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at,
            COALESCE(u.first_name || ' ' || u.last_name, a.actor_email, 'System') AS actor_name,
            (SELECT title FROM documents WHERE a.entity_type = 'document' AND id::text = a.entity_id) AS document_title
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${aw.sql}
      ORDER BY a.created_at DESC LIMIT 10`,
    aw.params,
  );

  const s = stats.rows[0];
  res.json({
    totals: {
      employees: employees.rows[0].n,
      documents: s.total,
      pending: s.pending,
      approved: s.approved,
      rejected: s.rejected,
      expired: s.expired,
      renewalRequired: s.renewal_required,
      expiring30: s.expiring_30,
      expiring60: s.expiring_60,
      expiring90: s.expiring_90,
      openRequests: requests.rows[0].n,
      overdueRequests: requests.rows[0].overdue,
    },
    uploadsByMonth: byMonth.rows,
    byCategory: byCategory.rows,
    recentUploads: recentUploads.rows.map((r) => serializeDocument(r, user)),
    pendingApprovals: pending.rows.map((r) => serializeDocument(r, user)),
    expiringSoon: expiring.rows.map((r) => serializeDocument(r, user)),
    recentActivity: activity.map((a) => ({
      id: String(a.id),
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      documentTitle: a.document_title,
      metadata: a.metadata,
      actorName: a.actor_name,
      createdAt: a.created_at,
    })),
  });
});

// ============================== Local signed file URLs (development driver) ==============================
export const filesRouter = Router();

filesRouter.get('/:token', async (req, res) => {
  const local = localStorageDriver();
  if (!local) throw notFound('File');
  const claims = local.verify(String(req.params.token));
  if (!claims) {
    await audit(req, { action: 'file.url_rejected', metadata: { reason: 'invalid_or_expired' } });
    res.status(403).type('text/plain').send('This link is invalid or has expired.');
    return;
  }
  const stream = local.open(claims.k);
  if (!stream) throw notFound('File');
  res.set({
    'Content-Type': claims.t,
    'Content-Disposition': contentDisposition(claims.d, claims.f),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    // Only PDF/image/Office types are ever stored (validated on upload) and nosniff is set, so the
    // response cannot execute script. Allow same-origin framing for the in-app preview only.
    'Content-Security-Policy': "frame-ancestors 'self'",
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});
