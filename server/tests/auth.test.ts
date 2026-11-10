import request from 'supertest';
import type { Express } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { ADMIN, addPerson, auth, login, PASSWORD, setupApp } from './helpers.js';

let app: Express;
let adminToken: string;

beforeAll(async () => {
  app = await setupApp();
  adminToken = (await login(app, ADMIN.email, ADMIN.password)).token;
  await addPerson(app, adminToken, { email: 'emp-auth@test.local' });
  await addPerson(app, adminToken, { email: 'lock-me@test.local' });
});

describe('authentication', () => {
  it('rejects unknown users and wrong passwords with the same message', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'x' });
    const b = await request(app).post('/api/auth/login').send({ email: ADMIN.email, password: 'wrong' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('uses one sign-in page for everyone; the account decides what they can do', async () => {
    const emp = await login(app, 'emp-auth@test.local', PASSWORD);
    expect(emp.user.role).toBe('employee');
    const adm = await login(app, ADMIN.email, ADMIN.password);
    expect(adm.user.role).toBe('admin');
  });

  it('locks the account after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ email: 'lock-me@test.local', password: 'bad' });
    }
    const res = await request(app).post('/api/auth/login').send({ email: 'lock-me@test.local', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
    const { rows } = await db().query<{ locked: boolean }>("SELECT locked_until > now() AS locked FROM users WHERE email = 'lock-me@test.local'");
    expect(rows[0].locked).toBe(true);
  });

  it('requires a bearer token on protected routes', async () => {
    expect((await request(app).get('/api/library/home')).status).toBe(401);
    expect((await request(app).get('/api/library/home').set('Authorization', 'Bearer not-a-jwt')).status).toBe(401);
  });

  it('rotates refresh tokens and revokes the family when an old token is replayed', async () => {
    const { cookie } = await login(app, ADMIN.email, ADMIN.password);
    const first = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest');
    expect(first.status).toBe(200);
    const rotated = first.headers['set-cookie'] as unknown as string[];

    // A second tab refreshing with the same cookie within the grace window gets 409 (retry) — no new session.
    const concurrent = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest');
    expect(concurrent.status).toBe(409);
    expect(concurrent.headers['set-cookie']).toBeUndefined();

    // A replay after the grace window is treated as theft → whole family revoked.
    await db().query(`UPDATE auth_sessions SET rotated_at = now() - interval '1 minute' WHERE rotated_at IS NOT NULL`);
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest');
    expect(replay.status).toBe(401);
    const afterRevoke = await request(app).post('/api/auth/refresh').set('Cookie', rotated).set('X-Requested-With', 'XMLHttpRequest');
    expect(afterRevoke.status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(auth(first.body.accessToken))).status).toBe(401);
  });

  it('refresh requires the X-Requested-With header (CSRF guard)', async () => {
    const { cookie } = await login(app, ADMIN.email, ADMIN.password);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(403);
  });

  it('invites a person who then sets a password and signs in', async () => {
    const create = await request(app).post('/api/people').set(auth(adminToken)).send({ email: 'invitee@test.local', firstName: 'In', lastName: 'Vitee' });
    expect(create.status).toBe(201);
    expect(create.body.person.status).toBe('invited');
    expect(create.body.person.isAdmin).toBe(false);
    const token = new URL(create.body.inviteUrl).searchParams.get('token')!;
    expect((await request(app).get(`/api/auth/invitations/${token}`)).body.email).toBe('invitee@test.local');
    expect((await request(app).post('/api/auth/accept-invite').send({ token, password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/accept-invite').send({ token, password: 'Str0ngPassword' })).status).toBe(200);
    expect((await request(app).post('/api/auth/accept-invite').send({ token, password: 'Str0ngPassword' })).status).toBe(410);
    await login(app, 'invitee@test.local', 'Str0ngPassword');
  });

  it('removing access takes effect immediately; it can be given back', async () => {
    const p = await addPerson(app, adminToken, { email: 'temp@test.local' });
    const { token } = await login(app, 'temp@test.local', PASSWORD);
    expect((await request(app).get('/api/auth/me').set(auth(token))).status).toBe(200);
    await request(app).post(`/api/people/${p.id}/remove`).set(auth(adminToken)).expect(200);
    expect((await request(app).get('/api/auth/me').set(auth(token))).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'temp@test.local', password: PASSWORD })).status).toBe(401);
    await request(app).post(`/api/people/${p.id}/restore`).set(auth(adminToken)).expect(200);
    await login(app, 'temp@test.local', PASSWORD);
  });

  it('keeps at least one administrator and stops admins locking themselves out', async () => {
    const me = (await request(app).get('/api/auth/me').set(auth(adminToken))).body.user.id;
    expect((await request(app).post(`/api/people/${me}/remove`).set(auth(adminToken))).status).toBe(400);
    expect((await request(app).patch(`/api/people/${me}`).set(auth(adminToken)).send({ isAdmin: false })).status).toBe(400);
  });

  it('admins can let someone manage documents', async () => {
    const p = await addPerson(app, adminToken, { email: 'promote@test.local' });
    const r = await request(app).patch(`/api/people/${p.id}`).set(auth(adminToken)).send({ isAdmin: true });
    expect(r.body.isAdmin).toBe(true);
    const { token } = await login(app, 'promote@test.local', PASSWORD);
    expect((await request(app).post('/api/library/folders').set(auth(token)).send({ name: 'Promoted folder' })).status).toBe(201);
  });
});
