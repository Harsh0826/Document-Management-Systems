/**
 * Bootstrap data. Creates the first administrator from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD when the
 * users table is empty. With SEED_DEMO_DATA=true it also creates one employee account and four empty
 * starter folders. No documents are ever seeded — every document comes from a real upload.
 */
import { env, isProd } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { hashPassword } from '../services/auth.js';
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

    await createUser(q, {
      email: 'employee@dms.local',
      password: demoPassword,
      firstName: 'Jordan',
      lastName: 'Lee',
      role: 'employee',
      jobTitle: 'Site Engineer',
    });

    // Starter top-level folders (empty — documents always come from real uploads).
    const { rows: existing } = await q.query<{ n: number }>('SELECT count(*) AS n FROM library_folders');
    if (existing[0].n === 0) {
      for (const name of ['Licences', 'HR Policies', 'Finance', 'Health & Safety']) {
        await q.query('INSERT INTO library_folders (name, depth) VALUES ($1, 1)', [name]);
      }
    }
    logger.info('Demo account created: employee@dms.local (employee)');
  });
}
