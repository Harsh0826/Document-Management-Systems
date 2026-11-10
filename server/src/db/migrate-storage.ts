/**
 * Copies every stored document file from local disk (LOCAL_STORAGE_DIR) to the S3 bucket (S3_BUCKET).
 *
 *   npm run storage:migrate -- --dry-run       check everything, upload nothing
 *   npm run storage:migrate                    upload (skips files already in S3)
 *   npm run storage:migrate -- --concurrency=8
 *
 * AWS credentials come from the standard AWS chain (AWS_PROFILE, AWS_ACCESS_KEY_ID/…, SSO, or an
 * instance/task role) — they are never read from or written to this project.
 * With the embedded development database, stop the API server first (PGlite allows one process).
 */
import { writeFileSync } from 'node:fs';
import { env } from '../config/env.js';
import { listStoredFiles, migrateFiles } from '../services/storage-migration.js';
import { createS3StorageFromEnv, LocalStorage } from '../services/storage.js';
import { closeDb, initDb } from './index.js';
import { migrate } from './migrate.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const concurrency = Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? 4);
const fmtMB = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;

async function main() {
  if (!env.S3_BUCKET) {
    console.error('S3_BUCKET is not set. Configure S3_BUCKET and AWS_REGION in server/.env first (see docs/S3_MIGRATION.md).');
    process.exit(1);
  }
  const database = await initDb();
  await migrate(database); // make sure the schema is current (no-op when it already is)
  const source = new LocalStorage(env.LOCAL_STORAGE_DIR);
  const target = createS3StorageFromEnv();

  const files = await listStoredFiles(database);
  const totalBytes = files.reduce((a, f) => a + f.size, 0);
  console.log(`${dryRun ? '[DRY RUN] ' : ''}Copying ${files.length} file(s), ${fmtMB(totalBytes)}`);
  console.log(`  from: ${source.root}`);
  console.log(`  to:   s3://${target.bucket} (${env.AWS_REGION}${env.S3_ENDPOINT ? `, endpoint ${env.S3_ENDPOINT}` : ''})`);
  console.log(`  db:   ${database.driver}\n`);

  // Fail fast on credentials / bucket access before touching thousands of files.
  try {
    await target.head('__dms_connectivity_check__');
  } catch (err) {
    console.error(`Cannot access bucket "${target.bucket}": ${err instanceof Error ? err.message : err}`);
    console.error('Check AWS credentials (e.g. AWS_PROFILE), region, and that the IAM identity has s3:GetObject/PutObject on the bucket.');
    process.exit(1);
  }

  const report = await migrateFiles({
    files,
    source,
    target,
    dryRun,
    concurrency,
    onProgress: (done, total, f, outcome) => {
      if (outcome !== 'already_present' || done === total || done % 50 === 0) {
        console.log(`  [${String(done).padStart(String(total).length)}/${total}] ${outcome.padEnd(17)} ${f.key}`);
      }
    },
  });

  const reportPath = `storage-migration-report-${report.startedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const c = report.counts;
  console.log('\nSummary');
  console.log(`  uploaded:          ${c.uploaded} (${fmtMB(report.bytesUploaded)})`);
  if (dryRun) console.log(`  would upload:      ${c.would_upload}`);
  console.log(`  already in S3:     ${c.already_present}`);
  console.log(`  missing locally:   ${c.missing_source}`);
  console.log(`  checksum mismatch: ${c.checksum_mismatch}`);
  console.log(`  failed:            ${c.failed}`);
  console.log(`  report:            ${reportPath}`);

  const problems = c.missing_source + c.checksum_mismatch + c.failed;
  if (problems) {
    console.error(`\n${problems} file(s) need attention — see the report. Re-running is safe.`);
    process.exitCode = 1;
  } else if (!dryRun) {
    console.log('\nAll files are in S3 and verified. You can now set STORAGE_DRIVER=s3 and restart the API.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
