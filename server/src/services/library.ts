/**
 * Company document library: shared folders (max 3 levels) and files every employee can view and download.
 */
import { db, type Queryable } from '../db/index.js';
import { likeEscape } from '../lib/validate.js';
import { PREVIEWABLE_EXTS, type FileExt } from './files.js';

export const MAX_DEPTH = 3;
export const RECENT_DAYS = 7;
export const RESTORE_DAYS = 30;

const TYPE_LABEL: Record<string, string> = {
  pdf: 'PDF',
  doc: 'Word document',
  docx: 'Word document',
  xls: 'Excel sheet',
  xlsx: 'Excel sheet',
  jpg: 'Picture',
  jpeg: 'Picture',
  png: 'Picture',
};

/** Live file + its current copy + up to three levels of folder path (no recursion needed). */
export const FILE_SELECT = `
  SELECT lf.id, lf.name, lf.folder_id, lf.valid_until, (lf.valid_until - CURRENT_DATE) AS days_left,
         lf.created_at, lf.updated_at, lf.deleted_at,
         v.id AS version_id, v.file_ext, v.mime_type, v.size_bytes, v.original_filename, v.version_number, v.storage_key,
         ub.first_name || ' ' || ub.last_name AS uploaded_by_name,
         f1.id AS f1_id, f1.name AS f1_name, f2.id AS f2_id, f2.name AS f2_name, f3.id AS f3_id, f3.name AS f3_name
    FROM library_files lf
    JOIN library_folders f1 ON f1.id = lf.folder_id
    LEFT JOIN library_folders f2 ON f2.id = f1.parent_id
    LEFT JOIN library_folders f3 ON f3.id = f2.parent_id
    LEFT JOIN library_file_versions v ON v.id = lf.current_version_id
    LEFT JOIN users ub ON ub.id = lf.uploaded_by`;

export type FileRow = Record<string, any>;

const pathOf = (r: FileRow) =>
  [
    [r.f3_id, r.f3_name],
    [r.f2_id, r.f2_name],
    [r.f1_id, r.f1_name],
  ]
    .filter(([id]) => id)
    .map(([id, name]) => ({ id: id as string, name: name as string }));

export function serializeFile(r: FileRow, isAdmin: boolean) {
  const ext = (r.file_ext ?? '') as FileExt;
  return {
    id: r.id,
    name: r.name,
    folderId: r.folder_id,
    folderPath: pathOf(r),
    validUntil: r.valid_until,
    daysLeft: r.days_left ?? null,
    addedAt: r.created_at,
    updatedAt: r.updated_at,
    isNew: Date.now() - new Date(r.created_at).getTime() < RECENT_DAYS * 86_400_000,
    type: TYPE_LABEL[ext] ?? ext.toUpperCase(),
    ext,
    sizeBytes: r.size_bytes,
    previewable: PREVIEWABLE_EXTS.includes(ext),
    ...(isAdmin ? { uploadedByName: r.uploaded_by_name, originalFilename: r.original_filename, deletedAt: r.deleted_at } : {}),
  };
}

/** Folder with its stored file count (including sub-folders), sub-folder count and parent names. */
export const FOLDER_SELECT = `
  SELECT f.id, f.name, f.parent_id, f.depth, f.created_at, f.total_files AS file_count, f.own_files,
         (SELECT count(*)::int FROM library_folders s WHERE s.parent_id = f.id) AS folder_count,
         p.id AS p_id, p.name AS p_name, g.id AS g_id, g.name AS g_name
    FROM library_folders f
    LEFT JOIN library_folders p ON p.id = f.parent_id
    LEFT JOIN library_folders g ON g.id = p.parent_id`;

export const serializeFolder = (f: Record<string, any>) => ({
  id: f.id,
  name: f.name,
  parentId: f.parent_id,
  depth: f.depth,
  fileCount: f.file_count ?? 0,
  folderCount: f.folder_count ?? 0,
  /** Where the folder lives, top-level first (empty for top-level folders). */
  parents: [
    [f.g_id, f.g_name],
    [f.p_id, f.p_name],
  ]
    .filter(([id]) => id)
    .map(([id, name]) => ({ id: id as string, name: name as string })),
});

export async function folderPath(id: string, q: Queryable = db()) {
  const { rows } = await q.query<{ a_id: string; a_name: string; b_id: string | null; b_name: string | null; c_id: string | null; c_name: string | null }>(
    `SELECT a.id AS a_id, a.name AS a_name, b.id AS b_id, b.name AS b_name, c.id AS c_id, c.name AS c_name
       FROM library_folders a LEFT JOIN library_folders b ON b.id = a.parent_id LEFT JOIN library_folders c ON c.id = b.parent_id
      WHERE a.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return [
    [r.c_id, r.c_name],
    [r.b_id, r.b_name],
    [r.a_id, r.a_name],
  ]
    .filter(([x]) => x)
    .map(([fid, name]) => ({ id: fid as string, name: name as string }));
}

// ---- Search ---------------------------------------------------------------------------
/** Everyday spelling variants so "license" finds "Licence" and "policies" finds "Policy". */
const VARIANTS: [RegExp, string][] = [
  [/licence/g, 'license'],
  [/license/g, 'licence'],
  [/organisation/g, 'organization'],
  [/organization/g, 'organisation'],
  [/ies$/, 'y'],
  [/y$/, 'ies'],
  [/s$/, ''],
];

export function wordVariants(word: string): string[] {
  const w = word.toLowerCase();
  const out = new Set([w]);
  for (const [re, rep] of VARIANTS) if (re.test(w)) out.add(w.replace(re, rep));
  return [...out].filter((x) => x.length > 0);
}

/**
 * SQL condition: every word must appear (in any spelling variant) in the file's search text: its name,
 * original file name and folder names (kept up to date by the database, and indexed).
 * Returns the condition and its parameters (from $start).
 */
export function searchCondition(q: string, start: number): { sql: string; params: string[] } {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const params: string[] = [];
  const parts = words.map((w) => {
    const ors = wordVariants(w).map((v) => {
      params.push(`%${likeEscape(v)}%`);
      return `lf.search_text LIKE $${start + params.length - 1}`;
    });
    return `(${ors.join(' OR ')})`;
  });
  return { sql: parts.length ? parts.join(' AND ') : 'TRUE', params };
}

/** Same idea for folder names (alias `f`): every word must appear in the folder's name. */
export function folderSearchCondition(q: string, start: number): { sql: string; params: string[] } {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const params: string[] = [];
  const parts = words.map((w) => {
    const ors = wordVariants(w).map((v) => {
      params.push(`%${likeEscape(v)}%`);
      return `f.name ILIKE $${start + params.length - 1}`;
    });
    return `(${ors.join(' OR ')})`;
  });
  return { sql: parts.length ? parts.join(' AND ') : 'TRUE', params };
}

/** Turns "fire_safety-licence 2025.pdf" into "Fire Safety Licence 2025". */
export function nameFromFilename(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+|(?<=\S)-(?=\S)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 200) || 'Untitled document';
}
