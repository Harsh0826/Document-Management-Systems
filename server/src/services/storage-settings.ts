/**
 * Storage settings managed from the admin "Storage" screen, plus the background job that moves files
 * from local disk to S3 and switches the app over once every file is verified.
 *
 * AWS access keys are optional (the server's own AWS role/profile is used when they are absent). When
 * provided, the secret key is encrypted with DATA_ENCRYPTION_KEY and is never sent back to the browser.
 */
import { randomUUID } from 'node:crypto';
import { dataKey, env } from '../config/env.js';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { decryptSecret, encryptSecret } from '../lib/totp.js';
import { audit } from './audit.js';
import { listStoredFiles, migrateFiles, type MigrationReport } from './storage-migration.js';
import { LocalStorage, S3Storage, setActiveStorage, storage, type StorageDriver } from './storage.js';

export interface S3Settings {
  bucket: string;
  region: string;
  kmsKeyId?: string | null;
  accessKeyId?: string | null;
  secretAccessKeyEnc?: string | null;
}

export interface StorageSettings {
  driver: 'local' | 's3';
  s3: S3Settings | null;
  switchedAt?: string | null;
}

const KEY = 'storage';

export async function getStorageSettings(): Promise<StorageSettings> {
  const { rows } = await db().query<{ value: StorageSettings }>('SELECT value FROM app_settings WHERE key = $1', [KEY]);
  if (rows[0]) return rows[0].value;
  // Fall back to environment configuration.
  return {
    driver: env.STORAGE_DRIVER,
    s3: env.S3_BUCKET ? { bucket: env.S3_BUCKET, region: env.AWS_REGION, kmsKeyId: env.S3_KMS_KEY_ID ?? null } : null,
  };
}

async function saveStorageSettings(value: StorageSettings, userId: string | null) {
  await db().query(
    `INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [KEY, JSON.stringify(value), userId],
  );
}

/** Builds the S3 driver for given settings. Replaceable in tests. */
let s3Factory = (s: S3Settings): StorageDriver & { bucket: string } =>
  new S3Storage({
    bucket: s.bucket,
    region: s.region,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    kmsKeyId: s.kmsKeyId ?? undefined,
    credentials:
      s.accessKeyId && s.secretAccessKeyEnc ? { accessKeyId: s.accessKeyId, secretAccessKey: decryptSecret(s.secretAccessKeyEnc, dataKey) } : undefined,
  });
export function __setS3FactoryForTests(f: typeof s3Factory) {
  s3Factory = f;
}

/** Applies saved settings at server start-up. */
export async function loadStorageFromSettings() {
  const s = await getStorageSettings();
  if (s.driver === 's3' && s.s3) {
    setActiveStorage(s3Factory(s.s3));
    logger.info(`Document storage: s3://${s.s3.bucket} (${s.s3.region})`);
  }
}

/** Public view of the settings — never includes the secret key. */
export async function describeStorage() {
  const s = await getStorageSettings();
  const files = await listStoredFiles(db());
  return {
    activeDriver: storage().name,
    switchedAt: s.switchedAt ?? null,
    s3: s.s3
      ? {
          bucket: s.s3.bucket,
          region: s.s3.region,
          kmsKeyId: s.s3.kmsKeyId ?? null,
          usesSavedKeys: !!(s.s3.accessKeyId && s.s3.secretAccessKeyEnc),
          accessKeyHint: s.s3.accessKeyId ? `••••${s.s3.accessKeyId.slice(-4)}` : null,
        }
      : null,
    library: { files: files.length, bytes: files.reduce((a, f) => a + f.size, 0) },
    job: publicJob(),
  };
}

export async function updateS3Settings(
  input: { bucket: string; region: string; kmsKeyId?: string | null; accessKeyId?: string | null; secretAccessKey?: string | null; clearKeys?: boolean },
  userId: string,
) {
  if (job?.status === 'running') throw new Error('Files are being moved right now. Wait until it finishes.');
  const current = await getStorageSettings();
  const prev = current.s3;
  let accessKeyId = prev?.accessKeyId ?? null;
  let secretAccessKeyEnc = prev?.secretAccessKeyEnc ?? null;
  if (input.clearKeys) {
    accessKeyId = null;
    secretAccessKeyEnc = null;
  } else if (input.accessKeyId && input.secretAccessKey) {
    accessKeyId = input.accessKeyId;
    secretAccessKeyEnc = encryptSecret(input.secretAccessKey, dataKey);
  }
  const s3: S3Settings = { bucket: input.bucket, region: input.region, kmsKeyId: input.kmsKeyId || null, accessKeyId, secretAccessKeyEnc };
  await saveStorageSettings({ ...current, s3 }, userId);
  // If files are already served from S3, start using the new connection details immediately.
  if (current.driver === 's3') setActiveStorage(s3Factory(s3));
}

// ---- Friendly errors ------------------------------------------------------------------
export function explainS3Error(err: unknown): string {
  const e = err as { name?: string; Code?: string; message?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  const name = e?.name ?? e?.Code ?? '';
  const msg = e?.message ?? String(err);
  if (/credential/i.test(name) || /Could not load credentials|credentials/i.test(msg))
    return 'The server has no AWS access keys. Enter an access key below, or ask your IT contact to give the server an AWS role.';
  if (name === 'InvalidAccessKeyId') return 'The access key ID was not recognised by AWS. Check that it was copied correctly.';
  if (name === 'SignatureDoesNotMatch') return 'The secret access key is incorrect. Check that it was copied correctly.';
  if (name === 'NoSuchBucket') return 'No bucket with that name was found. Check the bucket name and region.';
  if (name === 'PermanentRedirect' || name === 'AuthorizationHeaderMalformed' || e?.$metadata?.httpStatusCode === 301)
    return 'The bucket is in a different region. Choose the region shown for the bucket in the AWS console.';
  if (name === 'AccessDenied' || e?.$metadata?.httpStatusCode === 403)
    return 'AWS refused access. The access key needs permission to add, read and delete files in this bucket.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo/i.test(msg) || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT/.test(e?.code ?? ''))
    return 'Could not reach Amazon S3. Check the server’s internet connection and try again.';
  return `Amazon S3 returned an error: ${msg}`;
}

/** Writes, reads and deletes a tiny test file. */
export async function testS3Connection(): Promise<{ ok: true } | { ok: false; message: string }> {
  const s = await getStorageSettings();
  if (!s.s3) return { ok: false, message: 'Enter the bucket name and region first.' };
  const target = s3Factory(s.s3);
  const key = `library/_connection-test/${randomUUID()}.txt`;
  try {
    await target.put(key, Buffer.from('DMS connection test'), 'text/plain');
    const back = await target.head(key);
    await target.delete(key);
    if (!back) return { ok: false, message: 'A test file was written but could not be read back. Check the bucket permissions.' };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: explainS3Error(err) };
  }
}

// ---- Background move job -------------------------------------------------------------
interface Job {
  id: string;
  status: 'running' | 'completed' | 'needs_attention' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  report: MigrationReport | null;
  switched: boolean;
  error: string | null;
  promise: Promise<void>;
}
let job: Job | null = null;

function publicJob() {
  if (!job) return null;
  const { promise: _p, report, ...rest } = job;
  return {
    ...rest,
    counts: report?.counts ?? null,
    bytesUploaded: report?.bytesUploaded ?? 0,
    problems: (report?.problems ?? []).slice(0, 50).map((p) => ({ filename: p.filename, documentId: p.documentId, outcome: p.outcome })),
  };
}

/** Starts moving every file to S3; when all are verified the app switches to S3 automatically. */
export async function startMoveToS3(userId: string, req: Parameters<typeof audit>[0]) {
  if (job?.status === 'running') return publicJob()!;
  const s = await getStorageSettings();
  if (!s.s3) throw new Error('Connect a bucket first.');
  const target = s3Factory(s.s3);
  const source = new LocalStorage(env.LOCAL_STORAGE_DIR);
  const files = await listStoredFiles(db());
  const id = randomUUID();
  await audit(req, { action: 'storage.move_started', entityType: 'settings', entityId: 'storage', metadata: { bucket: s.s3.bucket, files: files.length } });

  const run = async () => {
    try {
      const report = await migrateFiles({
        files,
        source,
        target,
        concurrency: 4,
        onProgress: (done) => {
          if (job?.id === id) job.done = done;
        },
      });
      const problems = report.counts.missing_source + report.counts.checksum_mismatch + report.counts.failed;
      job!.report = report;
      if (problems === 0) {
        // Catch anything uploaded while the copy was running, then switch atomically.
        const late = (await listStoredFiles(db())).filter((f) => !files.some((x) => x.key === f.key));
        if (late.length) {
          const extra = await migrateFiles({ files: late, source, target });
          if (extra.problems.length) {
            job!.status = 'needs_attention';
            job!.report = { ...report, problems: extra.problems };
            return;
          }
        }
        await saveStorageSettings({ ...(await getStorageSettings()), driver: 's3', switchedAt: new Date().toISOString() }, userId);
        setActiveStorage(target);
        job!.switched = true;
        job!.status = 'completed';
        await audit(null, {
          action: 'storage.switched_to_s3',
          entityType: 'settings',
          entityId: 'storage',
          actorId: userId,
          metadata: { bucket: s.s3!.bucket, files: report.total },
        });
      } else {
        job!.status = 'needs_attention';
        await audit(null, { action: 'storage.move_needs_attention', entityType: 'settings', entityId: 'storage', actorId: userId, metadata: report.counts });
      }
    } catch (err) {
      job!.status = 'failed';
      job!.error = explainS3Error(err);
      logger.error({ err }, 'Moving files to S3 failed');
    } finally {
      job!.finishedAt = new Date().toISOString();
    }
  };

  job = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: files.length,
    done: 0,
    report: null,
    switched: false,
    error: null,
    promise: Promise.resolve(),
  };
  job.promise = run();
  return publicJob()!;
}

/** Test helper: wait for the current job to finish. */
export async function __waitForJob() {
  await job?.promise;
}
