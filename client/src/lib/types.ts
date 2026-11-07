export type Role = 'admin' | 'staff' | 'employee';
export type DocumentStatus = 'pending_review' | 'approved' | 'rejected' | 'expired' | 'renewal_required';
export type Permission =
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

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  permissions: Permission[];
  employeeId: string | null;
  clientId: string | null;
  clientIds: string[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type DocAction = 'download' | 'replace' | 'edit' | 'edit_dates' | 'move' | 'review' | 'archive' | 'delete' | 'comment' | 'comment_internal';

export interface DocumentItem {
  id: string;
  title: string;
  description: string | null;
  status: DocumentStatus;
  issueDate: string | null;
  expiryDate: string | null;
  daysToExpiry: number | null;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  clientId: string;
  clientName: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isCertificate: boolean;
  folderId: string | null;
  folderName: string | null;
  file: { versionId: string; versionNumber: number; filename: string; ext: string; mimeType: string; sizeBytes: number } | null;
  uploadedAt: string | null;
  uploadedById: string | null;
  uploadedByName: string | null;
  can: Record<DocAction, boolean>;
}

export interface DocumentVersion {
  id: string;
  versionNumber: number;
  filename: string;
  ext: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  issueDate: string | null;
  expiryDate: string | null;
  changeNote: string | null;
  createdAt: string;
  uploadedByName: string | null;
}

export interface DocumentDetail extends DocumentItem {
  folderPath: { id: string; name: string; kind: string }[];
  versions: DocumentVersion[];
  approvals: { id: string; decision: 'approved' | 'rejected' | 'renewal_required'; comment: string | null; createdAt: string; versionNumber: number | null; reviewerName: string | null }[];
  comments: DocComment[];
}

export interface DocComment {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
  authorRole: Role | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isCertificate: boolean;
  requiresExpiry: boolean;
  sortOrder: number;
  documentCount: number;
}

export interface Client {
  id: string;
  name: string;
  code: string;
  industry: string | null;
  contactEmail: string | null;
  isActive: boolean;
  createdAt: string;
  employeeCount: number;
  documentCount: number;
  pendingCount: number;
  staffCount: number;
}

export interface Employee {
  id: string;
  userId: string;
  clientId: string;
  clientName: string;
  employeeNumber: string | null;
  department: string | null;
  position: string | null;
  hireDate: string | null;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  documentCount: number;
  pendingCount: number;
  expiredCount: number;
  openRequestCount: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  clientId: string;
  employeeId: string | null;
  categoryId: string | null;
  kind: 'client_root' | 'employee_root' | 'category' | 'custom';
  documentCount: number;
  childCount: number;
  isSystem: boolean;
}

export interface FolderDetail extends Folder {
  path: { id: string; name: string; kind: string }[];
  children: Folder[];
}

export interface UserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: 'invited' | 'active' | 'deactivated';
  role: Role;
  jobTitle: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  employeeId: string | null;
  employeeNumber: string | null;
  department: string | null;
  clientId: string | null;
  clientName: string | null;
  assignedClientCount: number;
  documentCount: number;
}

export interface UserDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  jobTitle: string | null;
  status: 'invited' | 'active' | 'deactivated';
  role: Role;
  lastLoginAt: string | null;
  createdAt: string;
  lockedUntil: string | null;
  employee: {
    id: string;
    clientId: string;
    clientName: string;
    employeeNumber: string | null;
    department: string | null;
    position: string | null;
    hireDate: string | null;
    documentCount: number;
  } | null;
  grantedPermissions: Permission[];
  rolePermissions: Permission[];
  assignedClients: { id: string; name: string; code: string }[];
}

export interface PermissionInfo {
  key: Permission;
  description: string;
  grantableToStaff: boolean;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  clientId: string | null;
  clientName: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  documentTitle: string | null;
  createdAt: string;
}

export interface DocumentRequest {
  id: string;
  clientId: string;
  clientName: string;
  employeeId: string;
  employeeName: string;
  categoryId: string | null;
  categoryName: string | null;
  title: string;
  instructions: string | null;
  dueDate: string | null;
  daysUntilDue: number | null;
  status: 'open' | 'fulfilled' | 'cancelled';
  requestedByName: string | null;
  fulfilledDocumentId: string | null;
  fulfilledDocumentTitle: string | null;
  fulfilledAt: string | null;
  createdAt: string;
}

export interface Dashboard {
  totals: {
    employees: number;
    documents: number;
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
    renewalRequired: number;
    expiring30: number;
    expiring60: number;
    expiring90: number;
    openRequests: number;
    overdueRequests: number;
  };
  uploadsByMonth: { month: string; uploads: number }[];
  byCategory: { name: string; count: number }[];
  recentUploads: DocumentItem[];
  pendingApprovals: DocumentItem[];
  expiringSoon: DocumentItem[];
  recentActivity: { id: string; action: string; entityType: string | null; entityId: string | null; documentTitle: string | null; metadata: Record<string, any>; actorName: string; createdAt: string }[];
}
