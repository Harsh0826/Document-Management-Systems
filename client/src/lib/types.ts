export type Role = 'admin' | 'employee';

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  mfaEnabled: boolean;
  mfaSetupRequired: boolean;
}

export interface FolderCrumb {
  id: string;
  name: string;
}

export interface LibraryFolder {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  fileCount: number;
  folderCount: number;
  /** Where the folder lives, top-level first (empty for top-level folders). */
  parents: FolderCrumb[];
}

export interface LibraryFile {
  id: string;
  name: string;
  folderId: string;
  folderPath: FolderCrumb[];
  validUntil: string | null;
  daysLeft: number | null;
  addedAt: string;
  updatedAt: string;
  isNew: boolean;
  /** Plain-language type: "PDF", "Word document", "Excel sheet", "Picture" */
  type: string;
  ext: string;
  sizeBytes: number;
  previewable: boolean;
  // administrators only
  uploadedByName?: string | null;
  originalFilename?: string;
  deletedAt?: string | null;
  removedForGoodAt?: string;
}

export interface FolderDetail extends LibraryFolder {
  path: FolderCrumb[];
  subfolders: LibraryFolder[];
  /** Files directly in this folder (fileCount includes sub-folders). */
  ownFileCount: number;
  pinned: boolean;
}

export interface HomeData {
  folders: LibraryFolder[];
  pinned: LibraryFolder[];
  recent: LibraryFile[];
  opened: LibraryFile[];
  totals: { files: number; folders: number };
  attention?: { expired: number; soon: number };
}

export type FileType = 'pdf' | 'word' | 'excel' | 'picture';
export type Validity = 'expired' | 'soon' | 'valid' | 'none';
export type Added = '7' | '30' | '365';
export type FileSort = 'relevance' | 'newest' | 'oldest' | 'name' | 'name_desc' | 'expiry' | 'largest';

/** What a list of documents is showing: where, which words, which filters, in which order. */
export interface FileQuery {
  q?: string;
  folder?: string;
  deep?: boolean;
  type?: FileType;
  validity?: Validity;
  added?: Added;
  sort?: FileSort;
}

export interface FilePage {
  files: LibraryFile[];
  nextOffset: number | null;
  /** Only on the first page. */
  total?: number;
  totalIsCapped?: boolean;
}

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isAdmin: boolean;
  status: 'invited' | 'active' | 'deactivated';
  lastLoginAt: string | null;
  addedAt: string;
  twoStepOn: boolean;
}
