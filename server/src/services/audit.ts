import type { Request } from 'express';
import { db, type Queryable } from '../db/index.js';
import { clientIp, userAgent } from '../lib/http.js';
import { logger } from '../lib/logger.js';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
  actorEmail?: string | null;
}

/**
 * Writes an audit record. Pass the transaction `q` when the audited change is transactional so the
 * log entry commits or rolls back with it.
 */
export async function audit(req: Request | null, entry: AuditEntry, q: Queryable = db()) {
  try {
    await q.query(
      `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, ip, user_agent, metadata, actor_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.actorId !== undefined ? entry.actorId : (req?.user?.id ?? null),
        entry.actorEmail !== undefined ? entry.actorEmail : (req?.user?.email ?? null),
        entry.action,
        entry.entityType ?? null,
        entry.entityId ?? null,
        req ? clientIp(req) : null,
        req ? userAgent(req) : null,
        JSON.stringify(entry.metadata ?? {}),
        entry.actorId === undefined && req?.user ? `${req.user.firstName} ${req.user.lastName}` : null,
      ],
    );
  } catch (err) {
    // Inside a transaction we must propagate so the change is not committed without its audit row.
    if (q !== db()) throw err;
    logger.error({ err, entry }, 'Failed to write audit log');
  }
}
