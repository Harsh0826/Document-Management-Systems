import { writeFile } from 'node:fs/promises';
import request from 'supertest';
import type { Express } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { listStoredFiles, migrateFiles, type StoredFile } from '../src/services/storage-migration.js';
import { LocalStorage } from '../src/services/storage.js';
import { FakeS3 } from './fake-s3.js';
import { purgeDeletedFiles } from '../src/services/maintenance.js';
import { ADMIN, auth, createFolder, login, PDF, PNG, setupApp, uploadFile } from './helpers.js';

let app: Express;
let files: StoredFile[];
const source = new LocalStorage(process.env.LOCAL_STORAGE_DIR);

beforeAll(async () => {
  app = await setupApp();
  const admin = (await login(app, ADMIN.email, ADMIN.password)).token;
  const folder = await createFolder(app, admin, 'Licences');
  for (let i = 0; i < 4; i++) {
    const r = await uploadFile(app, admin, { name: `Cert ${i}`, folderId: folder.id }, i % 2 ? PNG : PDF, i % 2 ? `scan-${i}.png` : `cert-${i}.pdf`);
    expect(r.status).toBe(201);
  }
  // A deleted document's files must not be migrated.
  const gone = await uploadFile(app, admin, { name: 'Deleted', folderId: folder.id });
  await request(app).delete(`/api/library/files/${gone.body.id}`).set(auth(admin)).expect(204);
  await db().query(`UPDATE library_files SET deleted_at = now() - interval '31 days' WHERE id = $1`, [gone.body.id]);
  await purgeDeletedFiles();
  files = await listStoredFiles(db());
});

describe('local → S3 storage migration', () => {
  it('lists only files that have not been removed for good', () => {
    expect(files).toHaveLength(4);
    expect(files.every((f) => f.sha256.length === 64)).toBe(true);
  });

  it('dry run verifies everything and uploads nothing', async () => {
    const target = new FakeS3();
    const r = await migrateFiles({ files, source, target, dryRun: true });
    expect(r.counts.would_upload).toBe(4);
    expect(target.objects.size).toBe(0);
  });

  it('copies every file byte-for-byte with its content type, and re-running skips them', async () => {
    const target = new FakeS3();
    const first = await migrateFiles({ files, source, target, concurrency: 2 });
    expect(first.counts.uploaded).toBe(4);
    expect(first.problems).toHaveLength(0);
    for (const f of files) {
      const obj = target.objects.get(f.key)!;
      expect(obj.sha256).toBe(f.sha256);
      expect(obj.type).toBe(f.mimeType);
      expect(obj.body.equals((await source.read(f.key))!)).toBe(true);
    }
    const second = await migrateFiles({ files, source, target });
    expect(second.counts.already_present).toBe(4);
    expect(second.counts.uploaded).toBe(0);
  });

  it('re-uploads an object whose copy in S3 is incomplete', async () => {
    const target = new FakeS3();
    await migrateFiles({ files, source, target });
    const f = files[0];
    target.objects.set(f.key, { body: Buffer.from('truncated'), sha256: null, type: f.mimeType });
    const r = await migrateFiles({ files, source, target });
    expect(r.counts.uploaded).toBe(1);
    expect(target.objects.get(f.key)!.sha256).toBe(f.sha256);
  });

  it('refuses to copy a corrupted or missing local file and keeps going', async () => {
    const target = new FakeS3();
    const corrupted = { ...files[1], sha256: 'f'.repeat(64) }; // simulates bit-rot: disk no longer matches the recorded checksum
    const missing = { ...files[2], key: `${files[2].key}.missing` };
    const failing = files[3];
    target.failKeys.add(failing.key);
    const r = await migrateFiles({ files: [files[0], corrupted, missing, failing], source, target });
    expect(r.counts).toMatchObject({ uploaded: 1, checksum_mismatch: 1, missing_source: 1, failed: 1 });
    expect(target.objects.has(corrupted.key)).toBe(false);
    expect(r.problems.map((p) => p.outcome).sort()).toEqual(['checksum_mismatch', 'failed', 'missing_source']);
  });

  it('detects a local file that was altered on disk', async () => {
    const target = new FakeS3();
    const f = files[0];
    await writeFile(source.pathFor(f.key), Buffer.from('%PDF-1.4 tampered'));
    const r = await migrateFiles({ files: [f], source, target });
    expect(r.counts.checksum_mismatch).toBe(1);
    expect(target.objects.size).toBe(0);
  });
});
