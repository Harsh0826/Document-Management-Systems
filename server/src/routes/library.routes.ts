import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type Queryable } from '../db/index.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isoDate, likeEscape, nonEmpty, parse, trimmed, uuid } from '../lib/validate.js';
import { authenticate, currentUser, requireRole } from '../middleware/auth.js';
import { downloadLimiter, uploadLimiter } from '../middleware/security.js';
import { audit } from '../services/audit.js';
import { uploadSingle, validateUpload } from '../services/files.js';
import {
  FILE_SELECT,
  type FileRow,
  FOLDER_SELECT,
  MAX_DEPTH,
  RESTORE_DAYS,
  folderPath,
  folderSearchCondition,
  nameFromFilename,
  searchCondition,
  serializeFile,
  serializeFolder,
} from '../services/library.js';
import { storage } from '../services/storage.js';

/**
 * Company library. Every signed-in person can browse, search, view and download.
 * Only administrators can add, rename, move, replace and delete.
 */
export const libraryRouter = Router();
libraryRouter.use(authenticate);

const isAdmin = (req: Request) => currentUser(req).role === 'admin';
const adminOnly = requireRole('admin');
const optDate = z
  .union([isoDate, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));
const nameField = nonEmpty(200).refine((s) => !/[\\/]/.test(s), 'Names cannot contain / or \\');
const folderName = nonEmpty(120).refine((s) => !/[\\/]/.test(s), 'Folder names cannot contain / or \\');

async function loadFile(id: string, q: Queryable = db(), includeDeleted = false) {
  const { rows } = await q.query<FileRow>(`${FILE_SELECT} WHERE lf.id = $1 ${includeDeleted ? 'AND lf.purged_at IS NULL' : 'AND lf.deleted_at IS NULL'}`, [id]);
  if (!rows[0]) throw notFound('Document');
  return rows[0];
}

async function loadFolder(id: string, q: Queryable = db()) {
  const { rows } = await q.query<{ id: string; name: string; parent_id: string | null; depth: number }>(
    'SELECT id, name, parent_id, depth FROM library_folders WHERE id = $1',
    [id],
  );
  if (!rows[0]) throw notFound('Folder');
  return rows[0];
}

async function assertNameFree(q: Queryable, folderId: string, name: string, exceptId?: string) {
  const { rows } = await q.query(
    'SELECT 1 FROM library_files WHERE folder_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL AND id <> COALESCE($3::uuid, gen_random_uuid())',
    [folderId, name, exceptId ?? null],
  );
  if (rows.length)
    throw new AppError(409, `There's already a file called "${name}" in this folder. Choose another name.`, 'name_taken', {
      fields: { name: 'Name already used in this folder' },
    });
}

async function assertFolderNameFree(q: Queryable, parentId: string | null, name: string, exceptId?: string) {
  const { rows } = await q.query(
    `SELECT 1 FROM library_folders WHERE parent_id IS NOT DISTINCT FROM $1::uuid AND lower(name) = lower($2) AND id <> COALESCE($3::uuid, gen_random_uuid())`,
    [parentId, name, exceptId ?? null],
  );
  if (rows.length) throw conflict(`There's already a folder called "${name}" here.`, { fields: { name: 'Name already used here' } });
}

// =====================================================================================
// Reading (everyone)
// =====================================================================================

const MAX_LIST = 2000; // sub-folders shown in one place
const COUNT_CAP = 10_000; // beyond this, totals are shown as "10,000+"
const PIN_LIMIT = 50;

const flag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

/** Home: top-level folders, the person's pinned folders and recently opened files, and what's new. */
libraryRouter.get('/home', async (req, res) => {
  const me = currentUser(req);
  const admin = isAdmin(req);
  const [{ rows: folders }, { rows: recent }, { rows: opened }, { rows: pinned }, { rows: stats }, attention] = await Promise.all([
    db().query(`${FOLDER_SELECT} WHERE f.parent_id IS NULL ORDER BY lower(f.name) LIMIT ${MAX_LIST}`),
    db().query(`${FILE_SELECT} WHERE lf.deleted_at IS NULL ORDER BY lf.created_at DESC LIMIT 6`),
    db().query(
      `${FILE_SELECT}
         JOIN (SELECT entity_id, max(created_at) AS at FROM audit_logs
                WHERE actor_id = $1 AND entity_type = 'file' AND action IN ('file.viewed', 'file.downloaded') AND created_at > now() - interval '90 days'
                GROUP BY entity_id ORDER BY at DESC LIMIT 20) o ON o.entity_id = lf.id::text
        WHERE lf.deleted_at IS NULL ORDER BY o.at DESC LIMIT 6`,
      [me.id],
    ),
    db().query(`${FOLDER_SELECT} JOIN library_pins pin ON pin.folder_id = f.id AND pin.user_id = $1 ORDER BY lower(f.name)`, [me.id]),
    db().query<{ files: number; folders: number }>(
      `SELECT (SELECT COALESCE(sum(total_files), 0)::int FROM library_folders WHERE parent_id IS NULL) AS files, (SELECT count(*)::int FROM library_folders) AS folders`,
    ),
    admin
      ? db().query<{ expired: number; soon: number }>(
          `SELECT count(*) FILTER (WHERE valid_until < CURRENT_DATE)::int AS expired,
                  count(*) FILTER (WHERE valid_until >= CURRENT_DATE AND valid_until <= CURRENT_DATE + 30)::int AS soon
             FROM library_files WHERE deleted_at IS NULL AND valid_until IS NOT NULL`,
        )
      : null,
  ]);
  res.json({
    folders: folders.map(serializeFolder),
    pinned: pinned.map(serializeFolder),
    recent: recent.map((r) => serializeFile(r, admin)),
    opened: opened.map((r) => serializeFile(r, admin)),
    totals: stats[0],
    ...(attention ? { attention: attention.rows[0] } : {}),
  });
});

/**
 * Folders for pickers and quick navigation: the sub-folders of `parent` (top-level when omitted), or,
 * with `q`, folders anywhere whose name matches (best matches first, with where they live).
 */
libraryRouter.get('/folders', async (req, res) => {
  const f = parse(z.object({ parent: uuid.optional(), q: trimmed(100).optional() }), req.query);
  if (f.q) {
    const fs = folderSearchCondition(f.q, 2);
    const { rows } = await db().query(
      `${FOLDER_SELECT} WHERE ${fs.sql} ORDER BY CASE WHEN lower(f.name) LIKE $1 THEN 0 ELSE 1 END, f.depth, lower(f.name) LIMIT 30`,
      [`${likeEscape(f.q.toLowerCase())}%`, ...fs.params],
    );
    res.json({ folders: rows.map(serializeFolder) });
    return;
  }
  const { rows } = f.parent
    ? await db().query(`${FOLDER_SELECT} WHERE f.parent_id = $1 ORDER BY lower(f.name) LIMIT ${MAX_LIST}`, [f.parent])
    : await db().query(`${FOLDER_SELECT} WHERE f.parent_id IS NULL ORDER BY lower(f.name) LIMIT ${MAX_LIST}`);
  res.json({ folders: rows.map(serializeFolder) });
});

/** One folder: where it is, its sub-folders, and whether the person pinned it. Files come from GET /files. */
libraryRouter.get('/folders/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const [{ rows: self }, { rows: subfolders }, path, { rows: pin }] = await Promise.all([
    db().query(`${FOLDER_SELECT} WHERE f.id = $1`, [id]),
    db().query(`${FOLDER_SELECT} WHERE f.parent_id = $1 ORDER BY lower(f.name) LIMIT ${MAX_LIST}`, [id]),
    folderPath(id),
    db().query('SELECT 1 FROM library_pins WHERE user_id = $1 AND folder_id = $2', [currentUser(req).id, id]),
  ]);
  if (!self[0]) throw notFound('Folder');
  res.json({ ...serializeFolder(self[0]), ownFileCount: self[0].own_files, path, subfolders: subfolders.map(serializeFolder), pinned: pin.length > 0 });
});

const TYPE_EXTS = { pdf: "'pdf'", word: "'doc', 'docx'", excel: "'xls', 'xlsx'", picture: "'jpg', 'jpeg', 'png'" } as const;
const SORTS = {
  newest: 'lf.created_at DESC, lf.id',
  oldest: 'lf.created_at, lf.id',
  name: 'lower(lf.name), lf.id',
  name_desc: 'lower(lf.name) DESC, lf.id',
  expiry: 'lf.valid_until NULLS LAST, lower(lf.name), lf.id',
  largest: 'v.size_bytes DESC NULLS LAST, lf.id',
} as const;

const filesQuery = z.object({
  q: trimmed(100).optional(),
  folder: uuid.optional(),
  /** Include files in sub-folders of `folder`. */
  deep: flag,
  type: z.enum(['pdf', 'word', 'excel', 'picture']).optional(),
  validity: z.enum(['expired', 'soon', 'valid', 'none']).optional(),
  added: z.enum(['7', '30', '365']).optional(),
  sort: z.enum(['relevance', 'newest', 'oldest', 'name', 'name_desc', 'expiry', 'largest']).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Documents, a page at a time: in a folder (optionally with its sub-folders) or across the library,
 * matching words, type, validity and date added, in the chosen order. The first page also says how many
 * there are in total.
 */
libraryRouter.get('/files', async (req, res) => {
  const f = parse(filesQuery, req.query);
  const params: unknown[] = [];
  const p = (v: unknown) => (params.push(v), `$${params.length}`);
  const where = ['lf.deleted_at IS NULL'];
  if (f.folder) where.push(f.deep ? `lf.folder_id IN (SELECT library_folder_subtree(${p(f.folder)}::uuid))` : `lf.folder_id = ${p(f.folder)}`);
  if (f.q) {
    const s = searchCondition(f.q, params.length + 1);
    params.push(...s.params);
    where.push(`(${s.sql})`);
  }
  if (f.type) where.push(`v.file_ext IN (${TYPE_EXTS[f.type]})`);
  if (f.validity === 'expired') where.push('lf.valid_until < CURRENT_DATE');
  if (f.validity === 'soon') where.push('lf.valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 30');
  if (f.validity === 'valid') where.push('lf.valid_until > CURRENT_DATE + 30');
  if (f.validity === 'none') where.push('lf.valid_until IS NULL');
  if (f.added) where.push(`lf.created_at > now() - make_interval(days => ${p(Number(f.added))})`);
  const cond = where.join(' AND ');
  const filterParams = [...params];

  const sort = f.sort ?? (f.q ? 'relevance' : 'newest');
  const order =
    sort === 'relevance' && f.q
      ? `CASE WHEN lower(lf.name) LIKE ${p(`${likeEscape(f.q.toLowerCase())}%`)} THEN 0 WHEN lower(lf.name) LIKE ${p(`%${likeEscape(f.q.toLowerCase())}%`)} THEN 1 ELSE 2 END, lf.created_at DESC, lf.id`
      : SORTS[sort === 'relevance' ? 'newest' : sort];

  const plainFolder = f.folder && !f.q && !f.type && !f.validity && !f.added;
  const [{ rows }, total] = await Promise.all([
    db().query<FileRow>(`${FILE_SELECT} WHERE ${cond} ORDER BY ${order} LIMIT ${f.limit + 1} OFFSET ${f.offset}`, params),
    // The total is only worked out for the first page; stored counts answer the common case instantly.
    f.offset > 0
      ? null
      : plainFolder
        ? db()
            .query<{ n: number }>(`SELECT ${f.deep ? 'total_files' : 'own_files'} AS n FROM library_folders WHERE id = $1`, [f.folder])
            .then((r) => r.rows[0]?.n ?? 0)
        : db()
            .query<{ n: number }>(
              `SELECT count(*)::int AS n FROM (SELECT 1 FROM library_files lf LEFT JOIN library_file_versions v ON v.id = lf.current_version_id
                 WHERE ${cond} LIMIT ${COUNT_CAP + 1}) x`,
              filterParams,
            )
            .then((r) => r.rows[0].n),
  ]);
  res.json({
    files: rows.slice(0, f.limit).map((r) => serializeFile(r, isAdmin(req))),
    nextOffset: rows.length > f.limit ? f.offset + f.limit : null,
    ...(total === null ? {} : { total: Math.min(total, COUNT_CAP), totalIsCapped: total > COUNT_CAP }),
  });
});

/** Quick search while typing: the best few folders and documents. */
libraryRouter.get('/search', async (req, res) => {
  const { q, limit } = parse(z.object({ q: trimmed(100).default(''), limit: z.coerce.number().int().min(1).max(50).default(8) }), req.query);
  if (!q) {
    res.json({ q, folders: [], files: [], moreFiles: false });
    return;
  }
  const s = searchCondition(q, 3);
  const prefix = `${likeEscape(q.toLowerCase())}%`;
  const fs = folderSearchCondition(q, 2);
  const [{ rows: files }, { rows: folders }] = await Promise.all([
    db().query(
      `${FILE_SELECT} WHERE lf.deleted_at IS NULL AND (${s.sql})
        ORDER BY CASE WHEN lower(lf.name) LIKE $1 THEN 0 WHEN lower(lf.name) LIKE $2 THEN 1 ELSE 2 END, lf.created_at DESC LIMIT ${limit + 1}`,
      [prefix, `%${likeEscape(q.toLowerCase())}%`, ...s.params],
    ),
    db().query(`${FOLDER_SELECT} WHERE ${fs.sql} ORDER BY CASE WHEN lower(f.name) LIKE $1 THEN 0 ELSE 1 END, f.depth, lower(f.name) LIMIT 8`, [
      prefix,
      ...fs.params,
    ]),
  ]);
  // One extra row tells us there are more matches than we show.
  res.json({
    q,
    folders: folders.map(serializeFolder),
    files: files.slice(0, limit).map((r) => serializeFile(r, isAdmin(req))),
    moreFiles: files.length > limit,
  });
});

/** How many documents have expired and how many expire in the next 30 days (for the navigation bar). */
libraryRouter.get('/expiry', async (_req, res) => {
  const { rows } = await db().query<{ expired: number; soon: number }>(
    `SELECT count(*) FILTER (WHERE valid_until < CURRENT_DATE)::int AS expired,
            count(*) FILTER (WHERE valid_until >= CURRENT_DATE AND valid_until <= CURRENT_DATE + 30)::int AS soon
       FROM library_files WHERE deleted_at IS NULL AND valid_until IS NOT NULL`,
  );
  res.json(rows[0]);
});

/** Your pinned folders (for the sidebar). */
libraryRouter.get('/pins', async (req, res) => {
  const { rows } = await db().query(`${FOLDER_SELECT} JOIN library_pins pin ON pin.folder_id = f.id AND pin.user_id = $1 ORDER BY lower(f.name)`, [
    currentUser(req).id,
  ]);
  res.json({ folders: rows.map(serializeFolder) });
});

/** Pin a folder to your Home page (your own shortcuts; nobody else sees them). */
libraryRouter.put('/folders/:id/pin', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const me = currentUser(req).id;
  await loadFolder(id);
  const { rows } = await db().query<{ n: number }>('SELECT count(*)::int AS n FROM library_pins WHERE user_id = $1', [me]);
  if (rows[0].n >= PIN_LIMIT) throw badRequest(`You can pin up to ${PIN_LIMIT} folders. Unpin one first.`);
  await db().query('INSERT INTO library_pins (user_id, folder_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, id]);
  res.status(204).end();
});

libraryRouter.delete('/folders/:id/pin', async (req, res) => {
  const id = parse(uuid, req.params.id);
  await db().query('DELETE FROM library_pins WHERE user_id = $1 AND folder_id = $2', [currentUser(req).id, id]);
  res.status(204).end();
});

libraryRouter.get('/files/:id', async (req, res) => {
  const r = await loadFile(parse(uuid, req.params.id));
  res.json(serializeFile(r, isAdmin(req)));
});

/** Short-lived signed link for viewing in the app or downloading. Recorded in the activity log. */
libraryRouter.get('/files/:id/url', downloadLimiter, async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { disposition } = parse(z.object({ disposition: z.enum(['inline', 'attachment']).default('attachment') }), req.query);
  const r = await loadFile(id);
  if (!r.storage_key) throw notFound('File');
  const inline = disposition === 'inline' && ['pdf', 'jpg', 'jpeg', 'png'].includes(r.file_ext);
  // Downloads are named after the document ("Fire Safety Licence 2025.pdf"), not the uploaded file name.
  const filename = `${r.name}.${r.file_ext}`;
  const signed = await storage().signedUrl(r.storage_key, { filename, contentType: r.mime_type, disposition: inline ? 'inline' : 'attachment' });
  await audit(req, { action: inline ? 'file.viewed' : 'file.downloaded', entityType: 'file', entityId: id, metadata: { name: r.name } });
  res.set('Cache-Control', 'no-store');
  res.json({ url: signed.url, expiresAt: signed.expiresAt, filename, inline });
});

// =====================================================================================
// Managing (administrators)
// =====================================================================================

libraryRouter.post('/folders', adminOnly, async (req, res) => {
  const b = parse(z.object({ name: folderName, parentId: uuid.optional().nullable() }), req.body);
  const id = await db().tx(async (q) => {
    let depth = 1;
    if (b.parentId) {
      const parent = await loadFolder(b.parentId, q);
      depth = parent.depth + 1;
      if (depth > MAX_DEPTH) throw badRequest(`Folders can only go ${MAX_DEPTH} levels deep. Add the files to "${parent.name}" instead.`);
    }
    await assertFolderNameFree(q, b.parentId ?? null, b.name);
    const { rows } = await q.query<{ id: string }>('INSERT INTO library_folders (name, parent_id, depth, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [
      b.name,
      b.parentId ?? null,
      depth,
      currentUser(req).id,
    ]);
    await audit(req, { action: 'folder.created', entityType: 'folder', entityId: rows[0].id, metadata: { name: b.name } }, q);
    return rows[0].id;
  });
  const { rows } = await db().query(`${FOLDER_SELECT} WHERE f.id = $1`, [id]);
  res.status(201).json(serializeFolder(rows[0]));
});

/** Rename and/or move a folder (with everything in it). `parentId: null` moves it to the top level. */
libraryRouter.patch('/folders/:id', adminOnly, async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ name: folderName.optional(), parentId: uuid.nullable().optional() }), req.body);
  await db().tx(async (q) => {
    const f = await loadFolder(id, q);
    const name = b.name ?? f.name;
    const parentId = b.parentId !== undefined ? b.parentId : f.parent_id;
    const moving = parentId !== f.parent_id;
    if (moving) {
      let depth = 1;
      if (parentId) {
        const { rows: inside } = await q.query('SELECT 1 FROM library_folder_subtree($1) s WHERE s = $2', [id, parentId]);
        if (inside.length) throw badRequest("A folder can't be moved into itself or one of its own folders.");
        const parent = await loadFolder(parentId, q);
        depth = parent.depth + 1;
      }
      const { rows: h } = await q.query<{ deepest: number }>(
        'SELECT max(depth)::int AS deepest FROM library_folders WHERE id IN (SELECT library_folder_subtree($1))',
        [id],
      );
      const levels = h[0].deepest - f.depth + 1;
      if (depth + levels - 1 > MAX_DEPTH)
        throw badRequest(`"${f.name}" has ${levels} levels of folders, and folders can only go ${MAX_DEPTH} levels deep. Choose a place higher up.`);
      await assertFolderNameFree(q, parentId, name, id);
      const shift = depth - f.depth;
      await q.query('UPDATE library_folders SET parent_id = $2, depth = $3, name = $4 WHERE id = $1', [id, parentId, depth, name]);
      if (shift)
        await q.query(
          'UPDATE library_folders SET depth = depth + $2 WHERE parent_id = $1 OR parent_id IN (SELECT id FROM library_folders WHERE parent_id = $1)',
          [id, shift],
        );
      await audit(req, { action: 'folder.moved', entityType: 'folder', entityId: id, metadata: { name, from: f.parent_id, to: parentId } }, q);
    } else if (name !== f.name) {
      await assertFolderNameFree(q, f.parent_id, name, id);
      await q.query('UPDATE library_folders SET name = $2 WHERE id = $1', [id, name]);
    }
    if (name !== f.name) await audit(req, { action: 'folder.renamed', entityType: 'folder', entityId: id, metadata: { from: f.name, to: name } }, q);
  });
  const { rows } = await db().query(`${FOLDER_SELECT} WHERE f.id = $1`, [id]);
  res.json(serializeFolder(rows[0]));
});

/** Only empty folders can be deleted (anything in "Recently deleted" inside it is removed for good). */
libraryRouter.delete('/folders/:id', adminOnly, async (req, res) => {
  const id = parse(uuid, req.params.id);
  const keys = await db().tx(async (q) => {
    const f = await loadFolder(id, q);
    const { rows: c } = await q.query<{ files: number; folders: number }>(
      `SELECT (SELECT count(*) FROM library_files WHERE folder_id = $1 AND deleted_at IS NULL) AS files,
              (SELECT count(*) FROM library_folders WHERE parent_id = $1) AS folders`,
      [id],
    );
    if (c[0].files || c[0].folders) {
      const what = [c[0].files && `${c[0].files} file${c[0].files === 1 ? '' : 's'}`, c[0].folders && `${c[0].folders} folder${c[0].folders === 1 ? '' : 's'}`]
        .filter(Boolean)
        .join(' and ');
      throw conflict(`This folder still has ${what}. Move or delete them first.`, { files: c[0].files, folders: c[0].folders });
    }
    const { rows: gone } = await q.query<{ storage_key: string }>(
      `SELECT v.storage_key FROM library_file_versions v JOIN library_files lf ON lf.id = v.file_id WHERE lf.folder_id = $1 AND lf.purged_at IS NULL`,
      [id],
    );
    await q.query('DELETE FROM library_files WHERE folder_id = $1', [id]);
    await q.query('DELETE FROM library_folders WHERE id = $1', [id]);
    await audit(req, { action: 'folder.deleted', entityType: 'folder', entityId: id, metadata: { name: f.name } }, q);
    return gone.map((g) => g.storage_key);
  });
  await Promise.all(
    keys.map((k) =>
      storage()
        .delete(k)
        .catch((err) => logger.error({ err, k }, 'Failed to delete stored file')),
    ),
  );
  res.status(204).end();
});

const uploadSchema = z.object({ folderId: uuid, name: trimmed(200).optional(), validUntil: optDate });

/** Rejects non-admins before multer reads (and buffers) the upload. */
function adminBeforeUpload(req: Request, _res: unknown, next: () => void) {
  if (currentUser(req).role !== 'admin') throw forbidden();
  next();
}

libraryRouter.post('/files', uploadLimiter, adminBeforeUpload, uploadSingle, async (req, res) => {
  const user = currentUser(req);
  const b = parse(uploadSchema, req.body);
  const file = validateUpload(req.file);
  const name = parse(nameField, b.name || nameFromFilename(file.originalName));
  await loadFolder(b.folderId);
  const fileId = randomUUID();
  const key = `library/${fileId}/${randomUUID()}.${file.ext}`;
  await storage().put(key, file.buffer, file.mime);
  try {
    await db().tx(async (q) => {
      await assertNameFree(q, b.folderId, name);
      await q.query('INSERT INTO library_files (id, folder_id, name, valid_until, uploaded_by) VALUES ($1, $2, $3, $4, $5)', [
        fileId,
        b.folderId,
        name,
        b.validUntil ?? null,
        user.id,
      ]);
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO library_file_versions (file_id, version_number, storage_key, original_filename, file_ext, mime_type, size_bytes, checksum_sha256, uploaded_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [fileId, key, file.originalName, file.ext, file.mime, file.size, file.checksum, user.id],
      );
      await q.query('UPDATE library_files SET current_version_id = $2 WHERE id = $1', [fileId, rows[0].id]);
      await audit(req, { action: 'file.added', entityType: 'file', entityId: fileId, metadata: { name, folderId: b.folderId, size: file.size } }, q);
    });
  } catch (err) {
    await storage()
      .delete(key)
      .catch(() => undefined);
    throw err;
  }
  res.status(201).json(serializeFile(await loadFile(fileId), true));
});

const patchSchema = z.object({ name: nameField.optional(), folderId: uuid.optional(), validUntil: optDate });

/** Rename, move, or change "Valid until". */
libraryRouter.patch('/files/:id', adminOnly, async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(patchSchema, req.body);
  await db().tx(async (q) => {
    const r = await loadFile(id, q);
    const name = b.name ?? r.name;
    const folderId = b.folderId ?? r.folder_id;
    if (b.folderId) await loadFolder(b.folderId, q);
    if (name !== r.name || folderId !== r.folder_id) await assertNameFree(q, folderId, name, id);
    await q.query('UPDATE library_files SET name = $2, folder_id = $3, valid_until = $4 WHERE id = $1', [
      id,
      name,
      folderId,
      b.validUntil !== undefined ? b.validUntil : r.valid_until,
    ]);
    const action = folderId !== r.folder_id ? 'file.moved' : name !== r.name ? 'file.renamed' : 'file.updated';
    await audit(req, { action, entityType: 'file', entityId: id, metadata: { from: { name: r.name, folderId: r.folder_id }, to: { name, folderId } } }, q);
  });
  res.json(serializeFile(await loadFile(id), true));
});

/** Replace with a newer copy; the previous copy is kept for recovery. */
libraryRouter.post('/files/:id/replace', uploadLimiter, adminBeforeUpload, uploadSingle, async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ validUntil: optDate }), req.body);
  await loadFile(id);
  const file = validateUpload(req.file);
  const key = `library/${id}/${randomUUID()}.${file.ext}`;
  await storage().put(key, file.buffer, file.mime);
  try {
    await db().tx(async (q) => {
      const r = await loadFile(id, q);
      const { rows: n } = await q.query<{ n: number }>('SELECT COALESCE(max(version_number), 0) + 1 AS n FROM library_file_versions WHERE file_id = $1', [id]);
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO library_file_versions (file_id, version_number, storage_key, original_filename, file_ext, mime_type, size_bytes, checksum_sha256, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [id, n[0].n, key, file.originalName, file.ext, file.mime, file.size, file.checksum, user.id],
      );
      await q.query('UPDATE library_files SET current_version_id = $2, valid_until = $3 WHERE id = $1', [
        id,
        rows[0].id,
        b.validUntil !== undefined ? b.validUntil : r.valid_until,
      ]);
      await audit(req, { action: 'file.replaced', entityType: 'file', entityId: id, metadata: { name: r.name, version: n[0].n } }, q);
    });
  } catch (err) {
    await storage()
      .delete(key)
      .catch(() => undefined);
    throw err;
  }
  res.json(serializeFile(await loadFile(id), true));
});

const bulkSchema = z.object({ action: z.enum(['move', 'delete']), ids: z.array(uuid).min(1).max(500), folderId: uuid.optional() });

/**
 * Move or delete many files at once. Files whose name is already used in the destination are skipped
 * (and listed), so one clash never blocks the rest.
 */
libraryRouter.post('/files/bulk', adminOnly, async (req, res) => {
  const b = parse(bulkSchema, req.body);
  if (b.action === 'move' && !b.folderId) throw badRequest('Choose where to move the files.');
  const ids = [...new Set(b.ids)];
  const result = await db().tx(async (q) => {
    const target = b.folderId && b.action === 'move' ? await loadFolder(b.folderId, q) : null;
    const { rows } = await q.query<{ id: string; name: string; folder_id: string }>(
      `SELECT id, name, folder_id FROM library_files WHERE id::text = ANY(string_to_array($1, ',')) AND deleted_at IS NULL ORDER BY lower(name) FOR UPDATE`,
      [ids.join(',')],
    );
    const skipped: { id: string; name: string; reason: string }[] = [];
    let done = 0;
    if (target) {
      const { rows: taken } = await q.query<{ n: string }>('SELECT lower(name) AS n FROM library_files WHERE folder_id = $1 AND deleted_at IS NULL', [
        target.id,
      ]);
      const used = new Set(taken.map((t) => t.n));
      for (const r of rows) {
        if (r.folder_id === target.id) continue;
        if (used.has(r.name.toLowerCase())) {
          skipped.push({ id: r.id, name: r.name, reason: `There's already a file with this name in "${target.name}".` });
          continue;
        }
        used.add(r.name.toLowerCase());
        await q.query('UPDATE library_files SET folder_id = $2 WHERE id = $1', [r.id, target.id]);
        await audit(
          req,
          {
            action: 'file.moved',
            entityType: 'file',
            entityId: r.id,
            metadata: { from: { name: r.name, folderId: r.folder_id }, to: { name: r.name, folderId: target.id } },
          },
          q,
        );
        done++;
      }
    } else {
      for (const r of rows) {
        await q.query('UPDATE library_files SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [r.id, currentUser(req).id]);
        await audit(req, { action: 'file.deleted', entityType: 'file', entityId: r.id, metadata: { name: r.name } }, q);
        done++;
      }
    }
    return { done, skipped, notFound: ids.length - rows.length };
  });
  res.json(result);
});

/** Moves to "Recently deleted" (restorable for 30 days, then removed for good). */
libraryRouter.delete('/files/:id', adminOnly, async (req, res) => {
  const id = parse(uuid, req.params.id);
  await db().tx(async (q) => {
    const r = await loadFile(id, q);
    await q.query('UPDATE library_files SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [id, currentUser(req).id]);
    await audit(req, { action: 'file.deleted', entityType: 'file', entityId: id, metadata: { name: r.name } }, q);
  });
  res.status(204).end();
});

libraryRouter.get('/deleted', adminOnly, async (_req, res) => {
  const { rows } = await db().query<FileRow>(
    `${FILE_SELECT} WHERE lf.deleted_at IS NOT NULL AND lf.purged_at IS NULL AND lf.deleted_at > now() - make_interval(days => $1::int) ORDER BY lf.deleted_at DESC LIMIT 1000`,
    [RESTORE_DAYS],
  );
  res.json(rows.map((r) => ({ ...serializeFile(r, true), removedForGoodAt: new Date(new Date(r.deleted_at).getTime() + RESTORE_DAYS * 86_400_000) })));
});

libraryRouter.post('/files/:id/restore', adminOnly, async (req, res) => {
  const id = parse(uuid, req.params.id);
  await db().tx(async (q) => {
    const r = await loadFile(id, q, true);
    if (!r.deleted_at) throw badRequest('This file is not deleted.');
    await assertNameFree(q, r.folder_id, r.name, id);
    await q.query('UPDATE library_files SET deleted_at = NULL, deleted_by = NULL WHERE id = $1', [id]);
    await audit(req, { action: 'file.restored', entityType: 'file', entityId: id, metadata: { name: r.name } }, q);
  });
  res.json(serializeFile(await loadFile(id), true));
});
