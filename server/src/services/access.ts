/**
 * Central authorization rules. Every route that touches clients, employees, folders or documents uses
 * these helpers so scope rules live in exactly one place.
 */
import { db, type Queryable } from '../db/index.js';
import { forbidden, notFound } from '../lib/errors.js';
import type { Where } from '../lib/http.js';
import type { AuthUser, DocumentStatus, PermissionKey } from '../types.js';

const NO_MATCH = '00000000-0000-0000-0000-000000000000';

/**
 * Restricts rows to the caller's data scope. The aliased table must expose `client_id` and an
 * employee column (`employeeCol`, default `employee_id`).
 *   admin    → everything
 *   staff    → rows of assigned clients
 *   employee → rows that belong to their own employee record
 */
export function applyScope(w: Where, user: AuthUser, alias: string, employeeCol = 'employee_id') {
  if (user.role === 'admin') return;
  if (user.role === 'staff') {
    w.add(`${alias}.client_id = ANY(?::uuid[])`, user.clientIds);
    return;
  }
  w.add(`${alias}.${employeeCol} = ?`, user.employeeId ?? NO_MATCH);
}

export function canAccessClient(user: AuthUser, clientId: string): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'staff') return user.clientIds.includes(clientId);
  return user.clientId === clientId;
}

export function assertClientAccess(user: AuthUser, clientId: string) {
  if (!canAccessClient(user, clientId)) throw notFound('Client');
}

export interface DocumentRow {
  id: string;
  client_id: string;
  employee_id: string;
  folder_id: string | null;
  category_id: string | null;
  title: string;
  description: string | null;
  status: DocumentStatus;
  issue_date: string | null;
  expiry_date: string | null;
  current_version_id: string | null;
  uploaded_by: string | null;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Loads a document *through* the caller's scope. Out-of-scope documents are reported as 404 so that
 * document ids cannot be probed. Use `forUpdate` inside transactions that modify the row.
 */
export async function loadDocument(user: AuthUser, id: string, q: Queryable = db(), forUpdate = false): Promise<DocumentRow> {
  const params: unknown[] = [id];
  let scope = '';
  if (user.role === 'staff') {
    params.push(user.clientIds);
    scope = `AND d.client_id = ANY($2::uuid[])`;
  } else if (user.role === 'employee') {
    params.push(user.employeeId ?? NO_MATCH);
    scope = `AND d.employee_id = $2`;
  }
  const { rows } = await q.query<DocumentRow>(
    `SELECT d.* FROM documents d WHERE d.id = $1 AND d.deleted_at IS NULL ${scope} ${forUpdate ? 'FOR UPDATE' : ''}`,
    params,
  );
  if (!rows[0]) throw notFound('Document');
  if (user.role !== 'employee' && !user.permissions.has('documents.view')) throw notFound('Document');
  return rows[0];
}

export type DocumentAction =
  | 'view'
  | 'download'
  | 'replace'
  | 'edit'
  | 'edit_dates'
  | 'move'
  | 'review'
  | 'archive'
  | 'delete'
  | 'comment'
  | 'comment_internal';

const STAFF_ACTION_PERMISSION: Record<DocumentAction, PermissionKey> = {
  view: 'documents.view',
  download: 'documents.download',
  replace: 'documents.upload',
  edit: 'documents.edit',
  edit_dates: 'documents.edit',
  move: 'documents.edit',
  review: 'documents.review',
  archive: 'documents.archive',
  delete: 'documents.delete',
  comment: 'documents.comment',
  comment_internal: 'documents.comment',
};

/** Statuses in which an employee may upload a replacement / renewal. */
export const EMPLOYEE_REPLACEABLE: DocumentStatus[] = ['pending_review', 'rejected', 'expired', 'renewal_required'];

/** Decides whether `user` may perform `action` on an (already scope-checked) document. */
export function canOnDocument(user: AuthUser, action: DocumentAction, doc: Pick<DocumentRow, 'status' | 'is_archived'>): boolean {
  if (user.role !== 'employee') return user.permissions.has(STAFF_ACTION_PERMISSION[action]);
  switch (action) {
    case 'view':
    case 'download':
    case 'comment':
      return true;
    case 'replace':
      return !doc.is_archived && EMPLOYEE_REPLACEABLE.includes(doc.status);
    case 'edit':
      return !doc.is_archived;
    case 'edit_dates':
      return !doc.is_archived && (doc.status === 'pending_review' || doc.status === 'rejected');
    default:
      return false;
  }
}

export function assertOnDocument(user: AuthUser, action: DocumentAction, doc: Pick<DocumentRow, 'status' | 'is_archived'>) {
  if (!canOnDocument(user, action, doc)) throw forbidden();
}

/** Capability map sent to the UI so it can show/hide actions (the server still enforces every one). */
export function documentCapabilities(user: AuthUser, doc: Pick<DocumentRow, 'status' | 'is_archived'>) {
  const actions: DocumentAction[] = ['download', 'replace', 'edit', 'edit_dates', 'move', 'review', 'archive', 'delete', 'comment', 'comment_internal'];
  return Object.fromEntries(actions.map((a) => [a, canOnDocument(user, a, doc)])) as Record<DocumentAction, boolean>;
}

// ---- Folders --------------------------------------------------------------------------
export interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  client_id: string;
  employee_id: string | null;
  category_id: string | null;
  kind: 'client_root' | 'employee_root' | 'category' | 'custom';
  created_at: Date;
  updated_at: Date;
}

export async function loadFolder(user: AuthUser, id: string, q: Queryable = db()): Promise<FolderRow> {
  const { rows } = await q.query<FolderRow>('SELECT * FROM folders WHERE id = $1', [id]);
  const f = rows[0];
  if (!f || !canSeeFolder(user, f)) throw notFound('Folder');
  return f;
}

export function canSeeFolder(user: AuthUser, f: Pick<FolderRow, 'client_id' | 'employee_id'>): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'staff') return user.permissions.has('documents.view') && user.clientIds.includes(f.client_id);
  return !!user.employeeId && f.employee_id === user.employeeId;
}

// ---- Employees ------------------------------------------------------------------------
export async function loadEmployeeInScope(user: AuthUser, employeeId: string, q: Queryable = db()) {
  const { rows } = await q.query<{ id: string; client_id: string; user_id: string; first_name: string; last_name: string; status: string }>(
    `SELECT e.id, e.client_id, e.user_id, u.first_name, u.last_name, u.status
       FROM employees e JOIN users u ON u.id = e.user_id WHERE e.id = $1`,
    [employeeId],
  );
  const e = rows[0];
  if (!e) throw notFound('Employee');
  if (user.role === 'employee' && user.employeeId !== e.id) throw notFound('Employee');
  if (user.role === 'staff' && !user.clientIds.includes(e.client_id)) throw notFound('Employee');
  return e;
}
