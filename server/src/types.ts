export type RoleName = 'admin' | 'staff' | 'employee';

export type PermissionKey =
  | 'documents.view'
  | 'documents.download'
  | 'documents.upload'
  | 'documents.edit'
  | 'documents.review'
  | 'documents.archive'
  | 'documents.delete'
  | 'documents.comment'
  | 'folders.manage'
  | 'requests.manage'
  | 'users.manage'
  | 'clients.manage'
  | 'audit.view';

export const ALL_PERMISSIONS: PermissionKey[] = [
  'documents.view',
  'documents.download',
  'documents.upload',
  'documents.edit',
  'documents.review',
  'documents.archive',
  'documents.delete',
  'documents.comment',
  'folders.manage',
  'requests.manage',
  'users.manage',
  'clients.manage',
  'audit.view',
];

/** Permissions an admin may grant to staff. users/clients/audit admin powers stay with admins only. */
export const STAFF_GRANTABLE: PermissionKey[] = [
  'documents.download',
  'documents.upload',
  'documents.edit',
  'documents.review',
  'documents.archive',
  'documents.delete',
  'documents.comment',
  'folders.manage',
  'requests.manage',
  'audit.view',
];

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: RoleName;
  permissions: Set<PermissionKey>;
  /** employee role only */
  employeeId: string | null;
  /** employee role only — their company */
  clientId: string | null;
  /** staff role only — assigned clients */
  clientIds: string[];
}

export type DocumentStatus = 'pending_review' | 'approved' | 'rejected' | 'expired' | 'renewal_required';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}
