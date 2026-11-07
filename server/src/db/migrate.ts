import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './index.js';
import { logger } from '../lib/logger.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies every *.sql file in migrations/ that has not been applied yet, in filename order. */
export async function migrate(database: Database): Promise<string[]> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const { rows } = await database.query<{ version: string }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    // PGlite's exec and pg's simple-query protocol both run multi-statement scripts atomically
    // when wrapped in BEGIN/COMMIT.
    await database.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations(version) VALUES ('${file.replace(/'/g, "''")}');\nCOMMIT;`);
    logger.info(`Applied migration ${file}`);
    ran.push(file);
  }
  return ran;
}
