import request from 'supertest';
import type { Express } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { __setS3FactoryForTests, __waitForJob } from '../src/services/storage-settings.js';
import { storage } from '../src/services/storage.js';
import { FakeS3 } from './fake-s3.js';
import { ADMIN, addPerson, auth, createFolder, login, PASSWORD, PDF, setupApp, uploadFile } from './helpers.js';

const s3 = new FakeS3();
let app: Express;
let admin: string;
let folderId: string;
const SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEYxx';

beforeAll(async () => {
  __setS3FactoryForTests(() => s3);
  app = await setupApp();
  admin = (await login(app, ADMIN.email, ADMIN.password)).token;
  await addPerson(app, admin, { email: 'emp-sto@test.local' });
  folderId = (await createFolder(app, admin, 'Licences')).id;
  for (let i = 0; i < 3; i++) {
    expect((await uploadFile(app, admin, { name: `Doc ${i}`, folderId }, PDF, `doc-${i}.pdf`)).status).toBe(201);
  }
});

const settings = () => request(app).get('/api/admin/storage').set(auth(admin));

describe('storage settings screen (admin)', () => {
  it('is admin-only', async () => {
    const staff = await login(app, 'emp-sto@test.local', PASSWORD);
    expect((await request(app).get('/api/admin/storage').set(auth(staff.token))).status).toBe(403);
    expect((await request(app).post('/api/admin/storage/move').set(auth(staff.token))).status).toBe(403);
  });

  it('starts on local storage and reports the library size', async () => {
    const r = await settings();
    expect(r.body.activeDriver).toBe('local');
    expect(r.body.library.files).toBe(3);
    expect(r.body.s3).toBeNull();
  });

  it('validates input in plain language and requires both key parts', async () => {
    const bad = await request(app).put('/api/admin/storage/s3').set(auth(admin)).send({ bucket: 'Bad Bucket!', region: 'nowhere' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields.bucket).toMatch(/lowercase/);
    const half = await request(app)
      .put('/api/admin/storage/s3')
      .set(auth(admin))
      .send({ bucket: 'acme-docs', region: 'eu-west-2', accessKeyId: 'AKIAIOSFODNN7EXAMPLE' });
    expect(half.status).toBe(400);
  });

  it('saves the bucket and keys, encrypting the secret and never returning it', async () => {
    const r = await request(app)
      .put('/api/admin/storage/s3')
      .set(auth(admin))
      .send({ bucket: 'acme-docs', region: 'eu-west-2', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: SECRET });
    expect(r.status).toBe(200);
    expect(r.body.s3).toMatchObject({ bucket: 'acme-docs', region: 'eu-west-2', usesSavedKeys: true, accessKeyHint: '••••MPLE' });
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    const { rows } = await db().query<{ value: string }>(`SELECT value::text AS value FROM app_settings WHERE key = 'storage'`);
    expect(rows[0].value).not.toContain(SECRET);
  });

  it('explains connection problems in plain language', async () => {
    s3.failAll = Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
    const r = await request(app).post('/api/admin/storage/test').set(auth(admin));
    expect(r.body).toEqual({ ok: false, message: expect.stringMatching(/refused access/) });
    s3.failAll = null;
    expect((await request(app).post('/api/admin/storage/test').set(auth(admin))).body).toEqual({ ok: true });
    expect(s3.objects.size).toBe(0); // the test file is cleaned up
  });

  it('does not switch over while any file failed, then switches once everything is copied', async () => {
    const files = await db().query<{ storage_key: string }>('SELECT storage_key FROM library_file_versions LIMIT 1');
    s3.failKeys.add(files.rows[0].storage_key);
    expect((await request(app).post('/api/admin/storage/move').set(auth(admin))).status).toBe(202);
    await __waitForJob();
    let r = await settings();
    expect(r.body.job.status).toBe('needs_attention');
    expect(r.body.job.problems).toHaveLength(1);
    expect(r.body.activeDriver).toBe('local');

    s3.failKeys.clear();
    await request(app).post('/api/admin/storage/move').set(auth(admin)).expect(202);
    await __waitForJob();
    r = await settings();
    expect(r.body.job).toMatchObject({ status: 'completed', switched: true, done: 3, total: 3 });
    expect(r.body.activeDriver).toBe('s3');
    expect(storage().name).toBe('s3');
    expect(s3.objects.size).toBe(3);
  });

  it('serves and stores documents from S3 after the switch', async () => {
    const up = await uploadFile(app, admin, { name: 'After switch', folderId }, PDF, 'after.pdf');
    expect(up.status).toBe(201);
    expect(s3.objects.size).toBe(4);
    const url = await request(app).get(`/api/library/files/${up.body.id}/url`).set(auth(admin));
    expect(url.body.url).toMatch(/^https:\/\/fake-bucket\.example\//);
  });
});
