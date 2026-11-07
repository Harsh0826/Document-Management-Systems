/**
 * Certificate expiry job.
 *  - approved/pending/renewal-required documents past their expiry date → status 'expired' + notify
 *  - approved documents within 30 days of expiry → status 'renewal_required'
 *  - reminders at 90, 60 and 30 days (each sent once per version, tracked in expiry_reminders)
 */
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { audit } from './audit.js';
import { notify, reviewersForClient } from './notifications.js';

const THRESHOLDS = [30, 60, 90] as const;

interface Candidate {
  id: string;
  title: string;
  client_id: string;
  status: string;
  expiry_date: string;
  days: number;
  version_id: string;
  owner_id: string;
  employee_name: string;
}

export async function runExpiryJob(): Promise<{ expired: number; renewal: number; reminders: number }> {
  const result = { expired: 0, renewal: 0, reminders: 0 };
  const { rows } = await db().query<Candidate>(
    `SELECT d.id, d.title, d.client_id, d.status, d.expiry_date, (d.expiry_date - CURRENT_DATE) AS days,
            d.current_version_id AS version_id, e.user_id AS owner_id, u.first_name || ' ' || u.last_name AS employee_name
       FROM documents d JOIN employees e ON e.id = d.employee_id JOIN users u ON u.id = e.user_id
      WHERE d.deleted_at IS NULL AND NOT d.is_archived AND d.expiry_date IS NOT NULL
        AND d.current_version_id IS NOT NULL
        AND d.expiry_date <= CURRENT_DATE + 90
        AND d.status <> 'rejected'`,
  );

  for (const d of rows) {
    try {
      await db().tx(async (q) => {
        const link = `/documents/${d.id}`;
        if (d.days < 0) {
          if (d.status !== 'expired') {
            await q.query(`UPDATE documents SET status = 'expired' WHERE id = $1`, [d.id]);
            await audit(null, { action: 'document.expired', entityType: 'document', entityId: d.id, clientId: d.client_id, actorEmail: 'system', metadata: { expiryDate: d.expiry_date, previousStatus: d.status } }, q);
            result.expired++;
          }
          const { rowCount } = await q.query(
            `INSERT INTO expiry_reminders (version_id, threshold_days) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
            [d.version_id],
          );
          if (rowCount) {
            await notify([d.owner_id], { type: 'certificate_expired', title: 'Certificate expired', message: `"${d.title}" expired on ${d.expiry_date}. Please upload a renewed certificate.`, link, entityType: 'document', entityId: d.id }, q);
            await notify(await reviewersForClient(d.client_id, q), { type: 'certificate_expired', title: 'Certificate expired', message: `${d.employee_name} — "${d.title}" expired on ${d.expiry_date}.`, link, entityType: 'document', entityId: d.id }, q);
          }
          return;
        }

        if (d.days <= 30 && d.status === 'approved') {
          await q.query(`UPDATE documents SET status = 'renewal_required' WHERE id = $1`, [d.id]);
          await audit(null, { action: 'document.renewal_required', entityType: 'document', entityId: d.id, clientId: d.client_id, actorEmail: 'system', metadata: { expiryDate: d.expiry_date } }, q);
          result.renewal++;
        }

        // Smallest threshold the document has crossed and that has not been sent yet.
        const threshold = THRESHOLDS.find((t) => d.days <= t);
        if (!threshold) return;
        const { rowCount } = await q.query(
          `INSERT INTO expiry_reminders (version_id, threshold_days)
           SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM expiry_reminders WHERE version_id = $1 AND threshold_days <= $2)
           ON CONFLICT DO NOTHING`,
          [d.version_id, threshold],
        );
        if (rowCount) {
          const when = d.days === 0 ? 'today' : `in ${d.days} day${d.days === 1 ? '' : 's'}`;
          await notify([d.owner_id], { type: 'certificate_expiring', title: 'Certificate expiring soon', message: `"${d.title}" expires ${when} (${d.expiry_date}). Upload a renewal to stay compliant.`, link, entityType: 'document', entityId: d.id }, q);
          await notify(await reviewersForClient(d.client_id, q), { type: 'certificate_expiring', title: `Certificate expiring within ${threshold} days`, message: `${d.employee_name} — "${d.title}" expires ${when}.`, link, entityType: 'document', entityId: d.id }, q);
          result.reminders++;
        }
      });
    } catch (err) {
      logger.error({ err, documentId: d.id }, 'Expiry job failed for document');
    }
  }
  if (result.expired || result.renewal || result.reminders) logger.info(result, 'Expiry job completed');
  return result;
}

let timer: NodeJS.Timeout | null = null;
export function scheduleExpiryJob(intervalMinutes: number) {
  const run = () => runExpiryJob().catch((err) => logger.error({ err }, 'Expiry job crashed'));
  void run();
  timer = setInterval(run, intervalMinutes * 60_000);
  timer.unref();
}
export function stopExpiryJob() {
  if (timer) clearInterval(timer);
}
