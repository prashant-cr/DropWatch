import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, initDb } from '../src/server/db/index.js';
import { createWatch, deleteWatch, updateWatch, type NewWatch } from '../src/server/db/watches.js';
import {
  nextRunFor,
  scheduledWatchIds,
  startScheduler,
  stopScheduler,
  syncWatch,
} from '../src/core/scheduler.js';
import { getWatch } from '../src/server/db/watches.js';

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
