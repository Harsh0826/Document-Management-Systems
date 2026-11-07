import { db, type Queryable } from '../db/index.js';

/** Returns the client's root folder, creating it if needed. */
export async function ensureClientRoot(clientId: string, q: Queryable = db()): Promise<string> {
  const existing = await q.query<{ id: string }>(`SELECT id FROM folders WHERE client_id = $1 AND kind = 'client_root'`, [clientId]);
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO folders (name, client_id, kind) SELECT name, id, 'client_root' FROM clients WHERE id = $1 RETURNING id`,
    [clientId],
  );
  return rows[0].id;
}

/** Picks a sibling-unique name by appending " (2)", " (3)"... */
async function uniqueChildName(parentId: string, base: string, q: Queryable): Promise<string> {
  const { rows } = await q.query<{ name: string }>(
    `SELECT lower(name) AS name FROM folders WHERE parent_id = $1 AND lower(name) LIKE lower($2) || '%'`,
    [parentId, base.replace(/[\\%_]/g, (c) => `\\${c}`)],
  );
  const taken = new Set(rows.map((r) => r.name));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Returns the employee's personal folder (under the client root), creating it if needed. */
export async function ensureEmployeeRoot(employeeId: string, q: Queryable = db()): Promise<string> {
  const existing = await q.query<{ id: string }>(`SELECT id FROM folders WHERE employee_id = $1 AND kind = 'employee_root'`, [employeeId]);
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows: emp } = await q.query<{ client_id: string; name: string }>(
    `SELECT e.client_id, u.first_name || ' ' || u.last_name AS name FROM employees e JOIN users u ON u.id = e.user_id WHERE e.id = $1`,
    [employeeId],
  );
  const rootId = await ensureClientRoot(emp[0].client_id, q);
  const name = await uniqueChildName(rootId, emp[0].name.slice(0, 120), q);
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO folders (name, parent_id, client_id, employee_id, kind) VALUES ($1, $2, $3, $4, 'employee_root') RETURNING id`,
    [name, rootId, emp[0].client_id, employeeId],
  );
  return rows[0].id;
}

/** Returns the employee's folder for a category (e.g. "Training Certificates"), creating it if needed. */
export async function ensureCategoryFolder(employeeId: string, categoryId: string, q: Queryable = db()): Promise<string> {
  const rootId = await ensureEmployeeRoot(employeeId, q);
  const existing = await q.query<{ id: string }>(
    `SELECT id FROM folders WHERE parent_id = $1 AND category_id = $2 AND kind = 'category'`,
    [rootId, categoryId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows: cat } = await q.query<{ name: string }>('SELECT name FROM document_categories WHERE id = $1', [categoryId]);
  const name = await uniqueChildName(rootId, cat[0].name, q);
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO folders (name, parent_id, client_id, employee_id, category_id, kind)
     SELECT $1, $2, e.client_id, e.id, $3, 'category' FROM employees e WHERE e.id = $4 RETURNING id`,
    [name, rootId, categoryId, employeeId],
  );
  return rows[0].id;
}

/** Folder ancestry from root to the folder itself (for breadcrumbs). */
export async function folderPath(folderId: string, q: Queryable = db()) {
  const { rows } = await q.query<{ id: string; name: string; kind: string; depth: number }>(
    `WITH RECURSIVE chain AS (
       SELECT id, name, kind, parent_id, 0 AS depth FROM folders WHERE id = $1
       UNION ALL
       SELECT f.id, f.name, f.kind, f.parent_id, c.depth + 1 FROM folders f JOIN chain c ON f.id = c.parent_id
     )
     SELECT id, name, kind, depth FROM chain ORDER BY depth DESC`,
    [folderId],
  );
  return rows.map(({ id, name, kind }) => ({ id, name, kind }));
}

/** True when `candidateId` is `folderId` or one of its descendants (used to stop cyclic moves). */
export async function isDescendantOrSelf(folderId: string, candidateId: string, q: Queryable = db()) {
  const { rows } = await q.query<{ found: boolean }>(
    `WITH RECURSIVE sub AS (
       SELECT id FROM folders WHERE id = $1
       UNION ALL
       SELECT f.id FROM folders f JOIN sub s ON f.parent_id = s.id
     )
     SELECT EXISTS (SELECT 1 FROM sub WHERE id = $2) AS found`,
    [folderId, candidateId],
  );
  return rows[0].found;
}
