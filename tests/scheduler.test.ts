import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, initDb } from '../src/server/db/index.js';
import { createWatch, deleteWatch, updateWatch, type NewWatch } from '../src/server/db/watches.js';
import {
  nextRunFor,
  runMaintenance,
  scheduledWatchIds,
  startScheduler,
  stopScheduler,
  syncWatch,
} from '../src/core/scheduler.js';
import { getWatch } from '../src/server/db/watches.js';
import { countChecks, recordCheck } from '../src/server/db/checks.js';
import { updateSettings } from '../src/server/db/settings.js';

function newWatch(overrides: Partial<NewWatch> = {}) {
  return createWatch({
    url: 'https://store.example.com/p/1',
    label: 'Test watch',
    mode: 'price',
    target_price: 100,
    interval_cron: '0 * * * *',
    currency: 'USD',
    selector_override: null,
    ...overrides,
  });
}

beforeEach(() => {
  initDb(':memory:');
});

afterEach(() => {
  // node-cron timers keep the process alive; always tear them down.
  stopScheduler();
  closeDb();
});

describe('registration', () => {
  it('schedules an active watch', () => {
    const watch = newWatch();
    syncWatch(watch.id);
    expect(scheduledWatchIds()).toEqual([watch.id]);
  });

  it('does not schedule a paused watch', () => {
    const watch = newWatch();
    updateWatch(watch.id, { is_paused: true });
    syncWatch(watch.id);
    expect(scheduledWatchIds()).toEqual([]);
  });

  it('does not schedule a watch whose cron is invalid', () => {
    const watch = newWatch();
    // Bypass the API's validation to simulate a hand-edited database.
    updateWatch(watch.id, { interval_cron: 'not a cron' });
    syncWatch(watch.id);
    expect(scheduledWatchIds()).toEqual([]);
  });
});

describe('re-registration', () => {
  it('replaces the job when the schedule changes, without duplicating it', () => {
    const watch = newWatch();
    syncWatch(watch.id);
    updateWatch(watch.id, { interval_cron: '*/15 * * * *' });
    syncWatch(watch.id);

    expect(scheduledWatchIds()).toEqual([watch.id]);
  });

  it('unregisters on pause and re-registers on resume', () => {
    const watch = newWatch();
    syncWatch(watch.id);

    updateWatch(watch.id, { is_paused: true });
    syncWatch(watch.id);
    expect(scheduledWatchIds()).toEqual([]);

    updateWatch(watch.id, { is_paused: false });
    syncWatch(watch.id);
    expect(scheduledWatchIds()).toEqual([watch.id]);
  });

  it('unregisters a deleted watch', () => {
    const watch = newWatch();
    syncWatch(watch.id);

    deleteWatch(watch.id);
    syncWatch(watch.id);
    expect(scheduledWatchIds()).toEqual([]);
  });

  it('is idempotent when called repeatedly', () => {
    const watch = newWatch();
    for (let i = 0; i < 5; i++) syncWatch(watch.id);
    expect(scheduledWatchIds()).toEqual([watch.id]);
  });
});

describe('startScheduler', () => {
  it('registers every active watch and skips paused ones', () => {
    const first = newWatch({ url: 'https://a.example.com/p' });
    const second = newWatch({ url: 'https://b.example.com/p' });
    const paused = newWatch({ url: 'https://c.example.com/p' });
    updateWatch(paused.id, { is_paused: true });

    startScheduler();

    expect(scheduledWatchIds().sort()).toEqual([first.id, second.id].sort());
  });

  it('clears previous registrations rather than stacking them', () => {
    newWatch();
    startScheduler();
    startScheduler();
    expect(scheduledWatchIds()).toHaveLength(1);
  });
});

describe('nextRunFor', () => {
  it('returns a future timestamp for an active watch', () => {
    const watch = newWatch({ interval_cron: '*/15 * * * *' });
    const next = nextRunFor(watch);
    expect(next).not.toBeNull();
    expect(Date.parse(next!)).toBeGreaterThan(Date.now());
  });

  it('returns null for a paused watch', () => {
    const watch = newWatch();
    updateWatch(watch.id, { is_paused: true });
    const paused = getWatch(watch.id);
    expect(nextRunFor(paused!)).toBeNull();
  });

  it('returns null when the cron is unparseable', () => {
    const watch = newWatch();
    updateWatch(watch.id, { interval_cron: 'nonsense' });
    expect(nextRunFor(getWatch(watch.id)!)).toBeNull();
  });

  it('is stable across calls, so the dashboard countdown does not jump', () => {
    const watch = newWatch({ interval_cron: '0 * * * *' });
    expect(nextRunFor(watch)).toBe(nextRunFor(watch));
  });
});

describe('maintenance', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  const oldCheck = (watchId: number, price: number, daysAgo: number, hour: number) => {
    const at = new Date(Date.now() - daysAgo * DAY_MS);
    at.setUTCHours(hour, 0, 0, 0);
    return recordCheck({
      watch_id: watchId,
      price,
      available: true,
      status: 'ok',
      duration_ms: 1,
      checked_at: at.toISOString(),
    });
  };

  it('prunes using the configured retention window', () => {
    const watch = newWatch();
    oldCheck(watch.id, 120, 200, 8);
    oldCheck(watch.id, 90, 200, 9);
    oldCheck(watch.id, 150, 200, 10);
    oldCheck(watch.id, 130, 200, 11);

    runMaintenance();

    expect(countChecks(watch.id)).toBe(3);
  });

  it('leaves history alone when retention is turned off', () => {
    updateSettings({ retention_days: 0 });
    const watch = newWatch();
    for (let hour = 8; hour < 14; hour++) oldCheck(watch.id, 100 + hour, 200, hour);

    runMaintenance();

    expect(countChecks(watch.id)).toBe(6);
  });

  it('survives a failure instead of taking the scheduler down with it', () => {
    // Pull the table out from under the prune. Deliberately not closeDb(): a closed
    // handle makes the next getDb() open the real on-disk database, which no test
    // should ever touch.
    getDb().exec('DROP TABLE checks');

    expect(() => {
      runMaintenance();
    }).not.toThrow();
  });
});
