import type { Alert, AlertKind } from '../../shared/types.js';
import { getDb, nowIso } from './index.js';

interface AlertRow {
  id: number;
  watch_id: number;
  check_id: number | null;
  kind: string;
  channel: string;
  sent_at: string;
  message: string;
}

function mapAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    watch_id: row.watch_id,
    check_id: row.check_id,
    kind: row.kind as AlertKind,
    channel: row.channel,
    sent_at: row.sent_at,
    message: row.message,
  };
}

export interface NewAlert {
  watch_id: number;
  check_id: number | null;
  kind: AlertKind;
  channel: string;
  message: string;
}

export function recordAlert(input: NewAlert): Alert {
  const info = getDb()
    .prepare(
      `INSERT INTO alerts (watch_id, check_id, kind, channel, sent_at, message)
       VALUES (@watch_id, @check_id, @kind, @channel, @sent_at, @message)`,
    )
    .run({ ...input, sent_at: nowIso() });

  const row = getDb().prepare('SELECT * FROM alerts WHERE id = ?').get(info.lastInsertRowid) as
    AlertRow | undefined;
  if (!row) throw new Error('failed to read back recorded alert');
  return mapAlert(row);
}

export function listAlerts(watchId: number, limit = 50): Alert[] {
  const rows = getDb()
    .prepare('SELECT * FROM alerts WHERE watch_id = ? ORDER BY id DESC LIMIT ?')
    .all(watchId, limit) as AlertRow[];
  return rows.map(mapAlert);
}

/**
 * Whether a "your check is failing" alert has already gone out during the current
 * run of failures. Keeps the failure notice to exactly one email per outage.
 */
export function failureAlertSentSinceLastSuccess(watchId: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM alerts
       WHERE watch_id = ? AND kind = 'failure'
         AND COALESCE(check_id, 0) > COALESCE(
           (SELECT MAX(id) FROM checks WHERE watch_id = ? AND status = 'ok'), 0)`,
    )
    .get(watchId, watchId) as { n: number };
  return row.n > 0;
}
