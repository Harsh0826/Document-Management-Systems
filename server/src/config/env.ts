import 'dotenv/config';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    APP_URL: z.string().url().default('http://localhost:5173'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    // Database: real PostgreSQL when DATABASE_URL is set, embedded PGlite otherwise (dev/test only).
    DATABASE_URL: z.string().optional(),
    DATABASE_SSL: bool.default(false),
    PGLITE_DATA_DIR: z.string().default('./.data/pglite'),

    // Auth
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    INVITE_TTL_HOURS: z.coerce.number().int().positive().default(72),
    /** Absolute lifetime of a sign-in, however often the refresh token is rotated. */
    SESSION_MAX_DAYS: z.coerce.number().int().positive().max(90).default(30),
    /** 32-byte key (base64) for encrypting MFA secrets at rest. Required in production. */
    DATA_ENCRYPTION_KEY: z.string().optional(),
    /** Roles that must use MFA; comma-separated. Defaults to admin in production. */
    MFA_REQUIRED_ROLES: z.string().optional(),
    /** Per-user cap on preview/download links per hour (exfiltration guard). */
    DOWNLOADS_PER_HOUR: z.coerce.number().int().positive().default(200),

    // Storage
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./storage'),
    FILE_URL_SECRET: z.string().min(32, 'FILE_URL_SECRET must be at least 32 characters'),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    MAX_UPLOAD_MB: z.coerce.number().int().positive().max(100).default(25),
    AWS_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ENDPOINT: z.string().url().optional(), // e.g. MinIO in local docker
    S3_FORCE_PATH_STYLE: bool.default(false),
    S3_KMS_KEY_ID: z.string().optional(),

    // Jobs
    EXPIRY_JOB_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
    RUN_JOBS: bool.default(true),

    // Seed (bootstrap admin is created only when the users table is empty)
    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_PASSWORD: z.string().optional(),
    SEED_DEMO_DATA: bool.default(false),
    DEMO_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'S3_BUCKET is required when STORAGE_DRIVER=s3' });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.DATABASE_URL) {
        ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DATABASE_URL is required in production' });
      }
      if (env.STORAGE_DRIVER !== 's3') {
        ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'Use STORAGE_DRIVER=s3 in production' });
      }
      // Refuse example / weak / shared secrets.
      const weak = /change-me|dev-only|example|secret-please|test-/i;
      for (const k of ['JWT_SECRET', 'FILE_URL_SECRET'] as const) {
        if (weak.test(env[k]) || env[k].length < 48) {
          ctx.addIssue({ code: 'custom', path: [k], message: `${k} must be a unique random value of at least 48 characters in production` });
        }
      }
      if (env.JWT_SECRET === env.FILE_URL_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['FILE_URL_SECRET'], message: 'FILE_URL_SECRET must differ from JWT_SECRET' });
      }
      if (!env.DATA_ENCRYPTION_KEY || Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64').length !== 32) {
        ctx.addIssue({ code: 'custom', path: ['DATA_ENCRYPTION_KEY'], message: 'DATA_ENCRYPTION_KEY must be 32 random bytes, base64-encoded' });
      }
      if (env.TRUST_PROXY < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['TRUST_PROXY'],
          message: 'Set TRUST_PROXY to the number of proxies in front of the app (1 behind an ALB) so client IPs and rate limits are correct',
        });
      }
      if (!env.APP_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL must use https in production' });
      }
    } else if (env.DATA_ENCRYPTION_KEY && Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64').length !== 32) {
      ctx.addIssue({ code: 'custom', path: ['DATA_ENCRYPTION_KEY'], message: 'DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded' });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Key for encrypting secrets at rest. Outside production it may be derived from JWT_SECRET. */
export const dataKey: Buffer = env.DATA_ENCRYPTION_KEY
  ? Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64')
  : createHash('sha256').update(`dms-data-key:${env.JWT_SECRET}`).digest();

export const mfaRequiredRoles = new Set(
  (env.MFA_REQUIRED_ROLES ?? (isProd ? 'admin' : ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
