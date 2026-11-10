import request from 'supertest';
import type { Express } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { purgeDeletedFiles } from '../src/services/maintenance.js';
import { ADMIN, addPerson, auth, createFolder, login, PDF, PNG, setupApp, uploadFile } from './helpers.js';

let app: Express;
let admin: string;
let employee: string;
let licences: { id: string };
let y2025: { id: string };
let hr: { id: string };

beforeAll(async () => {
  app = await setupApp();
  admin = (await login(app, ADMIN.email, ADMIN.password)).token;
  await addPerson(app, admin, { email: 'emp@test.local' });
  employee = (await login(app, 'emp@test.local', 'Passw0rd!Test')).token;
  licences = await createFolder(app, admin, 'Licences');
  y2025 = await createFolder(app, admin, '2025', licences.id);
  hr = await createFolder(app, admin, 'HR Policies');
});

describe('folders', () => {
  it('allows at most three levels', async () => {
    const q1 = await createFolder(app, admin, 'Q1', y2025.id);
    expect(q1.depth).toBe(3);
    const tooDeep = await request(app).post('/api/library/folders').set(auth(admin)).send({ name: 'Jan', parentId: q1.id });
    expect(tooDeep.status).toBe(400);
    expect(tooDeep.body.error.message).toMatch(/3 levels/);
  });

  it('refuses duplicate folder names in the same place', async () => {
    const dup = await request(app).post('/api/library/folders').set(auth(admin)).send({ name: 'licences' });
    expect(dup.status).toBe(409);
  });

  it('only deletes empty folders, with a plain explanation otherwise', async () => {
    const r = await request(app).delete(`/api/library/folders/${licences.id}`).set(auth(admin));
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/still has 1 folder/);
    const empty = await createFolder(app, admin, 'Temporary');
    expect((await request(app).delete(`/api/library/folders/${empty.id}`).set(auth(admin))).status).toBe(204);
  });
});

describe('adding and finding files', () => {
  let fileId: string;

  it('adds a file, naming it from the file name when no name is given', async () => {
    const r = await uploadFile(app, admin, { folderId: y2025.id, validUntil: '2099-03-02' }, PDF, 'fire_safety-licence 2025.pdf');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Fire safety licence 2025', type: 'PDF', validUntil: '2099-03-02', previewable: true, isNew: true });
    expect(r.body.folderPath.map((p: { name: string }) => p.name)).toEqual(['Licences', '2025']);
    fileId = r.body.id;
  });

  it('rejects duplicate names, wrong types and disguised files', async () => {
    const dup = await uploadFile(app, admin, { folderId: y2025.id, name: 'FIRE SAFETY LICENCE 2025' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/already a file called/);
    expect((await uploadFile(app, admin, { folderId: hr.id }, Buffer.from('MZ'), 'tool.exe')).status).toBe(415);
    expect((await uploadFile(app, admin, { folderId: hr.id }, Buffer.from('<script>'), 'fake.pdf')).status).toBe(415);
  });

  it('shows folders with counts (including sub-folders) and recently added files on Home', async () => {
    await uploadFile(app, admin, { folderId: hr.id, name: 'Holiday Policy' }, PNG, 'holiday.png');
    const home = await request(app).get('/api/library/home').set(auth(employee));
    expect(home.status).toBe(200);
    const lic = home.body.folders.find((f: { name: string }) => f.name === 'Licences');
    expect(lic.fileCount).toBe(1);
    expect(home.body.recent[0].name).toBe('Holiday Policy');
  });

  it('lists a folder with breadcrumb, sub-folders and files; sorts by name', async () => {
    const r = await request(app).get(`/api/library/folders/${licences.id}`).set(auth(employee));
    expect(r.body.path.map((p: { name: string }) => p.name)).toEqual(['Licences']);
    expect(r.body.subfolders.map((f: { name: string }) => f.name)).toEqual(['2025']);
    const inner = await request(app).get(`/api/library/folders/${y2025.id}`).set(auth(employee));
    expect(inner.body.path.map((p: { name: string }) => p.name)).toEqual(['Licences', '2025']);
    expect(inner.body).toMatchObject({ ownFileCount: 1, pinned: false, parents: [{ name: 'Licences' }] });
    const files = await request(app).get('/api/library/files').query({ folder: y2025.id, sort: 'name' }).set(auth(employee));
    expect(files.body).toMatchObject({ total: 1, nextOffset: null });
    expect(files.body.files[0].id).toBe(fileId);
    // "Licences" holds nothing itself, but everything below it with deep=1.
    const deep = await request(app).get('/api/library/files').query({ folder: licences.id, deep: 1 }).set(auth(employee));
    expect(deep.body.total).toBe(1);
    expect((await request(app).get('/api/library/files').query({ folder: licences.id }).set(auth(employee))).body.total).toBe(0);
  });

  it('search matches partial words, folder names and spelling variants', async () => {
    const byPart = await request(app).get('/api/library/search').query({ q: 'safe' }).set(auth(employee));
    expect(byPart.body.files.map((f: { id: string }) => f.id)).toContain(fileId);
    const variant = await request(app).get('/api/library/search').query({ q: 'license' }).set(auth(employee));
    expect(variant.body.files.map((f: { id: string }) => f.id)).toContain(fileId);
    expect(variant.body.folders.map((f: { name: string }) => f.name)).toContain('Licences');
    const policies = await request(app).get('/api/library/search').query({ q: 'policies' }).set(auth(employee));
    expect(policies.body.files.map((f: { name: string }) => f.name)).toContain('Holiday Policy');
    const wildcard = await request(app).get('/api/library/search').query({ q: '%' }).set(auth(employee));
    expect(wildcard.body.files).toHaveLength(0);
  });

  it('gives everyone short-lived view and download links named after the document', async () => {
    const view = await request(app).get(`/api/library/files/${fileId}/url`).query({ disposition: 'inline' }).set(auth(employee));
    expect(view.body.inline).toBe(true);
    const file = await request(app).get(view.body.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    const dl = await request(app).get(`/api/library/files/${fileId}/url`).set(auth(employee));
    const got = await request(app).get(dl.body.url);
    expect(got.headers['content-disposition']).toMatch(/^attachment; filename="Fire safety licence 2025\.pdf"/);
    const logged = await db().query<{ n: number }>(
      `SELECT count(*) AS n FROM audit_logs WHERE entity_id = $1 AND action IN ('file.viewed', 'file.downloaded')`,
      [fileId],
    );
    expect(logged.rows[0].n).toBe(2);
  });
});

describe('employees can only view and download', () => {
  it('refuses every change', async () => {
    const someFile = (await request(app).get('/api/library/home').set(auth(employee))).body.recent[0].id;
    const statuses = (
      await Promise.all([
        uploadFile(app, employee, { folderId: hr.id }),
        request(app).post('/api/library/folders').set(auth(employee)).send({ name: 'Mine' }),
        request(app).patch(`/api/library/folders/${hr.id}`).set(auth(employee)).send({ name: 'X' }),
        request(app).delete(`/api/library/folders/${hr.id}`).set(auth(employee)),
        request(app).patch(`/api/library/files/${someFile}`).set(auth(employee)).send({ name: 'Renamed' }),
        request(app).post(`/api/library/files/${someFile}/replace`).set(auth(employee)).attach('file', PDF, 'x.pdf'),
        request(app).delete(`/api/library/files/${someFile}`).set(auth(employee)),
        request(app).get('/api/library/deleted').set(auth(employee)),
        request(app).get('/api/people').set(auth(employee)),
        request(app).get('/api/audit-logs').set(auth(employee)),
      ])
    ).map((r) => r.status);
    expect(statuses).toEqual(Array(10).fill(403));
  });

  it('requires signing in', async () => {
    expect((await request(app).get('/api/library/home')).status).toBe(401);
  });
});

describe('managing files (admin)', () => {
  it('renames, moves, replaces (keeping the old copy) and blocks name clashes', async () => {
    const up = await uploadFile(app, admin, { folderId: hr.id, name: 'Expenses Policy' });
    const id = up.body.id;
    const renamed = await request(app).patch(`/api/library/files/${id}`).set(auth(admin)).send({ name: 'Expenses & Travel Policy' });
    expect(renamed.body.name).toBe('Expenses & Travel Policy');
    const moved = await request(app).patch(`/api/library/files/${id}`).set(auth(admin)).send({ folderId: licences.id });
    expect(moved.body.folderPath.map((p: { name: string }) => p.name)).toEqual(['Licences']);
    const replaced = await request(app).post(`/api/library/files/${id}/replace`).set(auth(admin)).attach('file', PNG, 'new.png');
    expect(replaced.body.type).toBe('Picture');
    const versions = await db().query<{ n: number }>('SELECT count(*) AS n FROM library_file_versions WHERE file_id = $1', [id]);
    expect(versions.rows[0].n).toBe(2);
    await uploadFile(app, admin, { folderId: licences.id, name: 'Clash' });
    expect((await request(app).patch(`/api/library/files/${id}`).set(auth(admin)).send({ name: 'clash' })).status).toBe(409);
  });

  it('moves and deletes many files at once, skipping name clashes', async () => {
    const box = await createFolder(app, admin, 'Bulk Box');
    const dest = await createFolder(app, admin, 'Bulk Dest');
    const ids: string[] = [];
    for (const n of ['A1', 'A2', 'A3']) ids.push((await uploadFile(app, admin, { folderId: box.id, name: n })).body.id);
    await uploadFile(app, admin, { folderId: dest.id, name: 'a2' });
    const moved = await request(app).post('/api/library/files/bulk').set(auth(admin)).send({ action: 'move', ids, folderId: dest.id });
    expect(moved.body).toMatchObject({ done: 2, notFound: 0 });
    expect(moved.body.skipped.map((s: { name: string }) => s.name)).toEqual(['A2']);
    const counts = await request(app).get(`/api/library/folders/${dest.id}`).set(auth(admin));
    expect(counts.body.fileCount).toBe(3);
    const del = await request(app).post('/api/library/files/bulk').set(auth(admin)).send({ action: 'delete', ids });
    expect(del.body.done).toBe(3);
    expect((await request(app).get(`/api/library/folders/${dest.id}`).set(auth(admin))).body.fileCount).toBe(1);
    expect((await request(app).post('/api/library/files/bulk').set(auth(employee)).send({ action: 'delete', ids })).status).toBe(403);
  });

  it('deleted files disappear, can be restored within 30 days, then are removed for good', async () => {
    const up = await uploadFile(app, admin, { folderId: hr.id, name: 'Old Form' });
    const id = up.body.id;
    await request(app).delete(`/api/library/files/${id}`).set(auth(admin)).expect(204);
    expect((await request(app).get(`/api/library/files/${id}`).set(auth(employee))).status).toBe(404);
    const bin = await request(app).get('/api/library/deleted').set(auth(admin));
    expect(bin.body.map((f: { id: string }) => f.id)).toContain(id);
    await request(app).post(`/api/library/files/${id}/restore`).set(auth(admin)).expect(200);
    expect((await request(app).get(`/api/library/files/${id}`).set(auth(employee))).status).toBe(200);

    await request(app).delete(`/api/library/files/${id}`).set(auth(admin)).expect(204);
    await db().query(`UPDATE library_files SET deleted_at = now() - interval '31 days' WHERE id = $1`, [id]);
    expect(await purgeDeletedFiles()).toBe(1);
    expect((await request(app).post(`/api/library/files/${id}/restore`).set(auth(admin))).status).toBe(404);
  });
});

describe('large libraries', () => {
  it('keeps file counts right through uploads, moves, deletes, restores and folder moves', async () => {
    const a = await createFolder(app, admin, 'Count A');
    const a1 = await createFolder(app, admin, 'A1', a.id);
    const b = await createFolder(app, admin, 'Count B');
    const f1 = (await uploadFile(app, admin, { folderId: a1.id, name: 'One' })).body.id;
    await uploadFile(app, admin, { folderId: a1.id, name: 'Two' });
    const count = async (id: string) => (await request(app).get(`/api/library/folders/${id}`).set(auth(admin))).body.fileCount;
    expect([await count(a.id), await count(a1.id), await count(b.id)]).toEqual([2, 2, 0]);

    await request(app).patch(`/api/library/files/${f1}`).set(auth(admin)).send({ folderId: b.id }).expect(200);
    expect([await count(a.id), await count(b.id)]).toEqual([1, 1]);
    await request(app).delete(`/api/library/files/${f1}`).set(auth(admin)).expect(204);
    expect(await count(b.id)).toBe(0);
    await request(app).post(`/api/library/files/${f1}/restore`).set(auth(admin)).expect(200);
    expect(await count(b.id)).toBe(1);

    // Move A1 (with its file) under B: A loses it, B gains it, and A1 is now at level 2 under B.
    const moved = await request(app).patch(`/api/library/folders/${a1.id}`).set(auth(admin)).send({ parentId: b.id });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ depth: 2, parentId: b.id, parents: [{ name: 'Count B' }] });
    expect([await count(a.id), await count(b.id)]).toEqual([0, 2]);
    // The moved file is found by its new folder's name.
    const found = await request(app).get('/api/library/files').query({ q: 'count b two' }).set(auth(employee));
    expect(found.body.files.map((f: { name: string }) => f.name)).toEqual(['Two']);

    // Back to the top level, then refuse moves into itself or too deep.
    await request(app).patch(`/api/library/folders/${a1.id}`).set(auth(admin)).send({ parentId: null }).expect(200);
    expect(await count(b.id)).toBe(1);
    const deep = await createFolder(app, admin, 'Deep', a1.id);
    await createFolder(app, admin, 'Deeper', deep.id);
    expect((await request(app).patch(`/api/library/folders/${a1.id}`).set(auth(admin)).send({ parentId: deep.id })).status).toBe(400);
    const tooDeep = await request(app).patch(`/api/library/folders/${a1.id}`).set(auth(admin)).send({ parentId: b.id });
    expect(tooDeep.status).toBe(400);
    expect(tooDeep.body.error.message).toMatch(/3 levels/);
  });

  it('pages through documents with filters and sorting', async () => {
    const big = await createFolder(app, admin, 'Paging');
    for (let i = 1; i <= 7; i++) await uploadFile(app, admin, { folderId: big.id, name: `Doc ${i}`, ...(i <= 2 ? { validUntil: '2000-01-01' } : {}) });
    const page1 = await request(app).get('/api/library/files').query({ folder: big.id, sort: 'name', limit: 3 }).set(auth(employee));
    expect(page1.body).toMatchObject({ total: 7, nextOffset: 3 });
    expect(page1.body.files.map((f: { name: string }) => f.name)).toEqual(['Doc 1', 'Doc 2', 'Doc 3']);
    const page3 = await request(app).get('/api/library/files').query({ folder: big.id, sort: 'name', limit: 3, offset: 6 }).set(auth(employee));
    expect(page3.body).toMatchObject({ nextOffset: null, files: [{ name: 'Doc 7' }] });
    expect(page3.body.total).toBeUndefined();
    const expired = await request(app).get('/api/library/files').query({ folder: big.id, validity: 'expired' }).set(auth(employee));
    expect(expired.body.total).toBe(2);
    const pictures = await request(app).get('/api/library/files').query({ folder: big.id, type: 'picture' }).set(auth(employee));
    expect(pictures.body.total).toBe(0);
    const desc = await request(app).get('/api/library/files').query({ folder: big.id, sort: 'name_desc', limit: 1 }).set(auth(employee));
    expect(desc.body.files[0].name).toBe('Doc 7');
    expect((await request(app).get('/api/library/files').query({ sort: 'sideways' }).set(auth(employee))).status).toBe(400);
  });

  it('finds folders by name and lists one level at a time', async () => {
    const top = await request(app).get('/api/library/folders').set(auth(employee));
    expect(top.body.folders.every((f: { depth: number }) => f.depth === 1)).toBe(true);
    const kids = await request(app).get('/api/library/folders').query({ parent: licences.id }).set(auth(employee));
    expect(kids.body.folders.map((f: { name: string }) => f.name)).toEqual(['2025']);
    const found = await request(app).get('/api/library/folders').query({ q: '2025' }).set(auth(employee));
    expect(found.body.folders[0]).toMatchObject({ name: '2025', parents: [{ name: 'Licences' }] });
  });

  it('lets everyone pin folders to their own Home', async () => {
    await request(app).put(`/api/library/folders/${hr.id}/pin`).set(auth(employee)).expect(204);
    await request(app).put(`/api/library/folders/${hr.id}/pin`).set(auth(employee)).expect(204);
    const home = await request(app).get('/api/library/home').set(auth(employee));
    expect(home.body.pinned.map((f: { name: string }) => f.name)).toEqual(['HR Policies']);
    expect((await request(app).get('/api/library/pins').set(auth(employee))).body.folders.map((f: { name: string }) => f.name)).toEqual(['HR Policies']);
    expect((await request(app).get('/api/library/pins').set(auth(admin))).body.folders).toEqual([]);
    expect(home.body.attention).toBeUndefined();
    expect((await request(app).get('/api/library/home').set(auth(admin))).body.pinned).toEqual([]);
    expect((await request(app).get(`/api/library/folders/${hr.id}`).set(auth(employee))).body.pinned).toBe(true);
    await request(app).delete(`/api/library/folders/${hr.id}/pin`).set(auth(employee)).expect(204);
    expect((await request(app).get('/api/library/home').set(auth(employee))).body.pinned).toEqual([]);
  });

  it('shows administrators what needs attention and everyone what they opened recently', async () => {
    const home = await request(app).get('/api/library/home').set(auth(admin));
    expect(home.body.attention.expired).toBeGreaterThanOrEqual(2);
    const counts = await request(app).get('/api/library/expiry').set(auth(employee));
    expect(counts.body).toEqual(home.body.attention);
    expect(home.body.totals.folders).toBeGreaterThan(3);
    const any = (await request(app).get('/api/library/files').set(auth(employee))).body.files[0];
    await request(app).get(`/api/library/files/${any.id}/url`).query({ disposition: 'inline' }).set(auth(employee)).expect(200);
    const mine = await request(app).get('/api/library/home').set(auth(employee));
    expect(mine.body.opened[0].id).toBe(any.id);
  });
});
