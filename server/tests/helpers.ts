import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

export const PASSWORD = 'Passw0rd!Test';
export const ADMIN = { email: 'admin@test.local', password: 'Admin@12345' };

export async function setupApp(): Promise<Express> {
  const db = await initDb({ memory: true });
  await migrate(db);
  await seed(db);
  return createApp();
}

export async function login(app: Express, email: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200 || !res.body.accessToken) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, user: res.body.user, cookie: res.headers['set-cookie'] as unknown as string[] };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Adds a person through the People API and accepts their invitation so they can sign in. */
export async function addPerson(app: Express, adminToken: string, p: { email: string; isAdmin?: boolean; firstName?: string; password?: string }) {
  const res = await request(app)
    .post('/api/people')
    .set(auth(adminToken))
    .send({ firstName: p.firstName ?? 'Test', lastName: 'Person', email: p.email, isAdmin: !!p.isAdmin });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  const token = new URL(res.body.inviteUrl).searchParams.get('token')!;
  const accept = await request(app)
    .post('/api/auth/accept-invite')
    .send({ token, password: p.password ?? PASSWORD });
  if (accept.status !== 200) throw new Error(JSON.stringify(accept.body));
  return res.body.person as { id: string; email: string; isAdmin: boolean };
}

export async function createFolder(app: Express, token: string, name: string, parentId?: string) {
  const res = await request(app).post('/api/library/folders').set(auth(token)).send({ name, parentId });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string; name: string; depth: number };
}

// Minimal valid files (magic bytes are what the server checks).
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

export function uploadFile(app: Express, token: string, fields: Record<string, string>, file = PDF, filename = 'document.pdf') {
  const req = request(app).post('/api/library/files').set(auth(token));
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  return req.attach('file', file, filename);
}
