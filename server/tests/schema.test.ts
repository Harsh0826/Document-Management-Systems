import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { setupApp } from './helpers.js';

describe('database schema', () => {
  beforeAll(async () => {
    await setupApp();
  });

  it('contains only the tables the library app uses', async () => {
    const { rows } = await db().query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    expect(rows.map((r) => r.tablename)).toEqual([
      'app_settings',
      'audit_logs',
      'auth_sessions',
      'library_file_versions',
      'library_files',
      'library_folders',
      'library_pins',
      'roles',
      'schema_migrations',
      'user_tokens',
      'users',
    ]);
  });

  it('has exactly two roles', async () => {
    const { rows } = await db().query<{ name: string }>('SELECT name FROM roles ORDER BY name');
    expect(rows.map((r) => r.name)).toEqual(['admin', 'employee']);
  });
});
