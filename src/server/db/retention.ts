/**
 * Keeps the `checks` table from growing without bound.
 *
 * DropWatch is meant to be left running for months, and a single watch at the
 * 15-minute minimum writes ~35,000 rows a year. Nothing here is about disk panic —
 * SQLite handles millions of rows fine — it is about the file never quietly
 * becoming the largest thing in the user's home directory.
 *
 * The policy, applied to rows older than the retention window:
 *  - failed checks are dropped outright; a two-month-old timeout tells nobody
 *    anything, and the failure alerting only ever looks at the current streak;
 *  - successful checks are downsampled to the shape of the day — the cheapest
 *    reading, the dearest, and the last one. That is what a history chart needs to
 *    stay honest, at roughly 3 rows per watch per day instead of 96.
 *
 * Recent history is never touched, so the sparkline and the 30/90-day charts keep
 * full resolution over the range users actually look at.
 */

import { getDb } from './index.js';

export interface PruneResult {
  /** Failed checks removed because they aged out. */
  errorsDeleted: number;
  /** Successful checks removed by downsampling. */
  downsampled: number;
  /** Whether the file was compacted afterwards. */
  vacuumed: boolean;
}

/**
 * Rows deleted in one pass before it is worth rewriting the file. VACUUM copies the
 * entire database, so doing it after trimming a handful of rows costs more than the
 * space it reclaims.
 */
const VACUUM_THRESHOLD = 500;

function cutoffIso(retentionDays: number): string {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Applies the retention policy. `retentionDays <= 0` means "keep everything" and is
 * a no-op.
 *
 * Safe to call at any time: it only ever touches rows older than the cutoff, so it
 * cannot race a check that is being written right now.
 */
export function pruneChecks(retentionDays: number): PruneResult {
  const result: PruneResult = { errorsDeleted: 0, downsampled: 0, vacuumed: false };
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return result;

  const db = getDb();
  const cutoff = cutoffIso(retentionDays);

  const prune = db.transaction((): void => {
    result.errorsDeleted = db
      .prepare(`DELETE FROM checks WHERE status = 'error' AND checked_at < ?`)
      .run(cutoff).changes;

    // Keep the daily low, the daily high and the day's closing reading; drop the
    // rest. Ranking by `id` as the tiebreaker keeps the choice deterministic when
    // two checks share a price or a timestamp.
    result.downsampled = db
      .prepare(
        `DELETE FROM checks
          WHERE status = 'ok'
            AND checked_at < @cutoff
            AND id NOT IN (
              SELECT id FROM (
                SELECT
                  id,
                  ROW_NUMBER() OVER (
                    PARTITION BY watch_id, date(checked_at) ORDER BY price ASC, id ASC
                  ) AS cheapest,
                  ROW_NUMBER() OVER (
                    PARTITION BY watch_id, date(checked_at) ORDER BY price DESC, id ASC
                  ) AS dearest,
                  ROW_NUMBER() OVER (
                    PARTITION BY watch_id, date(checked_at) ORDER BY checked_at DESC, id DESC
                  ) AS closing
                FROM checks
                WHERE status = 'ok' AND checked_at < @cutoff
              )
              WHERE cheapest = 1 OR dearest = 1 OR closing = 1
            )`,
      )
      .run({ cutoff }).changes;
  });

  prune();

  // VACUUM cannot run inside a transaction, hence out here.
  if (result.errorsDeleted + result.downsampled >= VACUUM_THRESHOLD) {
    db.exec('VACUUM');
    result.vacuumed = true;
  }

  return result;
}
