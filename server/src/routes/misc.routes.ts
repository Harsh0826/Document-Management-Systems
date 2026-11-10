import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { Where } from '../lib/http.js';
import { isoDate, likeEscape, pagination, parse, trimmed, uuid } from '../lib/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { contentDisposition, localStorageDriver } from '../services/storage.js';

// ============================== Audit logs ==============================
export const auditRouter = Router();
// Activity is recorded silently; this export endpoint exists for IT/audits (no screen in the app).
auditRouter.use(authenticate, requireRole('admin'));

const auditSchema = pagination.extend({
  q: trimmed(100).optional(),
  action: trimmed(100).optional(),
  entityType: trimmed(50).optional(),
  entityId: trimmed(100).optional(),
  actorId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

auditRouter.get('/', async (req, res) => {
  const f = parse(auditSchema, req.query);
  const w = new Where();
  if (f.action) w.add('a.action = ?', f.action);
  if (f.entityType) w.add('a.entity_type = ?', f.entityType);
  if (f.entityId) w.add('a.entity_id = ?', f.entityId);
  if (f.actorId) w.add('a.actor_id = ?', f.actorId);
  if (f.from) w.add('a.created_at >= ?::date', f.from);
  if (f.to) w.add(`a.created_at < ?::date + interval '1 day'`, f.to);
  if (f.q) {
    const like = `%${likeEscape(f.q)}%`;
    w.add(`a.actor_email ILIKE ? OR a.action ILIKE ? OR a.metadata::text ILIKE ?`, like, like, like);
  }
  const from = `FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${w.sql}`;
  const [{ rows: count }, { rows }] = await Promise.all([
    db().query<{ n: number }>(`SELECT count(*) AS n ${from}`, w.params),
    db().query<Record<string, any>>(
      `SELECT a.*, COALESCE(a.actor_name, u.first_name || ' ' || u.last_name) AS actor_name,
              (SELECT lf.name FROM library_files lf WHERE a.entity_type = 'file' AND lf.id::text = a.entity_id) AS document_title ${from}
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
