/**
 * Bootstrap data. Creates the first administrator from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD when the
 * users table is empty. With SEED_DEMO_DATA=true it also creates a demo client, one staff member and
 * one employee account so both portals can be tried immediately.
 *
 * No documents are ever seeded — every document, statistic and notification comes from real uploads.
 */
import { env, isProd } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { hashPassword } from '../services/auth.js';
import { ensureClientRoot, ensureEmployeeRoot } from '../services/folders.js';
import type { Database, Queryable } from './index.js';

async function createUser(
  q: Queryable,
  u: { email: string; password: string; firstName: string; lastName: string; role: string; jobTitle?: string },
): Promise<string> {
  const existing = await q.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [u.email]);
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, first_name, last_name, job_title, role_id, status, password_changed_at)
     SELECT $1, $2, $3, $4, $5, id, 'active', now() FROM roles WHERE name = $6 RETURNING id`,
    [u.email, await hashPassword(u.password), u.firstName, u.lastName, u.jobTitle ?? null, u.role],
  );
  return rows[0].id;
}

export async function seed(database: Database, opts: { force?: boolean } = {}) {
  const { rows } = await database.query<{ n: number }>('SELECT count(*) AS n FROM users');
  if (rows[0].n > 0 && !opts.force) return;

  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    logger.warn('No users exist. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create the first administrator.');
    return;
  }
  if (isProd && env.SEED_ADMIN_PASSWORD.length < 14) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 14 characters in production');
  }

  await database.tx(async (q) => {
    await createUser(q, {
      email: env.SEED_ADMIN_EMAIL!,
      password: env.SEED_ADMIN_PASSWORD!,
      firstName: 'System',
      lastName: 'Administrator',
      role: 'admin',
      jobTitle: 'Administrator',
    });
    logger.info(`Bootstrap administrator: ${env.SEED_ADMIN_EMAIL}`);

    if (!env.SEED_DEMO_DATA || isProd) return;
    const demoPassword = env.DEMO_PASSWORD ?? env.SEED_ADMIN_PASSWORD!;

    const { rows: client } = await q.query<{ id: string }>(
      `INSERT INTO clients (name, code, industry, contact_email) VALUES ('Acme Construction Ltd', 'ACME', 'Construction', 'hr@acme.example')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    const clientId = client[0].id;
    await ensureClientRoot(clientId, q);

    const staffId = await createUser(q, { email: 'staff@dms.local', password: demoPassword, firstName: 'Sam', lastName: 'Reviewer', role: 'staff', jobTitle: 'Compliance Officer' });
    await q.query(
      `INSERT INTO user_permissions (user_id, permission_id)
       SELECT $1, id FROM permissions WHERE key IN ('documents.download', 'documents.review', 'documents.comment', 'documents.upload', 'requests.manage')
       ON CONFLICT DO NOTHING`,
      [staffId],
    );
    await q.query(`INSERT INTO staff_client_assignments (staff_user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [staffId, clientId]);

    const empUserId = await createUser(q, { email: 'employee@dms.local', password: demoPassword, firstName: 'Jordan', lastName: 'Lee', role: 'employee', jobTitle: 'Site Engineer' });
    const { rows: emp } = await q.query<{ id: string }>(
      `INSERT INTO employees (user_id, client_id, employee_number, department, position)
       VALUES ($1, $2, 'E-1001', 'Engineering', 'Site Engineer')
       ON CONFLICT (user_id) DO UPDATE SET client_id = EXCLUDED.client_id RETURNING id`,
      [empUserId, clientId],
    );
    await ensureEmployeeRoot(emp[0].id, q);
    logger.info('Demo accounts created: staff@dms.local (staff), employee@dms.local (employee)');
  });
}
