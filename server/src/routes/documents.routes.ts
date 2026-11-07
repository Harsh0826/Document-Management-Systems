import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type Queryable } from '../db/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { Where } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { isoDate, likeEscape, nonEmpty, pagination, parse, trimmed, uuid } from '../lib/validate.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/security.js';
import {
  applyScope,
  assertOnDocument,
  documentCapabilities,
  loadDocument,
  loadEmployeeInScope,
  loadFolder,
  type DocumentRow,
} from '../services/access.js';
import { audit } from '../services/audit.js';
import { DOCUMENT_SELECT, serializeDocument, storageKey } from '../services/documents.js';
import { FILE_EXTS, PREVIEWABLE_EXTS, uploadSingle, validateUpload, type FileExt } from '../services/files.js';
import { ensureCategoryFolder, ensureEmployeeRoot, folderPath } from '../services/folders.js';
import { notify, reviewersForClient, userIdForEmployee } from '../services/notifications.js';
import { storage } from '../services/storage.js';
import type { AuthUser, DocumentStatus } from '../types.js';

export const documentsRouter = Router();
documentsRouter.use(authenticate);

const STATUSES = ['pending_review', 'approved', 'rejected', 'expired', 'renewal_required'] as const;
const optDate = z.union([isoDate, z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v));
const multipartUuid = z.union([uuid, z.literal('')]).optional().transform((v) => (v ? v : undefined));

const docLink = (id: string) => `/documents/${id}`;
const fullName = (u: AuthUser) => `${u.firstName} ${u.lastName}`;

function assertDates(issue?: string | null, expiry?: string | null) {
  if (issue && expiry && expiry < issue) {
    throw badRequest('Validation failed', { fields: { expiryDate: 'Expiration date must be after the issue date' } });
  }
}

// =====================================================================================
// GET /api/documents — search, filter, sort, paginate
// =====================================================================================
const SORTS: Record<string, string> = {
  title: 'd.title',
  employee: `eu.last_name || eu.first_name`,
  category: 'cat.name',
  fileType: 'v.file_ext',
  uploadedAt: 'v.created_at',
  expiryDate: 'd.expiry_date',
  status: 'd.status',
  client: 'c.name',
};

const csv = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []))
    .pipe(z.array(item).max(20));

const listSchema = pagination.extend({
  q: trimmed(200).optional(),
  clientId: uuid.optional(),
  employeeId: uuid.optional(),
  categoryId: csv(uuid),
  fileType: csv(z.enum(FILE_EXTS as [FileExt, ...FileExt[]])),
  status: csv(z.enum(STATUSES)),
  uploadedBy: uuid.optional(),
  uploadedFrom: isoDate.optional(),
  uploadedTo: isoDate.optional(),
  expiryFrom: isoDate.optional(),
  expiryTo: isoDate.optional(),
  expiringWithin: z.coerce.number().int().min(1).max(3650).optional(),
  folderId: uuid.optional(),
  includeSubfolders: z.enum(['true', 'false']).optional(),
  archived: z.enum(['exclude', 'only', 'include']).default('exclude'),
  sort: z.enum(Object.keys(SORTS) as [string, ...string[]]).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

documentsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  if (user.role !== 'employee' && !user.permissions.has('documents.view')) throw forbidden();
  const f = parse(listSchema, req.query);
  const w = new Where();
  w.add('d.deleted_at IS NULL');
  applyScope(w, user, 'd');

  if (f.q) {
    const like = `%${likeEscape(f.q)}%`;
    w.add(
      `d.title ILIKE ? OR v.original_filename ILIKE ? OR (eu.first_name || ' ' || eu.last_name) ILIKE ?
       OR cat.name ILIKE ? OR d.description ILIKE ? OR e.employee_number ILIKE ?
       OR EXISTS (SELECT 1 FROM document_versions ov WHERE ov.document_id = d.id AND ov.original_filename ILIKE ?)`,
      like, like, like, like, like, like, like,
    );
  }
  if (f.clientId) w.add('d.client_id = ?', f.clientId);
  if (f.employeeId) w.add('d.employee_id = ?', f.employeeId);
  if (f.categoryId.length) w.add('d.category_id = ANY(?::uuid[])', f.categoryId);
  if (f.fileType.length) {
    const exts = new Set<string>(f.fileType);
    if (exts.has('jpg') || exts.has('jpeg')) exts.add('jpg').add('jpeg');
    w.add('v.file_ext = ANY(?::text[])', [...exts]);
  }
  if (f.status.length) w.add('d.status = ANY(?::text[])', f.status);
  if (f.uploadedBy) w.add('v.uploaded_by = ?', f.uploadedBy);
  if (f.uploadedFrom) w.add('v.created_at >= ?::date', f.uploadedFrom);
  if (f.uploadedTo) w.add(`v.created_at < (?::date + interval '1 day')`, f.uploadedTo);
  if (f.expiryFrom) w.add('d.expiry_date >= ?::date', f.expiryFrom);
  if (f.expiryTo) w.add('d.expiry_date <= ?::date', f.expiryTo);
  if (f.expiringWithin) w.add(`d.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ?::int`, f.expiringWithin);
  if (f.folderId) {
    if (f.includeSubfolders === 'true') {
      w.add(
        `d.folder_id IN (WITH RECURSIVE sub AS (SELECT id FROM folders WHERE id = ? UNION ALL SELECT fo.id FROM folders fo JOIN sub ON fo.parent_id = sub.id) SELECT id FROM sub)`,
        f.folderId,
      );
    } else {
      w.add('d.folder_id = ?', f.folderId);
    }
  }
  if (f.archived === 'exclude') w.add('NOT d.is_archived');
  if (f.archived === 'only') w.add('d.is_archived');

  // With a search term and no explicit sort, rank prefix matches on title/filename, then employee name.
  const listParams = [...w.params];
  let relevance = '';
  if (f.q && !f.sort) {
    listParams.push(`${likeEscape(f.q)}%`);
    const p = `$${listParams.length}`;
    relevance = `CASE WHEN d.title ILIKE ${p} OR v.original_filename ILIKE ${p} THEN 0
                      WHEN (eu.first_name || ' ' || eu.last_name) ILIKE ${p} THEN 1 ELSE 2 END,`;
  }
  const orderBy = f.sort ? `${SORTS[f.sort]} ${f.order} NULLS LAST, d.id` : `${relevance} v.created_at DESC NULLS LAST, d.id`;
  const base = `${DOCUMENT_SELECT} ${w.sql}`;
  const [{ rows: count }, { rows }] = await Promise.all([
    db().query<{ n: number }>(`SELECT count(*) AS n FROM (${base}) x`, w.params),
    db().query(`${base} ORDER BY ${orderBy} LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, listParams),
  ]);
  res.json({ total: count[0].n, page: f.page, pageSize: f.pageSize, items: rows.map((r) => serializeDocument(r, user)) });
});

// =====================================================================================
// POST /api/documents — upload (multipart: file + metadata)
// =====================================================================================
const uploadSchema = z.object({
  title: nonEmpty(200),
  description: trimmed(2000).optional(),
  categoryId: multipartUuid,
  employeeId: multipartUuid,
  folderId: multipartUuid,
  requestId: multipartUuid,
  issueDate: optDate,
  expiryDate: optDate,
});

async function loadCategory(q: Queryable, id: string | undefined) {
  if (!id) return null;
  const { rows } = await q.query<{ id: string; name: string; requires_expiry: boolean }>('SELECT id, name, requires_expiry FROM document_categories WHERE id = $1', [id]);
  if (!rows[0]) throw badRequest('Validation failed', { fields: { categoryId: 'Unknown category' } });
  return rows[0];
}

/** A target folder must be visible to the user, in the document's client, and (if personal) the same employee's. */
async function resolveTargetFolder(user: AuthUser, folderId: string, clientId: string, employeeId: string, q: Queryable) {
  const folder = await loadFolder(user, folderId, q);
  if (folder.client_id !== clientId) throw badRequest('The folder belongs to a different client');
  if (folder.employee_id && folder.employee_id !== employeeId) throw badRequest("The folder belongs to a different employee's records");
  return folder.id;
}

documentsRouter.post('/', uploadLimiter, uploadSingle, async (req, res) => {
  const user = currentUser(req);
  const meta = parse(uploadSchema, req.body);
  assertDates(meta.issueDate, meta.expiryDate);

  // Who is the document for?
  let employeeId: string;
  if (user.role === 'employee') {
    if (!user.employeeId) throw forbidden();
    employeeId = user.employeeId;
  } else {
    if (!user.permissions.has('documents.upload')) throw forbidden();
    if (!meta.employeeId) throw badRequest('Validation failed', { fields: { employeeId: 'Select the employee this document belongs to' } });
    employeeId = meta.employeeId;
  }
  const employee = await loadEmployeeInScope(user, employeeId);
  const category = await loadCategory(db(), meta.categoryId);
  if (category?.requires_expiry && !meta.expiryDate) {
    throw badRequest('Validation failed', { fields: { expiryDate: `${category.name} require an expiration date` } });
  }

  const file = validateUpload(req.file);
  const documentId = randomUUID();
  const key = storageKey(employee.client_id, documentId, randomUUID(), file.ext);
  await storage().put(key, file.buffer, file.mime);

  try {
    const result = await db().tx(async (q) => {
      const folderId = meta.folderId
        ? await resolveTargetFolder(user, meta.folderId, employee.client_id, employeeId, q)
        : category
          ? await ensureCategoryFolder(employeeId, category.id, q)
          : await ensureEmployeeRoot(employeeId, q);

      await q.query(
        `INSERT INTO documents (id, client_id, employee_id, folder_id, category_id, title, description, issue_date, expiry_date, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [documentId, employee.client_id, employeeId, folderId, category?.id ?? null, meta.title, meta.description || null, meta.issueDate ?? null, meta.expiryDate ?? null, user.id],
      );
      const { rows: v } = await q.query<{ id: string }>(
        `INSERT INTO document_versions (document_id, version_number, storage_key, original_filename, file_ext, mime_type, size_bytes, checksum_sha256, issue_date, expiry_date, uploaded_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [documentId, key, file.originalName, file.ext, file.mime, file.size, file.checksum, meta.issueDate ?? null, meta.expiryDate ?? null, user.id],
      );
      await q.query('UPDATE documents SET current_version_id = $2 WHERE id = $1', [documentId, v[0].id]);

      // Fulfil the explicit request, or the oldest open request for the same category.
      const { rows: fulfilled } = await q.query<{ id: string; requested_by: string | null; title: string }>(
        `UPDATE document_requests SET status = 'fulfilled', fulfilled_document_id = $1, fulfilled_at = now()
          WHERE id = (
            SELECT id FROM document_requests
             WHERE employee_id = $2 AND status = 'open'
               AND (($3::uuid IS NOT NULL AND id = $3::uuid) OR ($3::uuid IS NULL AND $4::uuid IS NOT NULL AND category_id = $4::uuid))
             ORDER BY created_at LIMIT 1)
          RETURNING id, requested_by, title`,
        [documentId, employeeId, meta.requestId ?? null, category?.id ?? null],
      );

      await audit(req, {
        action: 'document.uploaded',
        entityType: 'document',
        entityId: documentId,
        clientId: employee.client_id,
        metadata: { title: meta.title, filename: file.originalName, size: file.size, employeeId, onBehalf: user.role !== 'employee', requestId: fulfilled[0]?.id },
      }, q);

      const reviewers = (await reviewersForClient(employee.client_id, q)).filter((id) => id !== user.id);
      await notify(reviewers, {
        type: 'document_uploaded',
        title: 'New document submitted',
        message: `${employee.first_name} ${employee.last_name} — "${meta.title}" is awaiting review.`,
        link: docLink(documentId),
        entityType: 'document',
        entityId: documentId,
      }, q);
      if (user.role !== 'employee' && employee.user_id !== user.id) {
        await notify([employee.user_id], {
          type: 'document_uploaded',
          title: 'A document was added to your records',
          message: `${fullName(user)} uploaded "${meta.title}" on your behalf.`,
          link: docLink(documentId),
          entityType: 'document',
          entityId: documentId,
        }, q);
      }
      if (fulfilled[0]?.requested_by && fulfilled[0].requested_by !== user.id) {
        await notify([fulfilled[0].requested_by], {
          type: 'document_uploaded',
          title: 'Requested document received',
          message: `"${fulfilled[0].title}" was fulfilled by ${employee.first_name} ${employee.last_name}.`,
          link: docLink(documentId),
          entityType: 'document',
          entityId: documentId,
        }, q);
      }
      return documentId;
    });

    const { rows } = await db().query(`${DOCUMENT_SELECT} WHERE d.id = $1`, [result]);
    res.status(201).json(serializeDocument(rows[0], user));
  } catch (err) {
    await storage().delete(key).catch((e) => logger.error({ e, key }, 'Failed to clean up orphaned upload'));
    throw err;
  }
});

// =====================================================================================
// POST /api/documents/move — bulk move to a folder (drag and drop)
// =====================================================================================
const moveSchema = z.object({ documentIds: z.array(uuid).min(1).max(200), folderId: uuid });

documentsRouter.post('/move', async (req, res) => {
  const user = currentUser(req);
  const b = parse(moveSchema, req.body);
  await db().tx(async (q) => {
    const folder = await loadFolder(user, b.folderId, q);
    for (const id of b.documentIds) {
      const doc = await loadDocument(user, id, q, true);
      assertOnDocument(user, 'move', doc);
      if (folder.client_id !== doc.client_id) throw badRequest('Documents can only be moved within the same client');
      if (folder.employee_id && folder.employee_id !== doc.employee_id) {
        throw badRequest(`"${doc.title}" cannot be filed in another employee's folder`);
      }
      if (doc.folder_id === folder.id) continue;
      await q.query('UPDATE documents SET folder_id = $2 WHERE id = $1', [id, folder.id]);
      await audit(req, { action: 'document.moved', entityType: 'document', entityId: id, clientId: doc.client_id, metadata: { from: doc.folder_id, to: folder.id, folderName: folder.name } }, q);
    }
  });
  res.json({ moved: b.documentIds.length });
});

// =====================================================================================
// GET /api/documents/:id — details (+ versions, approvals, comments, folder path)
// =====================================================================================
documentsRouter.get('/:id', async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  const doc = await loadDocument(user, id);

  const [{ rows: main }, { rows: versions }, { rows: approvals }, { rows: comments }, path] = await Promise.all([
    db().query(`${DOCUMENT_SELECT} WHERE d.id = $1`, [id]),
    db().query<Record<string, any>>(
      `SELECT v.id, v.version_number, v.original_filename, v.file_ext, v.mime_type, v.size_bytes, v.checksum_sha256,
              v.issue_date, v.expiry_date, v.change_note, v.created_at, u.first_name || ' ' || u.last_name AS uploaded_by_name
         FROM document_versions v LEFT JOIN users u ON u.id = v.uploaded_by
        WHERE v.document_id = $1 ORDER BY v.version_number DESC`,
      [id],
    ),
    db().query<Record<string, any>>(
      `SELECT a.id, a.decision, a.comment, a.created_at, a.version_id, v.version_number, u.first_name || ' ' || u.last_name AS reviewer_name
         FROM document_approvals a LEFT JOIN users u ON u.id = a.reviewer_id LEFT JOIN document_versions v ON v.id = a.version_id
        WHERE a.document_id = $1 ORDER BY a.created_at DESC`,
      [id],
    ),
    db().query<Record<string, any>>(
      `SELECT c.id, c.body, c.is_internal, c.created_at, c.author_id, u.first_name || ' ' || u.last_name AS author_name, r.name AS author_role
         FROM document_comments c LEFT JOIN users u ON u.id = c.author_id LEFT JOIN roles r ON r.id = u.role_id
        WHERE c.document_id = $1 ${user.role === 'employee' ? 'AND NOT c.is_internal' : ''}
        ORDER BY c.created_at`,
      [id],
    ),
    doc.folder_id ? folderPath(doc.folder_id) : Promise.resolve([]),
  ]);

  await audit(req, { action: 'document.viewed', entityType: 'document', entityId: id, clientId: doc.client_id });

  res.json({
    ...serializeDocument(main[0], user),
    can: documentCapabilities(user, doc),
    // Employees only see the part of the path inside their own folder.
    folderPath: user.role === 'employee' ? path.filter((p) => p.kind !== 'client_root') : path,
    versions: versions.map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      filename: v.original_filename,
      ext: v.file_ext,
      mimeType: v.mime_type,
      sizeBytes: v.size_bytes,
      checksum: v.checksum_sha256,
      issueDate: v.issue_date,
      expiryDate: v.expiry_date,
      changeNote: v.change_note,
      createdAt: v.created_at,
      uploadedByName: v.uploaded_by_name,
    })),
    approvals: approvals.map((a) => ({
      id: a.id,
      decision: a.decision,
      comment: a.comment,
      createdAt: a.created_at,
      versionId: a.version_id,
      versionNumber: a.version_number,
      reviewerName: a.reviewer_name,
    })),
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      isInternal: c.is_internal,
      createdAt: c.created_at,
      authorId: c.author_id,
      authorName: c.author_name,
      authorRole: c.author_role,
    })),
  });
});

// =====================================================================================
// PATCH /api/documents/:id — rename / metadata / category / folder
// =====================================================================================
const patchSchema = z.object({
  title: nonEmpty(200).optional(),
  description: trimmed(2000).optional().nullable(),
  categoryId: z.union([uuid, z.null()]).optional(),
  issueDate: optDate,
  expiryDate: optDate,
  folderId: uuid.optional(),
});

documentsRouter.patch('/:id', async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  const b = parse(patchSchema, req.body);
  if (!Object.keys(b).length) throw badRequest('Nothing to update');

  await db().tx(async (q) => {
    const doc = await loadDocument(user, id, q, true);
    const touches = (k: keyof typeof b) => b[k] !== undefined;
    if (touches('title') || touches('description') || touches('categoryId')) assertOnDocument(user, 'edit', doc);
    if (touches('issueDate') || touches('expiryDate')) assertOnDocument(user, 'edit_dates', doc);
    if (touches('folderId')) assertOnDocument(user, 'move', doc);

    const issue = b.issueDate !== undefined ? b.issueDate : doc.issue_date;
    const expiry = b.expiryDate !== undefined ? b.expiryDate : doc.expiry_date;
    assertDates(issue, expiry);

    let folderId = doc.folder_id;
    if (b.folderId) folderId = await resolveTargetFolder(user, b.folderId, doc.client_id, doc.employee_id, q);
    let categoryId = doc.category_id;
    if (b.categoryId !== undefined && b.categoryId !== doc.category_id) {
      const cat = await loadCategory(q, b.categoryId ?? undefined);
      categoryId = cat?.id ?? null;
      // Re-file into the matching category folder unless a folder was chosen explicitly.
      if (!b.folderId) folderId = cat ? await ensureCategoryFolder(doc.employee_id, cat.id, q) : await ensureEmployeeRoot(doc.employee_id, q);
    }

    await q.query(
      `UPDATE documents SET title = $2, description = $3, category_id = $4, issue_date = $5, expiry_date = $6, folder_id = $7 WHERE id = $1`,
      [id, b.title ?? doc.title, b.description !== undefined ? b.description || null : doc.description, categoryId, issue, expiry, folderId],
    );
    // Keep the current version's dates in sync with the document's.
    if (touches('issueDate') || touches('expiryDate')) {
      await q.query('UPDATE document_versions SET issue_date = $2, expiry_date = $3 WHERE id = $1', [doc.current_version_id, issue, expiry]);
    }
    const changes: Record<string, unknown> = {};
    for (const k of Object.keys(b) as (keyof typeof b)[]) changes[k] = b[k];
    if (b.title && b.title !== doc.title) changes.previousTitle = doc.title;
    await audit(req, { action: 'document.updated', entityType: 'document', entityId: id, clientId: doc.client_id, metadata: changes }, q);
  });
  const { rows } = await db().query(`${DOCUMENT_SELECT} WHERE d.id = $1`, [id]);
  res.json(serializeDocument(rows[0], user));
});

// =====================================================================================
// POST /api/documents/:id/versions — replace / renew (keeps previous versions)
// =====================================================================================
const versionSchema = z.object({
  issueDate: optDate,
  expiryDate: optDate,
  changeNote: trimmed(1000).optional(),
});

documentsRouter.post('/:id/versions', uploadLimiter, uploadSingle, async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  const meta = parse(versionSchema, req.body);
  const pre = await loadDocument(user, id);
  if (pre.is_archived) throw badRequest('Archived documents cannot be replaced. Unarchive it first.');
  assertOnDocument(user, 'replace', pre);
  const file = validateUpload(req.file);
  const key = storageKey(pre.client_id, id, randomUUID(), file.ext);
  await storage().put(key, file.buffer, file.mime);

  try {
    await db().tx(async (q) => {
      const doc = await loadDocument(user, id, q, true);
      assertOnDocument(user, 'replace', doc); // re-check under lock
      const issue = meta.issueDate !== undefined ? meta.issueDate : doc.issue_date;
      const expiry = meta.expiryDate !== undefined ? meta.expiryDate : doc.expiry_date;
      assertDates(issue, expiry);
      const { rows: next } = await q.query<{ n: number }>('SELECT COALESCE(max(version_number), 0) + 1 AS n FROM document_versions WHERE document_id = $1', [id]);
      const { rows: v } = await q.query<{ id: string }>(
        `INSERT INTO document_versions (document_id, version_number, storage_key, original_filename, file_ext, mime_type, size_bytes, checksum_sha256, issue_date, expiry_date, change_note, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [id, next[0].n, key, file.originalName, file.ext, file.mime, file.size, file.checksum, issue, expiry, meta.changeNote || null, user.id],
      );
      await q.query(
        `UPDATE documents SET current_version_id = $2, status = 'pending_review', issue_date = $3, expiry_date = $4 WHERE id = $1`,
        [id, v[0].id, issue, expiry],
      );
      await audit(req, {
        action: 'document.version_uploaded',
        entityType: 'document',
        entityId: id,
        clientId: doc.client_id,
        metadata: { version: next[0].n, filename: file.originalName, previousStatus: doc.status, note: meta.changeNote },
      }, q);
      const emp = await loadEmployeeInScope(user, doc.employee_id, q);
      const reviewers = (await reviewersForClient(doc.client_id, q)).filter((r) => r !== user.id);
      await notify(reviewers, {
        type: 'document_uploaded',
        title: doc.status === 'expired' || doc.status === 'renewal_required' ? 'Renewed certificate submitted' : 'Updated document submitted',
        message: `${emp.first_name} ${emp.last_name} — "${doc.title}" (version ${next[0].n}) is awaiting review.`,
        link: docLink(id),
        entityType: 'document',
        entityId: id,
      }, q);
      if (user.role !== 'employee' && emp.user_id !== user.id) {
        await notify([emp.user_id], { type: 'document_uploaded', title: 'Your document was updated', message: `${fullName(user)} uploaded a new version of "${doc.title}".`, link: docLink(id), entityType: 'document', entityId: id }, q);
      }
    });
  } catch (err) {
    await storage().delete(key).catch(() => undefined);
    throw err;
  }
  const { rows } = await db().query(`${DOCUMENT_SELECT} WHERE d.id = $1`, [id]);
  res.status(201).json(serializeDocument(rows[0], user));
});

// =====================================================================================
// POST /api/documents/:id/review — approve / reject / require renewal
// =====================================================================================
const reviewSchema = z
  .object({
    decision: z.enum(['approved', 'rejected', 'renewal_required']),
    comment: trimmed(2000).optional(),
  })
  .refine((v) => v.decision === 'approved' || (v.comment && v.comment.length >= 3), {
    path: ['comment'],
    message: 'Please explain the reason so the employee can fix it',
  });

documentsRouter.post('/:id/review', async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  const b = parse(reviewSchema, req.body);

  await db().tx(async (q) => {
    const doc = await loadDocument(user, id, q, true);
    assertOnDocument(user, 'review', doc);
    if (doc.is_archived) throw badRequest('Archived documents cannot be reviewed');
    if (b.decision === 'approved' && doc.expiry_date && doc.expiry_date < todayIso()) {
      throw badRequest('This certificate has already expired. Reject it or require a renewal instead.');
    }
    if (doc.status === b.decision) throw badRequest(`Document is already ${b.decision.replace('_', ' ')}`);

    await q.query(
      `INSERT INTO document_approvals (document_id, version_id, reviewer_id, decision, comment) VALUES ($1, $2, $3, $4, $5)`,
      [id, doc.current_version_id, user.id, b.decision, b.comment || null],
    );
    await q.query('UPDATE documents SET status = $2 WHERE id = $1', [id, b.decision satisfies DocumentStatus]);
    await audit(req, { action: 'document.reviewed', entityType: 'document', entityId: id, clientId: doc.client_id, metadata: { decision: b.decision, previousStatus: doc.status, comment: b.comment } }, q);

    const owner = await userIdForEmployee(doc.employee_id, q);
    const recipients = [owner, doc.uploaded_by].filter((x): x is string => !!x && x !== user.id);
    const copy = {
      approved: { type: 'document_approved' as const, title: 'Document approved', message: `"${doc.title}" was approved by ${fullName(user)}.` },
      rejected: { type: 'document_rejected' as const, title: 'Document rejected', message: `"${doc.title}" was rejected: ${b.comment}` },
      renewal_required: { type: 'renewal_required' as const, title: 'Renewal required', message: `Please upload a renewed version of "${doc.title}": ${b.comment}` },
    }[b.decision];
    await notify(recipients, { ...copy, link: docLink(id), entityType: 'document', entityId: id }, q);
  });
  const { rows } = await db().query(`${DOCUMENT_SELECT} WHERE d.id = $1`, [id]);
  res.json(serializeDocument(rows[0], user));
});

const todayIso = () => new Date().toISOString().slice(0, 10);

// =====================================================================================
// Archive / unarchive / delete
// =====================================================================================
async function setArchived(req: Request, archived: boolean) {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  await db().tx(async (q) => {
    const doc = await loadDocument(user, id, q, true);
    assertOnDocument(user, 'archive', doc);
    if (doc.is_archived === archived) return;
    await q.query(
      `UPDATE documents SET is_archived = $2, archived_at = CASE WHEN $2 THEN now() END, archived_by = CASE WHEN $2 THEN $3::uuid END WHERE id = $1`,
      [id, archived, user.id],
    );
    await audit(req, { action: archived ? 'document.archived' : 'document.unarchived', entityType: 'document', entityId: id, clientId: doc.client_id }, q);
  });
  const { rows } = await db().query(`${DOCUMENT_SELECT} WHERE d.id = $1`, [id]);
  return serializeDocument(rows[0], user);
}

documentsRouter.post('/:id/archive', async (req, res) => {
  res.json(await setArchived(req, true));
});
documentsRouter.post('/:id/unarchive', async (req, res) => {
  res.json(await setArchived(req, false));
});

documentsRouter.delete('/:id', async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  const keys = await db().tx(async (q) => {
    const doc: DocumentRow = await loadDocument(user, id, q, true);
    assertOnDocument(user, 'delete', doc);
    await q.query('UPDATE documents SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [id, user.id]);
    await q.query(`UPDATE document_requests SET status = 'open', fulfilled_document_id = NULL, fulfilled_at = NULL WHERE fulfilled_document_id = $1 AND status = 'fulfilled'`, [id]);
    const { rows } = await q.query<{ storage_key: string }>('SELECT storage_key FROM document_versions WHERE document_id = $1', [id]);
    await audit(req, { action: 'document.deleted', entityType: 'document', entityId: id, clientId: doc.client_id, metadata: { title: doc.title, versions: rows.length } }, q);
    return rows.map((r) => r.storage_key);
  });
  // The record is retained (soft delete) for the audit trail; the files themselves are purged.
  await Promise.all(keys.map((k) => storage().delete(k).catch((err) => logger.error({ err, k }, 'Failed to delete stored file'))));
  res.status(204).end();
});

// =====================================================================================
// GET /api/documents/:id/url — short-lived signed URL for preview or download
// =====================================================================================
const urlSchema = z.object({
  disposition: z.enum(['inline', 'attachment']).default('attachment'),
  versionId: uuid.optional(),
});

documentsRouter.get('/:id/url', async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  const o = parse(urlSchema, req.query);
  const doc = await loadDocument(user, id);
  assertOnDocument(user, 'download', doc);
  const { rows } = await db().query<{ id: string; storage_key: string; original_filename: string; mime_type: string; file_ext: FileExt; version_number: number }>(
    `SELECT id, storage_key, original_filename, mime_type, file_ext, version_number FROM document_versions WHERE document_id = $1 AND id = $2`,
    [id, o.versionId ?? doc.current_version_id],
  );
  const v = rows[0];
  if (!v) throw notFound('Version');
  const previewable = PREVIEWABLE_EXTS.includes(v.file_ext);
  const disposition = o.disposition === 'inline' && previewable ? 'inline' : 'attachment';
  const signed = await storage().signedUrl(v.storage_key, { filename: v.original_filename, contentType: v.mime_type, disposition });
  await audit(req, {
    action: disposition === 'inline' ? 'document.previewed' : 'document.downloaded',
    entityType: 'document',
    entityId: id,
    clientId: doc.client_id,
    metadata: { versionId: v.id, version: v.version_number, filename: v.original_filename },
  });
  res.set('Cache-Control', 'no-store');
  res.json({ url: signed.url, expiresAt: signed.expiresAt, filename: v.original_filename, mimeType: v.mime_type, previewable, disposition });
});

// =====================================================================================
// Comments
// =====================================================================================
const commentSchema = z.object({ body: nonEmpty(5000), isInternal: z.boolean().default(false) });

documentsRouter.post('/:id/comments', async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  const b = parse(commentSchema, req.body);
  const doc = await loadDocument(user, id);
  assertOnDocument(user, b.isInternal ? 'comment_internal' : 'comment', doc);
  const comment = await db().tx(async (q) => {
    const { rows } = await q.query<{ id: string; created_at: Date }>(
      `INSERT INTO document_comments (document_id, author_id, body, is_internal) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [id, user.id, b.body, b.isInternal],
    );
    await audit(req, { action: 'document.commented', entityType: 'document', entityId: id, clientId: doc.client_id, metadata: { internal: b.isInternal } }, q);
    const preview = b.body.length > 120 ? `${b.body.slice(0, 117)}...` : b.body;
    if (user.role === 'employee') {
      await notify((await reviewersForClient(doc.client_id, q)).filter((r) => r !== user.id), {
        type: 'comment_added', title: `New comment on "${doc.title}"`, message: `${fullName(user)}: ${preview}`, link: docLink(id), entityType: 'document', entityId: id,
      }, q);
    } else if (!b.isInternal) {
      const owner = await userIdForEmployee(doc.employee_id, q);
      if (owner && owner !== user.id) {
        await notify([owner], { type: 'comment_added', title: `New comment on "${doc.title}"`, message: `${fullName(user)}: ${preview}`, link: docLink(id), entityType: 'document', entityId: id }, q);
      }
    }
    return rows[0];
  });
  res.status(201).json({
    id: comment.id,
    body: b.body,
    isInternal: b.isInternal,
    createdAt: comment.created_at,
    authorId: user.id,
    authorName: fullName(user),
    authorRole: user.role,
  });
});

// =====================================================================================
// GET /api/documents/:id/history — audit trail for one document (staff/admin)
// =====================================================================================
documentsRouter.get('/:id/history', async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  await loadDocument(user, id);
  if (user.role === 'employee') throw forbidden();
  const { rows } = await db().query<Record<string, any>>(
    `SELECT a.id, a.action, a.metadata, a.created_at, a.ip, COALESCE(u.first_name || ' ' || u.last_name, a.actor_email) AS actor_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.entity_type = 'document' AND a.entity_id = $1
      ORDER BY a.created_at DESC LIMIT 200`,
    [id],
  );
  res.json(rows.map((r) => ({ id: String(r.id), action: r.action, metadata: r.metadata, createdAt: r.created_at, actorName: r.actor_name, ip: r.ip })));
});
