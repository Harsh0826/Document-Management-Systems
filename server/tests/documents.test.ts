import request from 'supertest';
import type { Express } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { runExpiryJob } from '../src/services/expiry.js';
import { auth, buildWorld, login, PASSWORD, PDF, PNG, setupApp, uploadAs } from './helpers.js';

let app: Express;
let admin: string;
let empA: string; // employee of client A
let empB: string; // employee of client B
let staffA: string; // staff assigned to A, can review
let staffNoPerms: string; // staff assigned to A, view only
let worldA: Awaited<ReturnType<typeof buildWorld>>;
let worldB: Awaited<ReturnType<typeof buildWorld>>;
let categoryId: string;

beforeAll(async () => {
  app = await setupApp();
  admin = (await login(app, 'admin@test.local', 'Admin@12345', 'admin')).token;
  worldA = await buildWorld(app, admin, { code: 'AAA', staffPerms: ['documents.download', 'documents.review', 'documents.comment', 'documents.upload'] });
  worldB = await buildWorld(app, admin, { code: 'BBB' });
  await request(app)
    .post('/api/users')
    .set(auth(admin))
    .send({ email: 'viewer@test.local', firstName: 'View', lastName: 'Only', role: 'staff', password: PASSWORD, permissions: [], clientIds: [worldA.client.id] })
    .expect(201);
  empA = (await login(app, 'emp-aaa@test.local', PASSWORD, 'employee')).token;
  empB = (await login(app, 'emp-bbb@test.local', PASSWORD, 'employee')).token;
  staffA = (await login(app, 'staff-aaa@test.local', PASSWORD, 'admin')).token;
  staffNoPerms = (await login(app, 'viewer@test.local', PASSWORD, 'admin')).token;
  const cats = await request(app).get('/api/categories').set(auth(admin));
  categoryId = cats.body.find((c: { slug: string }) => c.slug === 'training').id;
});

describe('upload validation', () => {
  it('accepts a valid PDF and files it in the category folder', async () => {
    const res = await uploadAs(app, empA, { title: 'First Aid', categoryId, expiryDate: '2099-01-01' }, PDF, 'first-aid-cert.pdf');
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_review');
    expect(res.body.folderName).toBe('Training Certificates');
    expect(res.body.file.filename).toBe('first-aid-cert.pdf');
  });

  it('rejects disallowed extensions', async () => {
    const res = await uploadAs(app, empA, { title: 'Script' }, Buffer.from('MZ'), 'evil.exe');
    expect(res.status).toBe(415);
  });

  it('rejects files whose content does not match the extension', async () => {
    const res = await uploadAs(app, empA, { title: 'Fake' }, Buffer.from('<html><script>alert(1)</script></html>'), 'fake.pdf');
    expect(res.status).toBe(415);
  });

  it('requires an expiry date for categories that need one', async () => {
    const res = await uploadAs(app, empA, { title: 'No expiry', categoryId });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.expiryDate).toBeTruthy();
  });

  it('staff without upload permission cannot upload on behalf of employees', async () => {
    const res = await uploadAs(app, staffNoPerms, { title: 'X', employeeId: worldA.employee.employee.id });
    expect(res.status).toBe(403);
  });
});

describe('data isolation', () => {
  let docA: string;
  beforeAll(async () => {
    docA = (await uploadAs(app, empA, { title: 'Passport Scan' }, PNG, 'passport.png')).body.id;
  });

  it('an employee cannot see another employee’s document (404, not 403)', async () => {
    expect((await request(app).get(`/api/documents/${docA}`).set(auth(empB))).status).toBe(404);
    expect((await request(app).get(`/api/documents/${docA}/url`).set(auth(empB))).status).toBe(404);
    const list = await request(app).get('/api/documents').set(auth(empB));
    expect(list.body.items.map((d: { id: string }) => d.id)).not.toContain(docA);
  });

  it('staff only see documents of assigned clients', async () => {
    const staffB = (await login(app, 'staff-bbb@test.local', PASSWORD, 'admin')).token;
    expect((await request(app).get(`/api/documents/${docA}`).set(auth(staffB))).status).toBe(404);
    expect((await request(app).get(`/api/documents/${docA}`).set(auth(staffA))).status).toBe(200);
  });

  it('view-only staff cannot download, review or delete', async () => {
    expect((await request(app).get(`/api/documents/${docA}`).set(auth(staffNoPerms))).status).toBe(200);
    expect((await request(app).get(`/api/documents/${docA}/url`).set(auth(staffNoPerms))).status).toBe(403);
    expect((await request(app).post(`/api/documents/${docA}/review`).set(auth(staffNoPerms)).send({ decision: 'approved' })).status).toBe(403);
    expect((await request(app).delete(`/api/documents/${docA}`).set(auth(staffNoPerms))).status).toBe(403);
  });

  it('employees cannot review their own documents', async () => {
    expect((await request(app).post(`/api/documents/${docA}/review`).set(auth(empA)).send({ decision: 'approved' })).status).toBe(403);
  });

  it('documents cannot be moved into another client’s folders', async () => {
    const folders = await request(app).get('/api/folders').set(auth(admin)).query({ clientId: worldB.client.id });
    const res = await request(app).post('/api/documents/move').set(auth(admin)).send({ documentIds: [docA], folderId: folders.body[0].id });
    expect(res.status).toBe(400);
  });
});

describe('review workflow, notifications and signed URLs', () => {
  it('approves, notifies the employee, and serves the file through an expiring signed URL', async () => {
    const up = await uploadAs(app, empA, { title: 'Forklift Licence', categoryId, expiryDate: '2099-06-30' }, PDF, 'forklift.pdf');
    const id = up.body.id;

    // Staff reviewer was notified of the upload.
    const staffNotes = await request(app).get('/api/notifications').set(auth(staffA));
    expect(staffNotes.body.items.some((n: { entityId: string }) => n.entityId === id)).toBe(true);

    const reject = await request(app).post(`/api/documents/${id}/review`).set(auth(staffA)).send({ decision: 'rejected' });
    expect(reject.status).toBe(400); // comment required

    const ok = await request(app).post(`/api/documents/${id}/review`).set(auth(staffA)).send({ decision: 'approved', comment: 'Looks good' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('approved');

    const empNotes = await request(app).get('/api/notifications').set(auth(empA));
    expect(empNotes.body.items.some((n: { type: string; entityId: string }) => n.type === 'document_approved' && n.entityId === id)).toBe(true);

    // Approved documents cannot be replaced by the employee...
    const replace = await request(app).post(`/api/documents/${id}/versions`).set(auth(empA)).attach('file', PDF, 'forklift-v2.pdf');
    expect(replace.status).toBe(403);

    const url = await request(app).get(`/api/documents/${id}/url`).query({ disposition: 'inline' }).set(auth(empA));
    expect(url.status).toBe(200);
    expect(url.body.url).toMatch(/^\/api\/files\//);
    const file = await request(app).get(url.body.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toMatch(/^inline/);

    // Tampered token is refused.
    const tampered = url.body.url.replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A'));
    expect((await request(app).get(tampered)).status).toBe(403);

    // Access is audited.
    const audit = await request(app).get('/api/audit-logs').query({ entityId: id }).set(auth(admin));
    const actions = audit.body.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['document.uploaded', 'document.reviewed', 'document.previewed']));
  });

  it('rejected documents can be replaced; history keeps all versions', async () => {
    const up = await uploadAs(app, empA, { title: 'Degree' }, PDF, 'degree.pdf');
    await request(app).post(`/api/documents/${up.body.id}/review`).set(auth(staffA)).send({ decision: 'rejected', comment: 'Blurry scan' }).expect(200);
    const v2 = await request(app)
      .post(`/api/documents/${up.body.id}/versions`)
      .set(auth(empA))
      .field('changeNote', 'Clearer scan')
      .attach('file', PDF, 'degree-clear.pdf');
    expect(v2.status).toBe(201);
    expect(v2.body.status).toBe('pending_review');
    const detail = await request(app).get(`/api/documents/${up.body.id}`).set(auth(empA));
    expect(detail.body.versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
    expect(detail.body.approvals[0].decision).toBe('rejected');
  });

  it('internal comments are hidden from employees', async () => {
    const up = await uploadAs(app, empA, { title: 'Commented' });
    await request(app).post(`/api/documents/${up.body.id}/comments`).set(auth(staffA)).send({ body: 'internal note', isInternal: true }).expect(201);
    await request(app).post(`/api/documents/${up.body.id}/comments`).set(auth(staffA)).send({ body: 'visible note' }).expect(201);
    const forEmp = await request(app).get(`/api/documents/${up.body.id}`).set(auth(empA));
    expect(forEmp.body.comments.map((c: { body: string }) => c.body)).toEqual(['visible note']);
    expect((await request(app).post(`/api/documents/${up.body.id}/comments`).set(auth(empA)).send({ body: 'x', isInternal: true })).status).toBe(403);
  });
});

describe('search and filters', () => {
  it('finds documents by partial filename, title and employee name', async () => {
    await uploadAs(app, empA, { title: 'Scaffolding Safety' }, PDF, 'SCAFF-2024-cert.pdf');
    const byFile = await request(app).get('/api/documents').query({ q: 'scaff-20' }).set(auth(admin));
    expect(byFile.body.items.some((d: { title: string }) => d.title === 'Scaffolding Safety')).toBe(true);
    const byEmployee = await request(app).get('/api/documents').query({ q: 'Emp AAA' }).set(auth(admin));
    expect(byEmployee.body.total).toBeGreaterThan(0);
    const wildcard = await request(app).get('/api/documents').query({ q: '%' }).set(auth(admin));
    expect(wildcard.body.total).toBe(0); // LIKE wildcards are escaped
  });

  it('combines filters', async () => {
    const res = await request(app).get('/api/documents').query({ fileType: 'png', status: 'pending_review', clientId: worldA.client.id }).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.items.every((d: { file: { ext: string } }) => d.file.ext === 'png')).toBe(true);
  });
});

describe('folders', () => {
  it('refuses to delete non-empty folders unless contents are moved up', async () => {
    const folders = await request(app).get('/api/folders').set(auth(admin)).query({ clientId: worldA.client.id });
    const empRoot = folders.body.find((f: { kind: string; employeeId: string }) => f.kind === 'employee_root' && f.employeeId === worldA.employee.employee.id);
    const created = await request(app).post('/api/folders').set(auth(admin)).send({ name: 'Archive 2023', parentId: empRoot.id });
    expect(created.status).toBe(201);
    const up = await uploadAs(app, admin, { title: 'Old contract', employeeId: worldA.employee.employee.id, folderId: created.body.id });
    expect(up.status).toBe(201);

    expect((await request(app).delete(`/api/folders/${created.body.id}`).set(auth(admin))).status).toBe(409);
    const del = await request(app).delete(`/api/folders/${created.body.id}`).query({ moveContentsToParent: 'true' }).set(auth(admin));
    expect(del.status).toBe(200);
    const doc = await request(app).get(`/api/documents/${up.body.id}`).set(auth(admin));
    expect(doc.body.folderId).toBe(empRoot.id);
    expect((await request(app).delete(`/api/folders/${empRoot.id}`).set(auth(admin))).status).toBe(400);
  });

  it('employees cannot create folders', async () => {
    const folders = await request(app).get('/api/folders').set(auth(empA));
    expect(folders.body.every((f: { employeeId: string }) => f.employeeId === worldA.employee.employee.id)).toBe(true);
    expect((await request(app).post('/api/folders').set(auth(empA)).send({ name: 'Mine', parentId: folders.body[0].id })).status).toBe(403);
  });
});

describe('expiry tracking', () => {
  it('marks expired certificates and flags renewals', async () => {
    const soon = await uploadAs(app, empA, { title: 'Expiring Soon', categoryId, expiryDate: '2099-01-01' });
    const past = await uploadAs(app, empA, { title: 'Already Expired', categoryId, expiryDate: '2099-01-01' });
    await request(app).post(`/api/documents/${soon.body.id}/review`).set(auth(admin)).send({ decision: 'approved' }).expect(200);
    await request(app).post(`/api/documents/${past.body.id}/review`).set(auth(admin)).send({ decision: 'approved' }).expect(200);
    // Move the dates relative to "today" directly in the database.
    await db().query(`UPDATE documents SET expiry_date = CURRENT_DATE + 10 WHERE id = $1`, [soon.body.id]);
    await db().query(`UPDATE documents SET expiry_date = CURRENT_DATE - 1, issue_date = NULL WHERE id = $1`, [past.body.id]);

    const r = await runExpiryJob();
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect(r.renewal).toBeGreaterThanOrEqual(1);

    const a = await request(app).get(`/api/documents/${soon.body.id}`).set(auth(empA));
    const b = await request(app).get(`/api/documents/${past.body.id}`).set(auth(empA));
    expect(a.body.status).toBe('renewal_required');
    expect(b.body.status).toBe('expired');

    // Reminders are sent once.
    const again = await runExpiryJob();
    expect(again.reminders).toBe(0);
    const notes = await request(app).get('/api/notifications').set(auth(empA));
    expect(notes.body.items.filter((n: { type: string; entityId: string }) => n.type === 'certificate_expired' && n.entityId === past.body.id)).toHaveLength(1);

    const dash = await request(app).get('/api/dashboard').set(auth(empA));
    expect(dash.body.totals.expired).toBeGreaterThanOrEqual(1);
  });
});
