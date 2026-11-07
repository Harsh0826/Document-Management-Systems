import { db, type Queryable } from '../db/index.js';

export type NotificationType =
  | 'document_uploaded'
  | 'document_approved'
  | 'document_rejected'
  | 'renewal_required'
  | 'certificate_expiring'
  | 'certificate_expired'
  | 'document_requested'
  | 'comment_added'
  | 'account';

export interface NewNotification {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  entityType?: string;
  entityId?: string;
}

export async function notify(userIds: Iterable<string>, n: NewNotification, q: Queryable = db()) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  await q.query(
    `INSERT INTO notifications (user_id, type, title, message, link, entity_type, entity_id)
     SELECT u, $2, $3, $4, $5, $6, $7 FROM unnest($1::uuid[]) AS u`,
    [ids, n.type, n.title, n.message, n.link ?? null, n.entityType ?? null, n.entityId ?? null],
  );
}

/**
 * Users who review documents for a client: active admins, plus active staff assigned to that client
 * who hold documents.review.
 */
export async function reviewersForClient(clientId: string, q: Queryable = db()): Promise<string[]> {
  const { rows } = await q.query<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.status = 'active' AND r.name = 'admin'
     UNION
     SELECT u.id FROM users u
       JOIN roles r ON r.id = u.role_id AND r.name = 'staff'
       JOIN staff_client_assignments sca ON sca.staff_user_id = u.id AND sca.client_id = $1
       JOIN user_permissions up ON up.user_id = u.id
       JOIN permissions p ON p.id = up.permission_id AND p.key = 'documents.review'
      WHERE u.status = 'active'`,
    [clientId],
  );
  return rows.map((r) => r.id);
}

/** The user account behind an employee record. */
export async function userIdForEmployee(employeeId: string, q: Queryable = db()): Promise<string | null> {
  const { rows } = await q.query<{ user_id: string }>('SELECT user_id FROM employees WHERE id = $1', [employeeId]);
  return rows[0]?.user_id ?? null;
}
