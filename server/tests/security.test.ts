import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Express } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { totpForTest } from '../src/lib/totp.js';
import { ADMIN, addPerson, auth, login, PASSWORD, setupApp } from './helpers.js';

let app: Express;
let admin: string;
let secondAdmin: { id: string };
let employee: { id: string };

beforeAll(async () => {
  app = await setupApp();
  admin = (await login(app, ADMIN.email, ADMIN.password)).token;
  secondAdmin = await addPerson(app, admin, { email: 'admin2@test.local', isAdmin: true });
  employee = await addPerson(app, admin, { email: 'emp-sec@test.local' });
});

describe('two-step sign-in (TOTP)', () => {
  it('enrols, then requires a code at sign-in, rejects reuse, and accepts a recovery code once', async () => {
    const { token } = await login(app, 'admin2@test.local', PASSWORD);
    const setup = await request(app).post('/api/auth/mfa/setup').set(auth(token));
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const secret: string = setup.body.secret;

    expect((await request(app).post('/api/auth/mfa/enable').set(auth(token)).send({ code: '000000' })).status).toBe(400);
    const enable = await request(app)
      .post('/api/auth/mfa/enable')
      .set(auth(token))
      .send({ code: totpForTest(secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(10);

    const { rows } = await db().query<{ enc: string }>(`SELECT mfa_secret_enc AS enc FROM users WHERE email = 'admin2@test.local'`);
    expect(rows[0].enc).not.toContain(secret);

    const step1 = await request(app).post('/api/auth/login').send({ email: 'admin2@test.local', password: PASSWORD });
    expect(step1.body.mfaRequired).toBe(true);
    expect(step1.body.accessToken).toBeUndefined();
    expect(step1.headers['set-cookie']).toBeUndefined();
    expect((await request(app).post('/api/auth/login/mfa').send({ mfaToken: step1.body.mfaToken, code: '123456' })).status).toBe(401);
    // The code used to enable two-step sign-in cannot be replayed (same time-step).
    expect(
      (
        await request(app)
          .post('/api/auth/login/mfa')
          .send({ mfaToken: step1.body.mfaToken, code: totpForTest(secret) })
      ).status,
    ).toBe(401);

    const recovery = enable.body.recoveryCodes[0];
    const ok = await request(app).post('/api/auth/login/mfa').send({ mfaToken: step1.body.mfaToken, code: recovery });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect((await request(app).post('/api/auth/login/mfa').send({ mfaToken: step1.body.mfaToken, code: recovery })).status).toBe(401);
  });

  it('admins can reset another person’s two-step sign-in (lost phone)', async () => {
    const r = await request(app).post(`/api/people/${secondAdmin.id}/reset-two-step`).set(auth(admin));
    expect(r.status).toBe(200);
    expect(r.body.twoStepOn).toBe(false);
    const res = await request(app).post('/api/auth/login').send({ email: 'admin2@test.local', password: PASSWORD });
    expect(res.body.accessToken).toBeTruthy();
  });
});

describe('session & token hardening', () => {
  it('rejects an access token whose session belongs to a different user', async () => {
    const emp = await login(app, 'emp-sec@test.local', PASSWORD);
    const empClaims = jwt.decode(emp.token) as { sid: string };
    const adminClaims = jwt.decode(admin) as { sub: string };
    const forged = jwt.sign({ sid: empClaims.sid, role: 'admin' }, process.env.JWT_SECRET!, {
      subject: adminClaims.sub,
      expiresIn: 300,
      issuer: 'dms',
      audience: 'dms-api',
    });
    expect((await request(app).get('/api/people').set(auth(forged))).status).toBe(401);
  });

  it('counts parallel failed logins atomically and locks the account', async () => {
    await addPerson(app, admin, { email: 'brute@test.local' });
    await Promise.all(Array.from({ length: 8 }, () => request(app).post('/api/auth/login').send({ email: 'brute@test.local', password: 'wrong' })));
    const { rows } = await db().query<{ locked: boolean }>(`SELECT locked_until > now() AS locked FROM users WHERE email = 'brute@test.local'`);
    expect(rows[0].locked).toBe(true);
  });

  it('does not accept form-encoded logins (login CSRF)', async () => {
    const res = await request(app).post('/api/auth/login').type('form').send({ email: ADMIN.email, password: ADMIN.password });
    expect(res.status).toBe(400);
  });

  it('issues single-use password reset links that end existing sessions', async () => {
    const victim = await login(app, 'emp-sec@test.local', PASSWORD);
    const r = await request(app).post(`/api/people/${employee.id}/reset-password`).set(auth(admin));
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('reset');
    expect((await request(app).get('/api/auth/me').set(auth(victim.token))).status).toBe(401);
    const token = new URL(r.body.url).searchParams.get('token')!;
    expect((await request(app).get(`/api/auth/invitations/${token}`)).body.purpose).toBe('password_reset');
    expect((await request(app).post('/api/auth/accept-invite').send({ token, password: 'NewPassw0rd!' })).status).toBe(200);
    expect((await request(app).post('/api/auth/accept-invite').send({ token, password: 'NewPassw0rd!' })).status).toBe(410);
    await login(app, 'emp-sec@test.local', 'NewPassw0rd!');
  });
});

describe('data protection', () => {
  it('audit log rows cannot be altered or truncated', async () => {
    await expect(db().query(`UPDATE audit_logs SET ip = '1.2.3.4'`)).rejects.toThrow(/append-only/);
    await expect(db().query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
    await expect(db().query(`TRUNCATE audit_logs`)).rejects.toThrow(/append-only/);
  });

  it('never logs invite or signed-file tokens', async () => {
    const { redactUrl } = await import('../src/app.js');
    expect(redactUrl('/api/auth/invitations/abc123secret?x=1')).toBe('/api/auth/invitations/[redacted]?x=1');
    expect(redactUrl('/api/files/eyJ.sig')).toBe('/api/files/[redacted]');
  });

  it('responses carry a request id', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
