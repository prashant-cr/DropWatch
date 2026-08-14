import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, initDb } from '../src/server/db/index.js';
import { countChecks, listChecks, recordCheck } from '../src/server/db/checks.js';
import { pruneChecks } from '../src/server/db/retention.js';
import { createWatch } from '../src/server/db/watches.js';

let watchId = 0;

beforeEach(() => {
  initDb(':memory:');
  watchId = createWatch({
    url: 'https://store.example.com/p/1',
    label: '',
    mode: 'price',
    target_price: 100,
    interval_cron: '0 * * * *',
    currency: 'USD',
    selector_override: null,
  }).id;
});

afterEach(() => {
  closeDb();
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** Records a check at a fixed age, so tests can build history without waiting. */
function checkAt(daysAgo: number, price: number | null, hour = 12) {
  const at = new Date(Date.now() - daysAgo * DAY_MS);
  at.setUTCHours(hour, 0, 0, 0);
  return recordCheck({
    watch_id: watchId,
    price,
    available: price !== null,
    status: 'ok',
    duration_ms: 10,
    checked_at: at.toISOString(),
  });
}

function failureAt(daysAgo: number, hour = 12) {
  const at = new Date(Date.now() - daysAgo * DAY_MS);
  at.setUTCHours(hour, 0, 0, 0);
  return recordCheck({
    watch_id: watchId,
    price: null,
    available: null,
    status: 'error',
    error_kind: 'timeout',
    error_message: 'took too long',
    duration_ms: 10,
    checked_at: at.toISOString(),
  });
}

const pricesOn = (daysAgo: number): number[] => {
  const day = new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
  const rows = getDb()
    .prepare(`SELECT price FROM checks WHERE date(checked_at) = ? ORDER BY price ASC`)
    .all(day) as Array<{ price: number | null }>;
  return rows.map((r) => r.price ?? 0);
};

describe('pruneChecks', () => {
  it('keeps everything inside the retention window untouched', () => {
    for (let hour = 0; hour < 12; hour++) checkAt(3, 100 + hour, hour);

    const result = pruneChecks(90);

    expect(result.downsampled).toBe(0);
    expect(result.errorsDeleted).toBe(0);
    expect(countChecks(watchId)).toBe(12);
  });

  it('downsamples an old day to its low, high and close', () => {
    // 08:00 → 120, 09:00 → 90 (low), 10:00 → 150 (high), 11:00 → 130 (close)
    checkAt(200, 120, 8);
    checkAt(200, 90, 9);
    checkAt(200, 150, 10);
    checkAt(200, 130, 11);

    const result = pruneChecks(90);

    expect(result.downsampled).toBe(1);
    expect(pricesOn(200)).toEqual([90, 130, 150]);
  });

  it('keeps only two rows when the high is also the close', () => {
    // A day that only ever rises: the last reading is the dearest one, so the
    // three roles collapse onto two rows and there is no third to keep.
    for (let hour = 8; hour < 12; hour++) checkAt(200, 100 + hour, hour);

    pruneChecks(90);

    expect(pricesOn(200)).toEqual([108, 111]);
  });

  it('leaves a day alone when it already has three or fewer readings', () => {
    checkAt(200, 100, 8);
    checkAt(200, 110, 9);

    expect(pruneChecks(90).downsampled).toBe(0);
    expect(pricesOn(200)).toEqual([100, 110]);
  });

  it('downsamples each old day independently', () => {
    for (const day of [150, 151]) {
      checkAt(day, 50, 8);
      checkAt(day, 10, 9);
      checkAt(day, 90, 10);
      checkAt(day, 70, 11);
    }

    pruneChecks(90);

    expect(pricesOn(150)).toEqual([10, 70, 90]);
    expect(pricesOn(151)).toEqual([10, 70, 90]);
  });

  it('drops aged-out failures entirely', () => {
    failureAt(200);
    failureAt(200, 13);
    failureAt(2); // inside the window, must survive

    const result = pruneChecks(90);

    expect(result.errorsDeleted).toBe(2);
    const remaining = listChecks(watchId, 100);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.status).toBe('error');
  });

  it('never crosses watches when collapsing a day', () => {
    const other = createWatch({
      url: 'https://store.example.com/p/2',
      label: '',
      mode: 'price',
      target_price: 50,
      interval_cron: '0 * * * *',
      currency: 'USD',
      selector_override: null,
    }).id;

    // Both days are shaped so the low, high and close are three different rows.
    for (const [hour, price] of [
      [8, 10],
      [9, 40],
      [10, 25],
      [11, 30],
    ] as const) {
      const at = new Date(Date.now() - 200 * DAY_MS);
      at.setUTCHours(hour, 0, 0, 0);
      recordCheck({
        watch_id: other,
        price,
        available: true,
        status: 'ok',
        duration_ms: 1,
        checked_at: at.toISOString(),
      });
    }
    checkAt(200, 120, 8);
    checkAt(200, 90, 9);
    checkAt(200, 150, 10);
    checkAt(200, 130, 11);

    pruneChecks(90);

    // Three survivors each, not three across both.
    expect(countChecks(watchId)).toBe(3);
    expect(countChecks(other)).toBe(3);
  });

  it('is a no-op when retention is disabled', () => {
    for (let hour = 0; hour < 6; hour++) checkAt(500, 100 + hour, hour);
    failureAt(500);

    const result = pruneChecks(0);

    expect(result).toEqual({ errorsDeleted: 0, downsampled: 0, vacuumed: false });
    expect(countChecks(watchId)).toBe(7);
  });

  it('handles availability-mode rows that carry no price', () => {
    for (let hour = 8; hour < 14; hour++) checkAt(200, null, hour);

    pruneChecks(90);

    // Nothing to rank by, but the day must not vanish outright.
    const remaining = countChecks(watchId);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(6);
  });

  it('is idempotent — a second pass finds nothing left to do', () => {
    for (let hour = 0; hour < 10; hour++) checkAt(200, 100 + hour, hour);

    pruneChecks(90);
    const second = pruneChecks(90);

    expect(second.downsampled).toBe(0);
    expect(second.errorsDeleted).toBe(0);
  });
});
