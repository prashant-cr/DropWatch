import type { Check, CheckErrorKind, CheckStatus, PricePoint } from '../../shared/types.js';
import { fromBool, getDb, nowIso, toBool } from './index.js';

interface CheckRow {
  id: number;
  watch_id: number;
  checked_at: string;
  price: number | null;
  available: number | null;
  status: string;
  error_kind: string | null;
  error_message: string | null;
  duration_ms: number;
}

function mapCheck(row: CheckRow): Check {
  return {
    id: row.id,
    watch_id: row.watch_id,
    checked_at: row.checked_at,
    price: row.price,
    available: toBool(row.available),
    status: row.status as CheckStatus,
    error_kind: row.error_kind as CheckErrorKind | null,
    error_message: row.error_message,
    duration_ms: row.duration_ms,
  };
}

export interface NewCheck {
  watch_id: number;
  price: number | null;
  available: boolean | null;
  status: CheckStatus;
  error_kind?: CheckErrorKind | null;
  error_message?: string | null;
  duration_ms: number;
  checked_at?: string;
}

export function recordCheck(input: NewCheck): Check {
  const info = getDb()
    .prepare(
      `INSERT INTO checks (watch_id, checked_at, price, available, status, error_kind, error_message, duration_ms)
       VALUES (@watch_id, @checked_at, @price, @available, @status, @error_kind, @error_message, @duration_ms)`,
    )
    .run({
      watch_id: input.watch_id,
      checked_at: input.checked_at ?? nowIso(),
      price: input.price,
      available: fromBool(input.available),
      status: input.status,
      error_kind: input.error_kind ?? null,
      error_message: input.error_message ?? null,
      duration_ms: input.duration_ms,
    });

  const row = getDb().prepare('SELECT * FROM checks WHERE id = ?').get(info.lastInsertRowid) as
    CheckRow | undefined;
  if (!row) throw new Error('failed to read back recorded check');
  return mapCheck(row);
}

export function listChecks(watchId: number, limit = 100, offset = 0): Check[] {
  const rows = getDb()
    .prepare('SELECT * FROM checks WHERE watch_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(watchId, limit, offset) as CheckRow[];
  return rows.map(mapCheck);
}

/** A check row joined with its watch, for the cross-watch history page. */
export interface CheckWithWatch extends Check {
  watch_label: string;
  watch_url: string;
}

export function listRecentChecks(limit = 100, offset = 0): CheckWithWatch[] {
  const rows = getDb()
    .prepare(
      `SELECT c.*, w.label AS watch_label, w.url AS watch_url
       FROM checks c JOIN watches w ON w.id = c.watch_id
       ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Array<CheckRow & { watch_label: string; watch_url: string }>;

  return rows.map((row) => ({
    ...mapCheck(row),
    watch_label: row.watch_label,
    watch_url: row.watch_url,
  }));
}

export function countAllChecks(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM checks').get() as { n: number };
  return row.n;
}

export function countChecks(watchId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM checks WHERE watch_id = ?')
    .get(watchId) as { n: number };
  return row.n;
}

export function latestCheck(watchId: number): Check | null {
  const row = getDb()
    .prepare('SELECT * FROM checks WHERE watch_id = ? ORDER BY id DESC LIMIT 1')
    .get(watchId) as CheckRow | undefined;
  return row ? mapCheck(row) : null;
}

/**
 * The most recent successful check strictly before `beforeId`. This is the baseline
 * the trigger logic compares against: failed checks must not re-arm or re-fire an
 * alert, so they are skipped rather than treated as a state change.
 */
export function lastSuccessfulCheckBefore(watchId: number, beforeId: number): Check | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM checks
       WHERE watch_id = ? AND id < ? AND status = 'ok'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(watchId, beforeId) as CheckRow | undefined;
  return row ? mapCheck(row) : null;
}

/** Number of failed checks since the last successful one. */
export function consecutiveFailures(watchId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM checks
       WHERE watch_id = ? AND status = 'error'
         AND id > COALESCE((SELECT MAX(id) FROM checks WHERE watch_id = ? AND status = 'ok'), 0)`,
    )
    .get(watchId, watchId) as { n: number };
  return row.n;
}

/** Successful checks within the last `days`, oldest first — for charts. */
export function priceHistory(watchId: number, days = 30): PricePoint[] {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = getDb()
    .prepare(
      // `id` breaks ties: two checks can share a millisecond timestamp, and without
      // a deterministic second key SQLite may return them in either order — which
      // would draw the chart backwards.
      `SELECT checked_at, price, available FROM checks
       WHERE watch_id = ? AND status = 'ok' AND checked_at >= ?
       ORDER BY checked_at ASC, id ASC`,
    )
    .all(watchId, since) as Array<{
    checked_at: string;
    price: number | null;
    available: number | null;
  }>;
  return rows.map((r) => ({
    checked_at: r.checked_at,
    price: r.price,
    available: toBool(r.available),
  }));
}
