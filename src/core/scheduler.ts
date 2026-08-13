/**
 * Owns the cron registrations, one per active watch.
 *
 * Two rules govern everything here:
 *  1. The loop never dies. Every tick is wrapped; `runCheck` already swallows its own
 *     errors, and anything that still escapes is logged and dropped.
 *  2. Watches never pile up. A watch that is still being checked skips its next tick
 *     instead of running twice in parallel.
 */

import cron, { type ScheduledTask } from 'node-cron';
import type { Watch } from '../shared/types.js';
import { getWatch, listWatches } from '../server/db/watches.js';
import { getSettings } from '../server/db/settings.js';
import { runCheck } from './checker.js';
import { nextRun } from './cron.js';
import { SCHEDULE_JITTER_MS } from './constants.js';

interface Job {
  task: ScheduledTask;
  cronExpression: string;
}

const jobs = new Map<number, Job>();
const running = new Set<number>();

/** Watch IDs with a check in flight — the UI shows these as "checking…". */
export function runningWatchIds(): number[] {
  return [...running];
}

export function isChecking(watchId: number): boolean {
  return running.has(watchId);
}

/**
 * Runs one check, guarding against overlap. Safe to call from a cron tick or from
 * the "run check now" endpoint.
 */
export async function checkWatch(watchId: number, options: { immediate?: boolean } = {}) {
  if (running.has(watchId)) return null;
  const watch = getWatch(watchId);
  if (!watch) return null;

  running.add(watchId);
  try {
    return await runCheck(watch, options);
  } catch (error) {
    // runCheck is not supposed to throw; if it ever does, keep the loop alive.
    console.error(`[pricewatch] check for watch ${watchId} threw:`, error);
    return null;
  } finally {
    running.delete(watchId);
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Spreads the load: watches sharing a schedule (the common case, since they come
 * from presets) start up to {@link SCHEDULE_JITTER_MS} apart instead of together.
 */
function jitterFor(watchId: number): number {
  // Deterministic per watch so a watch keeps its slot across restarts.
  const hash = Math.imul(watchId ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return (hash % SCHEDULE_JITTER_MS) | 0;
}

/** Registers (or re-registers) the cron job for one watch. */
export function scheduleWatch(watch: Watch): void {
  unscheduleWatch(watch.id);
  if (watch.is_paused) return;

  if (!cron.validate(watch.interval_cron)) {
    console.error(
      `[pricewatch] watch ${watch.id} has an invalid schedule "${watch.interval_cron}"; not scheduled.`,
    );
    return;
  }

  const task = cron.schedule(
    watch.interval_cron,
    () => {
      void (async () => {
        try {
          await sleep(jitterFor(watch.id));
          await checkWatch(watch.id);
        } catch (error) {
          console.error(`[pricewatch] scheduled check for watch ${watch.id} failed:`, error);
        }
      })();
    },
    { scheduled: true },
  );

  jobs.set(watch.id, { task, cronExpression: watch.interval_cron });
}

export function unscheduleWatch(watchId: number): void {
  const job = jobs.get(watchId);
  if (!job) return;
  job.task.stop();
  jobs.delete(watchId);
}

/**
 * Re-reads a watch from the database and brings its registration in line. Call after
 * any create/update/delete — this is what keeps cron state and DB state in sync.
 */
export function syncWatch(watchId: number): void {
  const watch = getWatch(watchId);
  if (!watch) {
    unscheduleWatch(watchId);
    return;
  }
  scheduleWatch(watch);
}

/** Registers every watch. Called once at boot. */
export function startScheduler(): void {
  stopScheduler();
  for (const watch of listWatches()) scheduleWatch(watch);
  console.log(`[pricewatch] scheduled ${jobs.size} watch(es)`);
}

export function stopScheduler(): void {
  for (const id of [...jobs.keys()]) unscheduleWatch(id);
}

export function scheduledWatchIds(): number[] {
  return [...jobs.keys()];
}

/** ISO timestamp of the next run, or null for paused / unschedulable watches. */
export function nextRunFor(watch: Watch): string | null {
  if (watch.is_paused) return null;
  const timezone = getSettings().timezone;
  const next = nextRun(watch.interval_cron, new Date(), timezone);
  if (!next) return null;
  return new Date(next.getTime() + jitterFor(watch.id)).toISOString();
}
