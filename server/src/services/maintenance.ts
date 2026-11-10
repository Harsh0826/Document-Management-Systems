/**
 * Background housekeeping: files left in "Recently deleted" for more than 30 days are removed for good
 * (stored copies deleted, record kept as history).
 */
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { audit } from './audit.js';
import { RESTORE_DAYS } from './library.js';
import { storage } from './storage.js';

export async function purgeDeletedFiles(): Promise<number> {
  const { rows } = await db().query<{ id: string; name: string }>(
    `SELECT id, name FROM library_files
      WHERE deleted_at IS NOT NULL AND purged_at IS NULL AND deleted_at < now() - make_interval(days => $1::int)`,
    [RESTORE_DAYS],
  );
  for (const f of rows) {
    try {
      const { rows: versions } = await db().query<{ storage_key: string }>('SELECT storage_key FROM library_file_versions WHERE file_id = $1', [f.id]);
      for (const v of versions) await storage().delete(v.storage_key);
      await db().query('UPDATE library_files SET purged_at = now() WHERE id = $1', [f.id]);
      await audit(null, { action: 'file.removed_for_good', entityType: 'file', entityId: f.id, actorEmail: 'system', metadata: { name: f.name } });
    } catch (err) {
      logger.error({ err, fileId: f.id }, 'Could not remove deleted file');
    }
  }
  if (rows.length) logger.info(`Removed ${rows.length} file(s) deleted more than ${RESTORE_DAYS} days ago`);
  return rows.length;
}

let timer: NodeJS.Timeout | null = null;
export function scheduleMaintenance(intervalMinutes: number) {
  const run = () => purgeDeletedFiles().catch((err) => logger.error({ err }, 'Maintenance job failed'));
  void run();
  timer = setInterval(run, intervalMinutes * 60_000);
  timer.unref();
}
export function stopMaintenance() {
  if (timer) clearInterval(timer);
}
