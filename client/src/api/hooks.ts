/** TanStack Query hooks for the company library and People. Components never call axios directly. */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FilePage, FileQuery, FolderDetail, HomeData, LibraryFile, LibraryFolder, Person } from '@/lib/types';
import { api } from './client';

export const qk = {
  home: ['library', 'home'] as const,
  folder: (id: string) => ['library', 'folder', id] as const,
  folders: (parent: string | null) => ['library', 'folders', parent ?? 'top'] as const,
  findFolders: (q: string) => ['library', 'find-folders', q] as const,
  files: (f: FileQuery) => ['library', 'files', f] as const,
  file: (id: string) => ['library', 'file', id] as const,
  quick: (q: string) => ['library', 'quick', q] as const,
  pins: ['library', 'pins'] as const,
  expiry: ['library', 'expiry'] as const,
  deleted: ['library', 'deleted'] as const,
  people: ['people'] as const,
};

/** How many documents a list loads at a time. */
export const PAGE_SIZE = 50;

// ---------------------------------------------------------------- reading
export const useHome = () => useQuery({ queryKey: qk.home, queryFn: async () => (await api.get<HomeData>('/library/home')).data });

export const useFolder = (id: string | undefined) =>
  useQuery({
    queryKey: qk.folder(id ?? ''),
    queryFn: async () => (await api.get<FolderDetail>(`/library/folders/${id}`)).data,
    enabled: !!id,
  });

/** One level of folders (top level when `parent` is null), loaded only when needed. */
export const useFolders = (parent: string | null, enabled = true) =>
  useQuery({
    queryKey: qk.folders(parent),
    queryFn: async () => (await api.get<{ folders: LibraryFolder[] }>('/library/folders', { params: parent ? { parent } : {} })).data.folders,
    enabled,
    staleTime: 30_000,
  });

/** Expired and expiring-soon counts for the navigation bar. */
export const useExpiryCounts = () =>
  useQuery({ queryKey: qk.expiry, queryFn: async () => (await api.get<{ expired: number; soon: number }>('/library/expiry')).data, staleTime: 60_000 });

/** Your pinned folders (sidebar). */
export const usePins = () =>
  useQuery({ queryKey: qk.pins, queryFn: async () => (await api.get<{ folders: LibraryFolder[] }>('/library/pins')).data.folders, staleTime: 30_000 });

/** Folders anywhere in the library whose name matches. */
export const useFindFolders = (q: string) =>
  useQuery({
    queryKey: qk.findFolders(q),
    queryFn: async () => (await api.get<{ folders: LibraryFolder[] }>('/library/folders', { params: { q } })).data.folders,
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
  });

const fileParams = (f: FileQuery) => {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '' && v !== false) p[k] = v === true ? '1' : String(v);
  return p;
};

/** Documents, a page at a time; the next page loads as you scroll. */
export const useFiles = (f: FileQuery, enabled = true) =>
  useInfiniteQuery({
    queryKey: qk.files(f),
    queryFn: async ({ pageParam }) => (await api.get<FilePage>('/library/files', { params: { ...fileParams(f), offset: pageParam, limit: PAGE_SIZE } })).data,
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });

export const useFile = (id: string | undefined) =>
  useQuery({ queryKey: qk.file(id ?? ''), queryFn: async () => (await api.get<LibraryFile>(`/library/files/${id}`)).data, enabled: !!id });

/** Suggestions while typing: the best few folders and documents. */
export const useQuickSearch = (q: string) =>
  useQuery({
    queryKey: qk.quick(q),
    queryFn: async ({ signal }) =>
      (await api.get<{ q: string; folders: LibraryFolder[]; files: LibraryFile[]; moreFiles: boolean }>('/library/search', { params: { q, limit: 6 }, signal }))
        .data,
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

export const useDeleted = () => useQuery({ queryKey: qk.deleted, queryFn: async () => (await api.get<LibraryFile[]>('/library/deleted')).data });

export async function getFileUrl(id: string, disposition: 'inline' | 'attachment') {
  return (await api.get<{ url: string; expiresAt: string; filename: string; inline: boolean }>(`/library/files/${id}/url`, { params: { disposition } })).data;
}

/** Starts a download through a short-lived link (the browser never gets a permanent address). */
export async function downloadFile(id: string) {
  const { url } = await getFileUrl(id, 'attachment');
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------- managing (administrators)
function useInvalidateLibrary() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['library'] });
}

export function useCreateFolder() {
  const inv = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (b: { name: string; parentId?: string | null }) => (await api.post<LibraryFolder>('/library/folders', b)).data,
    onSuccess: inv,
  });
}

export function useUpdateFolder() {
  const inv = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ id, ...b }: { id: string; name?: string; parentId?: string | null }) =>
      (await api.patch<LibraryFolder>(`/library/folders/${id}`, b)).data,
    onSuccess: inv,
  });
}

export function useBulkFiles() {
  const inv = useInvalidateLibrary();
  return useMutation({
    mutationFn: async (b: { action: 'move' | 'delete'; ids: string[]; folderId?: string }) =>
      (await api.post<{ done: number; skipped: { id: string; name: string; reason: string }[]; notFound: number }>('/library/files/bulk', b)).data,
    onSuccess: inv,
  });
}

/** Pin or unpin a folder on your Home page. Updates the screen at once, then confirms with the server. */
export function usePinFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) =>
      pinned ? api.put(`/library/folders/${id}/pin`) : api.delete(`/library/folders/${id}/pin`),
    onMutate: ({ id, pinned }) => {
      qc.setQueryData<FolderDetail>(qk.folder(id), (f) => (f ? { ...f, pinned } : f));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });
}

export function useDeleteFolder() {
  const inv = useInvalidateLibrary();
  return useMutation({ mutationFn: async (id: string) => api.delete(`/library/folders/${id}`), onSuccess: inv });
}

export async function uploadLibraryFile(input: { file: File; folderId: string; name?: string; validUntil?: string }, onProgress: (pct: number) => void) {
  const fd = new FormData();
  fd.append('folderId', input.folderId);
  if (input.name) fd.append('name', input.name);
  if (input.validUntil) fd.append('validUntil', input.validUntil);
  fd.append('file', input.file);
  return (await api.post<LibraryFile>('/library/files', fd, { onUploadProgress: (e) => e.total && onProgress(Math.round((e.loaded / e.total) * 100)) })).data;
}

export function useUpdateFile() {
  const inv = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ id, ...b }: { id: string; name?: string; folderId?: string; validUntil?: string | null }) =>
      (await api.patch<LibraryFile>(`/library/files/${id}`, b)).data,
    onSuccess: inv,
  });
}

export function useReplaceFile() {
  const inv = useInvalidateLibrary();
  return useMutation({
    mutationFn: async ({ id, file, validUntil }: { id: string; file: File; validUntil?: string | null }) => {
      const fd = new FormData();
      if (validUntil !== undefined) fd.append('validUntil', validUntil ?? '');
      fd.append('file', file);
      return (await api.post<LibraryFile>(`/library/files/${id}/replace`, fd)).data;
    },
    onSuccess: inv,
  });
}

export function useDeleteFile() {
  const inv = useInvalidateLibrary();
  return useMutation({ mutationFn: async (id: string) => api.delete(`/library/files/${id}`), onSuccess: inv });
}

export function useRestoreFile() {
  const inv = useInvalidateLibrary();
  return useMutation({ mutationFn: async (id: string) => (await api.post<LibraryFile>(`/library/files/${id}/restore`)).data, onSuccess: inv });
}

// ---------------------------------------------------------------- people (administrators)
export const usePeople = () => useQuery({ queryKey: qk.people, queryFn: async () => (await api.get<Person[]>('/people')).data });

function useInvalidatePeople() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qk.people });
}

export function useAddPerson() {
  const inv = useInvalidatePeople();
  return useMutation({
    mutationFn: async (b: { firstName: string; lastName: string; email: string; isAdmin: boolean }) =>
      (await api.post<{ person: Person; inviteUrl: string; expiresInHours: number }>('/people', b)).data,
    onSuccess: inv,
  });
}

export function usePersonAction() {
  const inv = useInvalidatePeople();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'reset-password' | 'remove' | 'restore' | 'reset-two-step' }) =>
      (await api.post(`/people/${id}/${action}`)).data,
    onSuccess: inv,
  });
}

export function useSetAdmin() {
  const inv = useInvalidatePeople();
  return useMutation({
    mutationFn: async ({ id, isAdmin }: { id: string; isAdmin: boolean }) => (await api.patch<Person>(`/people/${id}`, { isAdmin })).data,
    onSuccess: inv,
  });
}
