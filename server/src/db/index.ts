/**
 * Database access layer.
 *
 * Production: node-postgres Pool against PostgreSQL (DATABASE_URL).
 * Development / tests without a server: PGlite (PostgreSQL compiled to WASM) — same SQL, same migrations.
 *
 * All application code talks to the small `Queryable` interface below, always with parameterized SQL.
 */
import pg from 'pg';
import { mkdirSync } from 'node:fs';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Database extends Queryable {
  /** Run several statements (no parameters) — used by migrations. */
  exec(sql: string): Promise<void>;
  /** Run `fn` inside a transaction; rolls back on throw. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly driver: 'pg' | 'pglite';
}

// Return DATE columns as 'YYYY-MM-DD' strings (avoids timezone shifts) and counts as numbers.
const DATE_OID = 1082;
const INT8_OID = 20;
const NUMERIC_OID = 1700;

async function createPgDatabase(url: string): Promise<Database> {
  pg.types.setTypeParser(DATE_OID, (v: string) => v);
  pg.types.setTypeParser(INT8_OID, (v: string) => Number(v));
  pg.types.setTypeParser(NUMERIC_OID, (v: string) => Number(v));
  const pool = new pg.Pool({
    connectionString: url,
    max: 20,
    idleTimeoutMillis: 30_000,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
  });
  pool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));

  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await c.query(sql, params as unknown[]);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
  });

  return {
    driver: 'pg',
    ...wrap(pool),
    async exec(sql) {
      const client = await pool.connect();
      try {
        await client.query(sql);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPgliteDatabase(dataDir: string | undefined): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir ?? 'memory://', {
    extensions: { pg_trgm },
    parsers: {
      [DATE_OID]: (v: string) => v,
      [INT8_OID]: (v: string) => Number(v),
      [NUMERIC_OID]: (v: string) => Number(v),
    },
  });
  await db.waitReady;

  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await c.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.affectedRows ?? r.rows.length };
    },
  });

  return {
    driver: 'pglite',
    ...wrap(db),
    async exec(sql) {
      try {
        await db.exec(sql);
      } catch (err) {
        await db.exec('ROLLBACK').catch(() => undefined);
        throw err;
      }
    },
    tx: (fn) => db.transaction((t) => fn(wrap(t))),
    async close() {
      await db.close();
    },
  };
}

let instance: Database | null = null;

/** Initialise the shared database. `memory: true` gives an isolated in-memory PGlite (tests). */
export async function initDb(opts: { memory?: boolean } = {}): Promise<Database> {
  if (instance) return instance;
  if (env.DATABASE_URL && !opts.memory) {
    instance = await createPgDatabase(env.DATABASE_URL);
    logger.info('Connected to PostgreSQL');
  } else {
    instance = await createPgliteDatabase(opts.memory ? undefined : env.PGLITE_DATA_DIR);
    logger.warn(
      opts.memory ? 'Using in-memory PGlite (tests)' : `Using embedded PGlite at ${env.PGLITE_DATA_DIR} — development only`,
    );
  }
  return instance;
}

export function db(): Database {
  if (!instance) throw new Error('Database not initialised — call initDb() first');
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}
