/**
 * Copies stored document files from one storage driver to another (local disk → S3).
 *
 * Safe to run repeatedly: objects already present in the target with the same size and SHA-256 are
 * skipped. Every source file is checked against the checksum recorded at upload time before it is
 * copied, so a corrupted local copy is never propagated.
 */
import { createHash } from 'node:crypto';
import type { Queryable } from '../db/index.js';
import type { StorageDriver } from './storage.js';

export interface StoredFile {
  versionId: string;
  documentId: string;
  key: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export type FileOutcome = 'uploaded' | 'would_upload' | 'already_present' | 'missing_source' | 'checksum_mismatch' | 'failed';

export interface MigrationReport {
  startedAt: string;
  finishedAt?: string;
  dryRun: boolean;
  total: number;
  counts: Record<FileOutcome, number>;
  bytesUploaded: number;
  problems: { key: string; documentId: string; filename: string; outcome: FileOutcome; detail?: string }[];
}

/** Every stored copy (all versions) of library files that have not been removed for good. */
export async function listStoredFiles(q: Queryable): Promise<StoredFile[]> {
  const { rows } = await q.query<{
    id: string;
    file_id: string;
    storage_key: string;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    checksum_sha256: string;
  }>(
    `SELECT v.id, v.file_id, v.storage_key, v.original_filename, v.mime_type, v.size_bytes, v.checksum_sha256
       FROM library_file_versions v JOIN library_files lf ON lf.id = v.file_id
      WHERE lf.purged_at IS NULL
      ORDER BY v.created_at`,
  );
  return rows.map((r) => ({
    versionId: r.id,
    documentId: r.file_id,
    key: r.storage_key,
    filename: r.original_filename,
    mimeType: r.mime_type,
    size: Number(r.size_bytes),
    sha256: r.checksum_sha256,
  }));
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function copyOne(
  f: StoredFile,
  source: StorageDriver,
  target: StorageDriver,
  dryRun: boolean,
): Promise<{ outcome: FileOutcome; detail?: string; bytes?: number }> {
  // 1. Already there and intact? (our S3 uploads record the SHA-256 as object metadata)
  const existing = await target.head(f.key);
  if (existing && existing.size === f.size) {
    if (existing.sha256 === f.sha256) return { outcome: 'already_present' };
    if (existing.sha256 === null) {
      const body = await target.read(f.key);
      if (body && sha256(body) === f.sha256) return { outcome: 'already_present' };
    }
  }

  // 2. Read and verify the source copy against the checksum recorded at upload time.
  const body = await source.read(f.key);
  if (!body) return { outcome: 'missing_source', detail: 'File not found in source storage' };
  const actual = sha256(body);
  if (actual !== f.sha256) return { outcome: 'checksum_mismatch', detail: `expected ${f.sha256}, found ${actual}` };
  if (dryRun) return { outcome: 'would_upload', bytes: body.length };

  // 3. Upload (S3 re-verifies the SHA-256 server-side) and confirm what landed.
  await target.put(f.key, body, f.mimeType);
  const after = await target.head(f.key);
  if (!after || after.size !== f.size || (after.sha256 !== null && after.sha256 !== f.sha256)) {
    return { outcome: 'failed', detail: 'Uploaded object did not verify (size or checksum differs)' };
  }
  return { outcome: 'uploaded', bytes: body.length };
}

export async function migrateFiles(opts: {
  files: StoredFile[];
  source: StorageDriver;
  target: StorageDriver;
  dryRun?: boolean;
  concurrency?: number;
  onProgress?: (done: number, total: number, f: StoredFile, outcome: FileOutcome) => void;
}): Promise<MigrationReport> {
  const { files, source, target, dryRun = false, concurrency = 4, onProgress } = opts;
  const report: MigrationReport = {
    startedAt: new Date().toISOString(),
    dryRun,
    total: files.length,
    counts: { uploaded: 0, would_upload: 0, already_present: 0, missing_source: 0, checksum_mismatch: 0, failed: 0 },
    bytesUploaded: 0,
    problems: [],
  };
  const queue = [...files];
  let done = 0;

  const worker = async () => {
    while (queue.length) {
      const f = queue.shift()!;
      let result: Awaited<ReturnType<typeof copyOne>>;
      try {
        result = await copyOne(f, source, target, dryRun);
      } catch (err) {
        result = { outcome: 'failed', detail: err instanceof Error ? err.message : String(err) };
      }
      report.counts[result.outcome]++;
      if (result.outcome === 'uploaded') report.bytesUploaded += result.bytes ?? 0;
      if (['missing_source', 'checksum_mismatch', 'failed'].includes(result.outcome)) {
        report.problems.push({ key: f.key, documentId: f.documentId, filename: f.filename, outcome: result.outcome, detail: result.detail });
      }
      onProgress?.(++done, files.length, f, result.outcome);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, files.length)) }, worker));
  report.finishedAt = new Date().toISOString();
  return report;
}
