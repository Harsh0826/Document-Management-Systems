import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

export const PASSWORD = 'Passw0rd!Test';

export async function setupApp(): Promise<Express> {
  const db = await initDb({ memory: true });
  await migrate(db);
  await seed(db);
  return createApp();
}

export async function login(app: Express, email: string, password: string, portal: 'admin' | 'employee') {
  const res = await request(app).post('/api/auth/login').send({ email, password, portal });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, user: res.body.user, cookie: res.headers['set-cookie'] as unknown as string[] };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Minimal valid files (magic bytes are what the server checks).
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

/** Creates a client, an employee (active, with password), and a staff user with the given permissions. */
export async function buildWorld(app: Express, adminToken: string, opts: { code: string; staffPerms?: string[] }) {
  const client = await request(app).post('/api/clients').set(auth(adminToken)).send({ name: `Client ${opts.code}`, code: opts.code });
  if (client.status !== 201) throw new Error(JSON.stringify(client.body));
  const emp = await request(app)
    .post('/api/users')
    .set(auth(adminToken))
    .send({ email: `emp-${opts.code.toLowerCase()}@test.local`, firstName: 'Emp', lastName: opts.code, role: 'employee', clientId: client.body.id, password: PASSWORD });
  if (emp.status !== 201) throw new Error(JSON.stringify(emp.body));
  const staff = await request(app)
    .post('/api/users')
    .set(auth(adminToken))
    .send({
      email: `staff-${opts.code.toLowerCase()}@test.local`,
      firstName: 'Staff',
      lastName: opts.code,
      role: 'staff',
      password: PASSWORD,
      permissions: opts.staffPerms ?? ['documents.download', 'documents.review', 'documents.comment'],
      clientIds: [client.body.id],
    });
  if (staff.status !== 201) throw new Error(JSON.stringify(staff.body));
  return { client: client.body, employee: emp.body.user, staff: staff.body.user };
}

export async function uploadAs(app: Express, token: string, fields: Record<string, string>, file = PDF, filename = 'certificate.pdf') {
  const req = request(app).post('/api/documents').set(auth(token));
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  return req.attach('file', file, filename);
}
