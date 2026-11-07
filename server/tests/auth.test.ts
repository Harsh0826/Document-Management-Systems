import request from 'supertest';
import type { Express } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { auth, buildWorld, login, PASSWORD, setupApp } from './helpers.js';

let app: Express;
let adminToken: string;

beforeAll(async () => {
  app = await setupApp();
  adminToken = (await login(app, 'admin@test.local', 'Admin@12345', 'admin')).token;
  await buildWorld(app, adminToken, { code: 'AUTH' });
});

describe('authentication', () => {
  it('rejects unknown users and wrong passwords with the same message', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'x', portal: 'admin' });
    const b = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'wrong', portal: 'admin' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('enforces the portal for each role', async () => {
    const emp = await request(app).post('/api/auth/login').send({ email: 'emp-auth@test.local', password: PASSWORD, portal: 'admin' });
    expect(emp.status).toBe(403);
    expect(emp.body.error.code).toBe('wrong_portal');
    const adm = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'Admin@12345', portal: 'employee' });
    expect(adm.status).toBe(403);
  });

  it('locks the account after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ email: 'staff-auth@test.local', password: 'bad', portal: 'admin' });
    }
    const res = await request(app).post('/api/auth/login').send({ email: 'staff-auth@test.local', password: PASSWORD, portal: 'admin' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/Too many failed attempts/);
  });

  it('requires a bearer token on protected routes', async () => {
    expect((await request(app).get('/api/documents')).status).toBe(401);
    expect((await request(app).get('/api/documents').set('Authorization', 'Bearer not-a-jwt')).status).toBe(401);
  });

  it('rotates refresh tokens and revokes the family when an old token is replayed', async () => {
    const { cookie } = await login(app, 'admin@test.local', 'Admin@12345', 'admin');
    const first = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest');
    expect(first.status).toBe(200);
    const rotated = first.headers['set-cookie'] as unknown as string[];

    // A second tab refreshing with the same cookie within the grace window is tolerated...
    const concurrent = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest');
    expect(concurrent.status).toBe(200);

    // ...but a replay after the grace window is treated as theft → whole family revoked.
    await db().query(`UPDATE auth_sessions SET rotated_at = now() - interval '1 minute' WHERE rotated_at IS NOT NULL`);
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest');
    expect(replay.status).toBe(401);
    const afterRevoke = await request(app).post('/api/auth/refresh').set('Cookie', rotated).set('X-Requested-With', 'XMLHttpRequest');
    expect(afterRevoke.status).toBe(401);
    // Access tokens from the revoked family stop working too.
    expect((await request(app).get('/api/auth/me').set(auth(first.body.accessToken))).status).toBe(401);
  });

  it('refresh requires the X-Requested-With header (CSRF guard)', async () => {
    const { cookie } = await login(app, 'admin@test.local', 'Admin@12345', 'admin');
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(403);
  });

  it('invites a user who then sets a password and signs in', async () => {
    const create = await request(app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email: 'invitee@test.local', firstName: 'In', lastName: 'Vitee', role: 'staff' });
    expect(create.status).toBe(201);
    expect(create.body.user.status).toBe('invited');
    const token = new URL(create.body.inviteUrl).searchParams.get('token')!;

    expect((await request(app).get(`/api/auth/invitations/${token}`)).body.email).toBe('invitee@test.local');
    const weak = await request(app).post('/api/auth/accept-invite').send({ token, password: 'short' });
    expect(weak.status).toBe(400);
    const ok = await request(app).post('/api/auth/accept-invite').send({ token, password: 'Str0ngPassword' });
    expect(ok.status).toBe(200);
    // Single use
    expect((await request(app).post('/api/auth/accept-invite').send({ token, password: 'Str0ngPassword' })).status).toBe(410);
    await login(app, 'invitee@test.local', 'Str0ngPassword', 'admin');
  });

  it('deactivation takes effect immediately', async () => {
    const create = await request(app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({ email: 'temp@test.local', firstName: 'Te', lastName: 'Mp', role: 'staff', password: PASSWORD });
    const { token } = await login(app, 'temp@test.local', PASSWORD, 'admin');
    expect((await request(app).get('/api/auth/me').set(auth(token))).status).toBe(200);
    await request(app).post(`/api/users/${create.body.user.id}/deactivate`).set(auth(adminToken)).expect(200);
    expect((await request(app).get('/api/auth/me').set(auth(token))).status).toBe(401);
  });

  it('non-admins cannot manage users', async () => {
    const { token } = await login(app, 'emp-auth@test.local', PASSWORD, 'employee');
    expect((await request(app).get('/api/users').set(auth(token))).status).toBe(403);
    expect((await request(app).post('/api/clients').set(auth(token)).send({ name: 'X', code: 'XX' })).status).toBe(403);
  });
});
