/**
 * A small 5-field cron parser.
 *
 * node-cron runs the jobs but does not expose "when does this fire next", which the
 * dashboard needs for its "next check in 48m" line, and which we also use to reject
 * custom expressions that would check more often than the 15-minute floor.
 *
 * Supports the standard syntax: wildcards, single values, ranges, stepped ranges
 * and comma-separated lists — `*`, `n`, `a-b`, `a-b/n`, and a wildcard with a step.
 */

import { MIN_INTERVAL_MINUTES } from '../shared/intervals.js';

export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** Cron ORs day-of-month and day-of-week when both are restricted. */
  restrictsDayOfMonth: boolean;
  restrictsDayOfWeek: boolean;
}

const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 6],
} as const;

const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export class CronParseError extends Error {}

function parseField(
  raw: string,
  [min, max]: readonly [number, number],
  names: readonly string[] = [],
): Set<number> {
  const values = new Set<number>();

  for (const part of raw.split(',')) {
    const [rangeText, stepText] = part.split('/');
    if (rangeText === undefined || rangeText === '') {
      throw new CronParseError(`Invalid cron field: "${raw}"`);
    }

    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) {
      throw new CronParseError(`Invalid step in cron field: "${part}"`);
    }

    let from: number;
    let to: number;
    if (rangeText === '*') {
      from = min;
      to = max;
    } else if (rangeText.includes('-')) {
      const [a, b] = rangeText.split('-');
      from = toNumber(a, names);
      to = toNumber(b, names);
    } else {
      from = toNumber(rangeText, names);
      to = stepText === undefined ? from : max;
    }

    if (from < min || to > max || from > to) {
      throw new CronParseError(`Cron value out of range: "${part}" (expected ${min}-${max})`);
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }

  if (values.size === 0) throw new CronParseError(`Empty cron field: "${raw}"`);
  return values;
}

function toNumber(token: string | undefined, names: readonly string[]): number {
  if (token === undefined) throw new CronParseError('Missing cron value');
  const named = names.indexOf(token.toLowerCase());
  if (named >= 0) return named + (names === MONTH_NAMES ? 1 : 0);
  const value = Number(token);
  if (!Number.isInteger(value)) throw new CronParseError(`Not a cron value: "${token}"`);
  return value;
}

export function parseCron(expression: string): CronFields {
  const fields = expression.trim().split(/\s+/);
  // Tolerate a 6-field expression with leading seconds by dropping the seconds.
  const [minute, hour, dayOfMonth, month, dayOfWeek] =
    fields.length === 6 ? fields.slice(1) : fields;

  if (fields.length !== 5 && fields.length !== 6) {
    throw new CronParseError(`Expected 5 fields, got ${fields.length}: "${expression}"`);
  }
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    throw new CronParseError(`Incomplete cron expression: "${expression}"`);
  }

  const daysOfWeek = parseField(normalizeSunday(dayOfWeek), RANGES.dayOfWeek, DAY_NAMES);

  return {
    minutes: parseField(minute, RANGES.minute),
    hours: parseField(hour, RANGES.hour),
    daysOfMonth: parseField(dayOfMonth, RANGES.dayOfMonth),
    months: parseField(month, RANGES.month, MONTH_NAMES),
    daysOfWeek,
    restrictsDayOfMonth: dayOfMonth !== '*',
    restrictsDayOfWeek: dayOfWeek !== '*',
  };
}

/** Cron accepts 7 as Sunday alongside 0. */
function normalizeSunday(field: string): string {
  return field.replace(/\b7\b/g, '0');
}

export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

interface Wall {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat | null {
  if (!timeZone) return null;
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatterCache.set(timeZone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

/** Wall-clock fields of `date` in `timeZone` (or the system zone when unset). */
function wallClock(date: Date, timeZone: string | undefined): Wall {
  const formatter = formatterFor(timeZone);
  if (!formatter) {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      dayOfMonth: date.getDate(),
      month: date.getMonth() + 1,
      dayOfWeek: date.getDay(),
    };
  }

  const parts = new Map(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = DAY_NAMES.indexOf((parts.get('weekday') ?? '').slice(0, 3).toLowerCase());
  let hour = Number(parts.get('hour') ?? 0);
  if (hour === 24) hour = 0; // some ICU builds render midnight as 24
  return {
    minute: Number(parts.get('minute') ?? 0),
    hour,
    dayOfMonth: Number(parts.get('day') ?? 1),
    month: Number(parts.get('month') ?? 1),
    dayOfWeek: weekday >= 0 ? weekday : 0,
  };
}

function dayMatches(fields: CronFields, wall: Wall): boolean {
  if (!fields.months.has(wall.month)) return false;

  const domMatch = fields.daysOfMonth.has(wall.dayOfMonth);
  const dowMatch = fields.daysOfWeek.has(wall.dayOfWeek);

  if (fields.restrictsDayOfMonth && fields.restrictsDayOfWeek) return domMatch || dowMatch;
  if (fields.restrictsDayOfMonth) return domMatch;
  if (fields.restrictsDayOfWeek) return dowMatch;
  return true;
}

const MINUTE_MS = 60_000;
/** Two years of minutes is more than enough for any expression that ever fires. */
const MAX_STEPS = 1500;

/**
 * The next time `expression` fires strictly after `from`, or null if it never does
 * within the search horizon (e.g. `0 0 30 2 *`).
 */
export function nextRun(
  expression: string,
  from: Date = new Date(),
  timeZone?: string,
): Date | null {
  let fields: CronFields;
  try {
    fields = parseCron(expression);
  } catch {
    return null;
  }

  // Start at the next whole minute.
  let cursor = new Date(Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS);

  for (let step = 0; step < MAX_STEPS; step++) {
    const wall = wallClock(cursor, timeZone);

    if (!dayMatches(fields, wall)) {
      // Jump to the start of the next day rather than walking every minute.
      cursor = new Date(cursor.getTime() + (1440 - (wall.hour * 60 + wall.minute)) * MINUTE_MS);
      continue;
    }
    if (!fields.hours.has(wall.hour)) {
      cursor = new Date(cursor.getTime() + (60 - wall.minute) * MINUTE_MS);
      continue;
    }
    if (!fields.minutes.has(wall.minute)) {
      cursor = new Date(cursor.getTime() + MINUTE_MS);
      continue;
    }
    return cursor;
  }
  return null;
}

/**
 * Smallest gap, in minutes, between consecutive firings — used to enforce the
 * politeness floor on custom expressions. Returns Infinity if it fires at most once.
 */
export function minIntervalMinutes(expression: string, samples = 20, timeZone?: string): number {
  let cursor = new Date();
  let previous: Date | null = null;
  let smallest = Number.POSITIVE_INFINITY;

  for (let i = 0; i < samples; i++) {
    const next = nextRun(expression, cursor, timeZone);
    if (!next) break;
    if (previous) {
      smallest = Math.min(smallest, (next.getTime() - previous.getTime()) / MINUTE_MS);
    }
    previous = next;
    cursor = next;
  }
  return smallest;
}

export interface CronValidation {
  ok: boolean;
  message?: string;
}

/** Validates syntax *and* the minimum-interval policy. */
export function validateSchedule(expression: string, timeZone?: string): CronValidation {
  if (!isValidCron(expression)) {
    return { ok: false, message: `"${expression}" is not a valid cron expression.` };
  }
  if (!nextRun(expression, new Date(), timeZone)) {
    return { ok: false, message: 'That schedule never runs.' };
  }
  const gap = minIntervalMinutes(expression, 20, timeZone);
  if (gap < MIN_INTERVAL_MINUTES) {
    return {
      ok: false,
      message:
        `That schedule would check every ${Math.round(gap)} minutes. ` +
        `PriceWatch enforces a minimum of ${MIN_INTERVAL_MINUTES} minutes to stay polite to stores.`,
    };
  }
  return { ok: true };
}
