import { describe, expect, it } from 'vitest';
import {
  isValidCron,
  minIntervalMinutes,
  nextRun,
  parseCron,
  validateSchedule,
} from '../src/core/cron.js';
import { INTERVAL_PRESETS, MIN_INTERVAL_MINUTES } from '../src/shared/intervals.js';

describe('parseCron', () => {
  it('expands wildcards', () => {
    const fields = parseCron('* * * * *');
    expect(fields.minutes.size).toBe(60);
    expect(fields.hours.size).toBe(24);
    expect(fields.restrictsDayOfMonth).toBe(false);
  });

  it('expands steps', () => {
    expect([...parseCron('*/15 * * * *').minutes]).toEqual([0, 15, 30, 45]);
  });

  it('expands ranges and lists', () => {
    expect([...parseCron('0 9-11 * * *').hours]).toEqual([9, 10, 11]);
    expect([...parseCron('0 0,12 * * *').hours]).toEqual([0, 12]);
  });

  it('expands a stepped range', () => {
    expect([...parseCron('0 0-23/6 * * *').hours]).toEqual([0, 6, 12, 18]);
  });

  it('accepts names for months and weekdays', () => {
    expect([...parseCron('0 9 * jan mon').months]).toEqual([1]);
    expect([...parseCron('0 9 * jan mon').daysOfWeek]).toEqual([1]);
  });

  it('treats 7 as Sunday', () => {
    expect([...parseCron('0 9 * * 7').daysOfWeek]).toEqual([0]);
  });

  it('drops a leading seconds field', () => {
    expect([...parseCron('30 */15 * * * *').minutes]).toEqual([0, 15, 30, 45]);
  });

  it('rejects malformed expressions', () => {
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('* * * *')).toBe(false);
    expect(isValidCron('60 * * * *')).toBe(false);
    expect(isValidCron('*/0 * * * *')).toBe(false);
  });
});

describe('nextRun', () => {
  it('finds the next quarter hour', () => {
    const from = new Date('2026-03-10T10:07:30Z');
    const next = nextRun('*/15 * * * *', from, 'UTC');
    expect(next?.toISOString()).toBe('2026-03-10T10:15:00.000Z');
  });

  it('rolls to the next hour', () => {
    const next = nextRun('0 * * * *', new Date('2026-03-10T10:07:00Z'), 'UTC');
    expect(next?.toISOString()).toBe('2026-03-10T11:00:00.000Z');
  });

  it('rolls to the next day for a daily schedule', () => {
    const next = nextRun('0 9 * * *', new Date('2026-03-10T10:00:00Z'), 'UTC');
    expect(next?.toISOString()).toBe('2026-03-11T09:00:00.000Z');
  });

  it('is always strictly in the future, never the current minute', () => {
    const from = new Date('2026-03-10T10:00:00Z');
    expect(nextRun('0 * * * *', from, 'UTC')?.toISOString()).toBe('2026-03-10T11:00:00.000Z');
  });

  it('honours the requested timezone', () => {
    // 09:00 in Tokyo is 00:00 UTC.
    const next = nextRun('0 9 * * *', new Date('2026-03-10T10:00:00Z'), 'Asia/Tokyo');
    expect(next?.toISOString()).toBe('2026-03-11T00:00:00.000Z');
  });

  it('ORs day-of-month with day-of-week, as cron does', () => {
    // The 1st of the month, or any Monday.
    const next = nextRun('0 0 1 * mon', new Date('2026-03-03T12:00:00Z'), 'UTC');
    expect(next?.toISOString()).toBe('2026-03-09T00:00:00.000Z'); // the next Monday
  });

  it('returns null for a schedule that never runs', () => {
    expect(nextRun('0 0 30 2 *', new Date('2026-03-10T10:00:00Z'), 'UTC')).toBeNull();
  });

  it('returns null for an invalid expression', () => {
    expect(nextRun('nope', new Date(), 'UTC')).toBeNull();
  });
});

describe('minIntervalMinutes', () => {
  it('measures the gap for a stepped schedule', () => {
    expect(minIntervalMinutes('*/15 * * * *', 6, 'UTC')).toBe(15);
  });

  it('measures the gap for an hourly schedule', () => {
    expect(minIntervalMinutes('0 * * * *', 6, 'UTC')).toBe(60);
  });

  it('catches an uneven list where two firings are close together', () => {
    expect(minIntervalMinutes('0,5 * * * *', 6, 'UTC')).toBe(5);
  });
});

describe('validateSchedule — the politeness floor', () => {
  it('accepts every preset the UI offers', () => {
    for (const preset of INTERVAL_PRESETS) {
      expect(validateSchedule(preset.cron, 'UTC'), preset.id).toEqual({ ok: true });
    }
  });

  it('rejects anything faster than the floor', () => {
    const result = validateSchedule('*/5 * * * *', 'UTC');
    expect(result.ok).toBe(false);
    expect(result.message).toContain(String(MIN_INTERVAL_MINUTES));
  });

  it('rejects every-minute schedules', () => {
    expect(validateSchedule('* * * * *', 'UTC').ok).toBe(false);
  });

  it('rejects a list that sneaks two firings close together', () => {
    expect(validateSchedule('0,5,30 * * * *', 'UTC').ok).toBe(false);
  });

  it('accepts a custom schedule at exactly the floor', () => {
    expect(validateSchedule('*/15 * * * *', 'UTC').ok).toBe(true);
  });

  it('rejects invalid syntax with a readable message', () => {
    const result = validateSchedule('every 5 minutes', 'UTC');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not a valid cron expression');
  });
});
