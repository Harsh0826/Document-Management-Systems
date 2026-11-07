/**
 * TanStack Query hooks for every server resource. Components never call axios directly.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cleanParams } from '@/lib/utils';
import type {
  AuditEntry,
  Category,
  Client,
  Dashboard,
  DocComment,
  DocumentDetail,
  DocumentItem,
  DocumentRequest,
  Employee,
  Folder,
  FolderDetail,
  NotificationItem,
  Paged,
  Permission,
  PermissionInfo,
  UserDetail,
  UserListItem,
} from '@/lib/types';
import { api } from './client';

export const qk = {
  dashboard: ['dashboard'] as const,
  documents: (f?: object) => ['documents', f ?? {}] as const,
  document: (id: string) => ['document', id] as const,
  documentHistory: (id: string) => ['document', id, 'history'] as const,
  categories: ['categories'] as const,
  clients: ['clients'] as const,
  employees: (f?: object) => ['employees', f ?? {}] as const,
  folders: (clientId?: string) => ['folders', clientId ?? 'all'] as const,
  folder: (id: string) => ['folder', id] as const,
  users: (f?: object) => ['users', f ?? {}] as const,
  user: (id: string) => ['user', id] as const,
  permissions: ['permissions'] as const,
  notifications: (f?: object) => ['notifications', f ?? {}] as const,
  unread: ['notifications', 'unread'] as const,
  audit: (f?: object) => ['audit', f ?? {}] as const,
  auditActions: ['audit', 'actions'] as const,
  requests: (f?: object) => ['requests', f ?? {}] as const,
  me: ['me'] as const,
};

/** Invalidates everything that depends on document state. */
function useInvalidateDocs() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['documents'] }),
      qc.invalidateQueries({ queryKey: ['document'] }),
      qc.invalidateQueries({ queryKey: qk.dashboard }),
      qc.invalidateQueries({ queryKey: ['folders'] }),
      qc.invalidateQueries({ queryKey: ['folder'] }),
      qc.invalidateQueries({ queryKey: ['notifications'] }),
      qc.invalidateQueries({ queryKey: ['requests'] }),
      qc.invalidateQueries({ queryKey: ['employees'] }),
    ]);
}

// ---------------------------------------------------------------- dashboard
export const useDashboard = () =>
  useQuery({ queryKey: qk.dashboard, queryFn: async () => (await api.get<Dashboard>('/dashboard')).data, refetchInterval: 60_000 });

// ---------------------------------------------------------------- documents
export interface DocumentFilters {
  q?: string;
  clientId?: string;
  employeeId?: string;
  categoryId?: string[];
  fileType?: string[];
  status?: string[];
  uploadedBy?: string;
  uploadedFrom?: string;
  uploadedTo?: string;
  expiryFrom?: string;
  expiryTo?: string;
  expiringWithin?: number;
  folderId?: string;
  includeSubfolders?: boolean;
  archived?: 'exclude' | 'only' | 'include';
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const useDocuments = (f: DocumentFilters, enabled = true) =>
  useQuery({
    queryKey: qk.documents(f),
    queryFn: async () => (await api.get<Paged<DocumentItem>>('/documents', { params: cleanParams({ ...f, includeSubfolders: f.includeSubfolders ? 'true' : undefined }) })).data,
    placeholderData: keepPreviousData,
    enabled,
  });

export const useDocument = (id: string | undefined) =>
  useQuery({ queryKey: qk.document(id ?? ''), queryFn: async () => (await api.get<DocumentDetail>(`/documents/${id}`)).data, enabled: !!id });

export const useDocumentHistory = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: qk.documentHistory(id),
    queryFn: async () => (await api.get<{ id: string; action: string; metadata: Record<string, any>; createdAt: string; actorName: string | null; ip: string | null }[]>(`/documents/${id}/history`)).data,
    enabled,
  });

export async function getDocumentUrl(id: string, disposition: 'inline' | 'attachment', versionId?: string) {
  return (
    await api.get<{ url: string; expiresAt: string; filename: string; mimeType: string; previewable: boolean; disposition: string }>(`/documents/${id}/url`, {
      params: cleanParams({ disposition, versionId }),
    })
  ).data;
}

/** Downloads via a short-lived signed URL (the browser never sees a permanent link). */
export async function downloadDocument(id: string, versionId?: string) {
  const { url } = await getDocumentUrl(id, 'attachment', versionId);
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface UploadInput {
  file: File;
  title: string;
  description?: string;
  categoryId?: string;
  employeeId?: string;
  folderId?: string;
  requestId?: string;
  issueDate?: string;
  expiryDate?: string;
}

export async function uploadDocument(input: UploadInput, onProgress: (pct: number) => void, signal?: AbortSignal) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(input)) if (k !== 'file' && v) fd.append(k, String(v));
  fd.append('file', input.file);
  return (
    await api.post<DocumentItem>('/documents', fd, {
      signal,
      onUploadProgress: (e) => e.total && onProgress(Math.round((e.loaded / e.total) * 100)),
    })
  ).data;
}

export async function uploadVersion(id: string, input: { file: File; issueDate?: string; expiryDate?: string; changeNote?: string }, onProgress: (pct: number) => void) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(input)) if (k !== 'file' && v) fd.append(k, String(v));
  fd.append('file', input.file);
  return (await api.post<DocumentItem>(`/documents/${id}/versions`, fd, { onUploadProgress: (e) => e.total && onProgress(Math.round((e.loaded / e.total) * 100)) })).data;
}

export function useInvalidateDocuments() {
  return useInvalidateDocs();
}

export function useUpdateDocument(id: string) {
  const inv = useInvalidateDocs();
  return useMutation({
    mutationFn: async (body: Partial<{ title: string; description: string | null; categoryId: string | null; issueDate: string | null; expiryDate: string | null; folderId: string }>) =>
      (await api.patch<DocumentItem>(`/documents/${id}`, body)).data,
    onSuccess: inv,
  });
}

export function useReviewDocument() {
  const inv = useInvalidateDocs();
  return useMutation({
    mutationFn: async ({ id, decision, comment }: { id: string; decision: 'approved' | 'rejected' | 'renewal_required'; comment?: string }) =>
      (await api.post<DocumentItem>(`/documents/${id}/review`, { decision, comment })).data,
    onSuccess: inv,
  });
}

export function useArchiveDocument() {
  const inv = useInvalidateDocs();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => (await api.post<DocumentItem>(`/documents/${id}/${archived ? 'archive' : 'unarchive'}`)).data,
    onSuccess: inv,
  });
}

export function useDeleteDocument() {
  const inv = useInvalidateDocs();
  return useMutation({ mutationFn: async (id: string) => api.delete(`/documents/${id}`), onSuccess: inv });
}

export function useMoveDocuments() {
  const inv = useInvalidateDocs();
  return useMutation({
    mutationFn: async (b: { documentIds: string[]; folderId: string }) => (await api.post<{ moved: number }>('/documents/move', b)).data,
    onSuccess: inv,
  });
}

export function useAddComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: { body: string; isInternal: boolean }) => (await api.post<DocComment>(`/documents/${id}/comments`, b)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.document(id) }),
  });
}

// ---------------------------------------------------------------- reference data
export const useCategories = () =>
  useQuery({ queryKey: qk.categories, queryFn: async () => (await api.get<Category[]>('/categories')).data, staleTime: 5 * 60_000 });

export const useClients = (includeInactive = false) =>
  useQuery({
    queryKey: [...qk.clients, includeInactive],
    queryFn: async () => (await api.get<Client[]>('/clients', { params: includeInactive ? { includeInactive: 'true' } : {} })).data,
    staleTime: 60_000,
  });

export const useEmployees = (f: { q?: string; clientId?: string; page?: number; pageSize?: number } = {}, enabled = true) =>
  useQuery({
    queryKey: qk.employees(f),
    queryFn: async () => (await api.get<Paged<Employee>>('/employees', { params: cleanParams({ pageSize: 500, ...f }) })).data,
    placeholderData: keepPreviousData,
    enabled,
  });

export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<Category> & { name: string }) =>
      id ? (await api.patch<Category>(`/categories/${id}`, body)).data : (await api.post<Category>('/categories', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.categories }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => api.delete(`/categories/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: qk.categories }) });
}

export function useSaveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id?: string; name: string; code: string; industry?: string | null; contactEmail?: string | null; isActive?: boolean }) =>
      id ? (await api.patch<Client>(`/clients/${id}`, body)).data : (await api.post<Client>('/clients', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clients });
      qc.invalidateQueries({ queryKey: ['folders'] });
    },
  });
}

// ---------------------------------------------------------------- folders
export const useFolders = (clientId?: string) =>
  useQuery({ queryKey: qk.folders(clientId), queryFn: async () => (await api.get<Folder[]>('/folders', { params: cleanParams({ clientId }) })).data });

export const useFolder = (id: string | undefined) =>
  useQuery({ queryKey: qk.folder(id ?? ''), queryFn: async () => (await api.get<FolderDetail>(`/folders/${id}`)).data, enabled: !!id });

function useInvalidateFolders() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['folders'] }), qc.invalidateQueries({ queryKey: ['folder'] }), qc.invalidateQueries({ queryKey: ['documents'] })]);
}

export function useCreateFolder() {
  const inv = useInvalidateFolders();
  return useMutation({ mutationFn: async (b: { name: string; parentId: string }) => (await api.post<Folder>('/folders', b)).data, onSuccess: inv });
}

export function useUpdateFolder() {
  const inv = useInvalidateFolders();
  return useMutation({
    mutationFn: async ({ id, ...b }: { id: string; name?: string; parentId?: string }) => (await api.patch<Folder>(`/folders/${id}`, b)).data,
    onSuccess: inv,
  });
}

export function useDeleteFolder() {
  const inv = useInvalidateFolders();
  return useMutation({
    mutationFn: async ({ id, moveContents }: { id: string; moveContents: boolean }) =>
      (await api.delete<{ movedDocuments: number; movedFolders: number; parentId: string }>(`/folders/${id}`, { params: moveContents ? { moveContentsToParent: 'true' } : {} })).data,
    onSuccess: inv,
  });
}

// ---------------------------------------------------------------- users
export const useUsers = (f: { q?: string; role?: string; status?: string; clientId?: string; page?: number; pageSize?: number }, enabled = true) =>
  useQuery({
    queryKey: qk.users(f),
    queryFn: async () => (await api.get<Paged<UserListItem>>('/users', { params: cleanParams(f) })).data,
    placeholderData: keepPreviousData,
    enabled,
  });

export const useUser = (id: string | undefined) =>
  useQuery({ queryKey: qk.user(id ?? ''), queryFn: async () => (await api.get<UserDetail>(`/users/${id}`)).data, enabled: !!id });

export const usePermissions = () =>
  useQuery({ queryKey: qk.permissions, queryFn: async () => (await api.get<PermissionInfo[]>('/users/permissions')).data, staleTime: Infinity });

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['users'] }), qc.invalidateQueries({ queryKey: ['user'] }), qc.invalidateQueries({ queryKey: ['employees'] }), qc.invalidateQueries({ queryKey: qk.clients })]);
}

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'staff' | 'employee';
  phone?: string;
  jobTitle?: string;
  clientId?: string;
  employeeNumber?: string;
  department?: string;
  position?: string;
  hireDate?: string;
  permissions?: Permission[];
  clientIds?: string[];
  password?: string;
}

export function useCreateUser() {
  const inv = useInvalidateUsers();
  return useMutation({
    mutationFn: async (b: CreateUserInput) => (await api.post<{ user: UserDetail; inviteUrl: string | null; inviteExpiresInHours: number | null }>('/users', b)).data,
    onSuccess: inv,
  });
}

export function useUpdateUser(id: string) {
  const inv = useInvalidateUsers();
  return useMutation({ mutationFn: async (b: Record<string, unknown>) => (await api.patch<UserDetail>(`/users/${id}`, b)).data, onSuccess: inv });
}

export function useUserAction() {
  const inv = useInvalidateUsers();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'deactivate' | 'activate' | 'invite' }) => (await api.post(`/users/${id}/${action}`)).data,
    onSuccess: inv,
  });
}

export function useSetPermissions(id: string) {
  const inv = useInvalidateUsers();
  return useMutation({ mutationFn: async (permissions: Permission[]) => (await api.put<UserDetail>(`/users/${id}/permissions`, { permissions })).data, onSuccess: inv });
}

export function useSetClients(id: string) {
  const inv = useInvalidateUsers();
  return useMutation({ mutationFn: async (clientIds: string[]) => (await api.put<UserDetail>(`/users/${id}/clients`, { clientIds })).data, onSuccess: inv });
}

// ---------------------------------------------------------------- requests
export const useRequests = (f: { status?: string; employeeId?: string; clientId?: string; page?: number; pageSize?: number }) =>
  useQuery({
    queryKey: qk.requests(f),
    queryFn: async () => (await api.get<Paged<DocumentRequest>>('/requests', { params: cleanParams(f) })).data,
    placeholderData: keepPreviousData,
  });

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: { employeeIds: string[]; categoryId?: string | null; title: string; instructions?: string; dueDate?: string }) =>
      (await api.post<DocumentRequest[]>('/requests', b)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useCancelRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<DocumentRequest>(`/requests/${id}/cancel`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

// ---------------------------------------------------------------- notifications
export const useNotifications = (f: { unreadOnly?: boolean; page?: number; pageSize?: number } = {}) =>
  useQuery({
    queryKey: qk.notifications(f),
    queryFn: async () =>
      (await api.get<Paged<NotificationItem> & { unread: number }>('/notifications', { params: cleanParams({ ...f, unreadOnly: f.unreadOnly ? 'true' : undefined }) })).data,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string | 'all') => (id === 'all' ? api.post('/notifications/read-all') : api.post(`/notifications/${id}/read`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// ---------------------------------------------------------------- audit
export const useAuditLogs = (f: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: qk.audit(f),
    queryFn: async () => (await api.get<Paged<AuditEntry>>('/audit-logs', { params: cleanParams(f) })).data,
    placeholderData: keepPreviousData,
  });

export const useAuditActions = () => useQuery({ queryKey: qk.auditActions, queryFn: async () => (await api.get<string[]>('/audit-logs/actions')).data });

// ---------------------------------------------------------------- profile
export const useMe = () =>
  useQuery({
    queryKey: qk.me,
    queryFn: async () =>
      (
        await api.get<{
          user: unknown;
          profile: {
            phone: string | null;
            jobTitle: string | null;
            lastLoginAt: string | null;
            createdAt: string;
            employeeNumber: string | null;
            department: string | null;
            position: string | null;
            hireDate: string | null;
            clientId: string | null;
            clientName: string | null;
          };
        }>('/auth/me')
      ).data,
  });
