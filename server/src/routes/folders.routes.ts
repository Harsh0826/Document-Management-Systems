import { Router } from 'express';
import { z } from 'zod';
import { db, type Queryable } from '../db/index.js';
import { badRequest, conflict, forbidden } from '../lib/errors.js';
import { Where } from '../lib/http.js';
import { nonEmpty, parse, uuid } from '../lib/validate.js';
import { authenticate, currentUser, requirePermission } from '../middleware/auth.js';
import { applyScope, loadFolder, type FolderRow } from '../services/access.js';
import { audit } from '../services/audit.js';
import { folderPath, isDescendantOrSelf } from '../services/folders.js';

export const foldersRouter = Router();
foldersRouter.use(authenticate);

const serialize = (f: Record<string, any>) => ({
  id: f.id,
  name: f.name,
  parentId: f.parent_id,
  clientId: f.client_id,
  employeeId: f.employee_id,
  categoryId: f.category_id,
  kind: f.kind,
  createdAt: f.created_at,
  updatedAt: f.updated_at,
  documentCount: f.document_count ?? 0,
  childCount: f.child_count ?? 0,
  isSystem: f.kind === 'client_root' || f.kind === 'employee_root',
});

const COUNTS = `
  (SELECT count(*) FROM documents d WHERE d.folder_id = f.id AND d.deleted_at IS NULL AND NOT d.is_archived) AS document_count,
  (SELECT count(*) FROM folders c WHERE c.parent_id = f.id) AS child_count`;

/** GET /api/folders — every folder the user can see (flat; the UI builds the tree). */
foldersRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  if (user.role === 'staff' && !user.permissions.has('documents.view')) throw forbidden();
  const f = parse(z.object({ clientId: uuid.optional() }), req.query);
  const w = new Where();
  applyScope(w, user, 'f');
  if (f.clientId) w.add('f.client_id = ?', f.clientId);
  const { rows } = await db().query(`SELECT f.*, ${COUNTS} FROM folders f ${w.sql} ORDER BY f.kind = 'custom', lower(f.name)`, w.params);
  res.json(rows.map(serialize));
});

/** GET /api/folders/:id — folder, breadcrumb path and direct children. */
foldersRouter.get('/:id', async (req, res) => {
  const user = currentUser(req);
  const folder = await loadFolder(user, parse(uuid, req.params.id));
  const [{ rows: self }, { rows: children }, path] = await Promise.all([
    db().query(`SELECT f.*, ${COUNTS} FROM folders f WHERE f.id = $1`, [folder.id]),
    db().query(`SELECT f.*, ${COUNTS} FROM folders f WHERE f.parent_id = $1 ORDER BY f.kind = 'custom', lower(f.name)`, [folder.id]),
    folderPath(folder.id),
  ]);
  res.json({
    ...serialize(self[0]),
    path: user.role === 'employee' ? path.filter((p) => p.kind !== 'client_root') : path,
    children: children.map(serialize),
  });
});

async function assertUniqueName(q: Queryable, parentId: string, name: string, exceptId?: string) {
  const { rows } = await q.query('SELECT 1 FROM folders WHERE parent_id = $1 AND lower(name) = lower($2) AND id <> COALESCE($3::uuid, gen_random_uuid())', [parentId, name, exceptId ?? null]);
  if (rows.length) throw conflict('A folder with this name already exists here', { fields: { name: 'Name already used in this folder' } });
}

const folderName = nonEmpty(120).refine((s) => !/[\\/]/.test(s), 'Folder names cannot contain slashes');

/** POST /api/folders — create a subfolder. */
foldersRouter.post('/', requirePermission('folders.manage'), async (req, res) => {
  const user = currentUser(req);
  const b = parse(z.object({ name: folderName, parentId: uuid }), req.body);
  const id = await db().tx(async (q) => {
    const parent = await loadFolder(user, b.parentId, q);
    await assertUniqueName(q, parent.id, b.name);
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO folders (name, parent_id, client_id, employee_id, kind, created_by) VALUES ($1, $2, $3, $4, 'custom', $5) RETURNING id`,
      [b.name, parent.id, parent.client_id, parent.employee_id, user.id],
    );
    await audit(req, { action: 'folder.created', entityType: 'folder', entityId: rows[0].id, clientId: parent.client_id, metadata: { name: b.name, parentId: parent.id } }, q);
    return rows[0].id;
  });
  const { rows } = await db().query(`SELECT f.*, ${COUNTS} FROM folders f WHERE f.id = $1`, [id]);
  res.status(201).json(serialize(rows[0]));
});

/** PATCH /api/folders/:id — rename and/or move. */
foldersRouter.patch('/:id', requirePermission('folders.manage'), async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ name: folderName.optional(), parentId: uuid.optional() }), req.body);
  await db().tx(async (q) => {
    const folder = await loadFolder(user, id, q);
    if (folder.kind === 'client_root' || folder.kind === 'employee_root') {
      throw badRequest('Company and employee folders are managed automatically and cannot be renamed or moved');
    }
    let parentId = folder.parent_id!;
    if (b.parentId && b.parentId !== folder.parent_id) {
      if (folder.kind !== 'custom') throw badRequest('Category folders cannot be moved');
      const target = await loadFolder(user, b.parentId, q);
      if (target.client_id !== folder.client_id) throw badRequest('Folders cannot be moved to another client');
      if ((target.employee_id ?? null) !== (folder.employee_id ?? null)) {
        throw badRequest("Folders can only be moved within the same employee's records (or within shared company folders)");
      }
      if (await isDescendantOrSelf(folder.id, target.id, q)) throw badRequest('A folder cannot be moved inside itself');
      parentId = target.id;
    }
    const name = b.name ?? folder.name;
    await assertUniqueName(q, parentId, name, folder.id);
    await q.query('UPDATE folders SET name = $2, parent_id = $3 WHERE id = $1', [id, name, parentId]);
    await audit(req, {
      action: parentId !== folder.parent_id ? 'folder.moved' : 'folder.renamed',
      entityType: 'folder',
      entityId: id,
      clientId: folder.client_id,
      metadata: { from: { name: folder.name, parentId: folder.parent_id }, to: { name, parentId } },
    }, q);
  });
  const { rows } = await db().query(`SELECT f.*, ${COUNTS} FROM folders f WHERE f.id = $1`, [id]);
  res.json(serialize(rows[0]));
});

/**
 * DELETE /api/folders/:id[?moveContentsToParent=true]
 * Safeguards: system folders cannot be deleted; a non-empty folder is only deleted when the caller
 * explicitly asks for its contents (documents and subfolders) to be moved up to the parent.
 */
foldersRouter.delete('/:id', requirePermission('folders.manage'), async (req, res) => {
  const user = currentUser(req);
  const id = parse(uuid, req.params.id);
  const moveUp = req.query.moveContentsToParent === 'true';
  const result = await db().tx(async (q) => {
    const folder: FolderRow = await loadFolder(user, id, q);
    if (folder.kind === 'client_root' || folder.kind === 'employee_root') throw badRequest('Company and employee folders cannot be deleted');
    const { rows: c } = await q.query<{ docs: number; folders: number }>(
      `SELECT (SELECT count(*) FROM documents WHERE folder_id = $1 AND deleted_at IS NULL) AS docs,
              (SELECT count(*) FROM folders WHERE parent_id = $1) AS folders`,
      [id],
    );
    const { docs, folders } = c[0];
    if ((docs > 0 || folders > 0) && !moveUp) {
      throw conflict(`This folder contains ${docs} document(s) and ${folders} subfolder(s).`, { documents: docs, folders, requiresMove: true });
    }
    const parentId = folder.parent_id!;
    await q.query('UPDATE documents SET folder_id = $2 WHERE folder_id = $1', [id, parentId]);
    // Move subfolders up, renaming on conflict.
    const { rows: subs } = await q.query<{ id: string; name: string }>('SELECT id, name FROM folders WHERE parent_id = $1', [id]);
    for (const s of subs) {
      let name = s.name;
      for (let i = 2; ; i++) {
        const clash = await q.query('SELECT 1 FROM folders WHERE parent_id = $1 AND lower(name) = lower($2)', [parentId, name]);
        if (!clash.rows.length) break;
        name = `${s.name} (${i})`;
      }
      await q.query('UPDATE folders SET parent_id = $2, name = $3 WHERE id = $1', [s.id, parentId, name]);
    }
    await q.query('DELETE FROM folders WHERE id = $1', [id]);
    await audit(req, { action: 'folder.deleted', entityType: 'folder', entityId: id, clientId: folder.client_id, metadata: { name: folder.name, movedDocuments: docs, movedFolders: folders, parentId } }, q);
    return { movedDocuments: docs, movedFolders: folders, parentId };
  });
  res.json(result);
});
