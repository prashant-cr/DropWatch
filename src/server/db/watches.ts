import type { Watch, WatchMode } from '../../shared/types.js';
import { fromBool, getDb, toBool } from './index.js';

interface WatchRow {
  id: number;
  url: string;
  label: string;
  selector_override: string | null;
  target_price: number | null;
  mode: string;
  interval_cron: string;
  currency: string;
  is_paused: number;
  last_strategy: string | null;
  created_at: string;
}

function mapWatch(row: WatchRow): Watch {
  return {
    id: row.id,
    url: row.url,
    label: row.label,
    selector_override: row.selector_override,
    target_price: row.target_price,
    mode: row.mode as WatchMode,
    interval_cron: row.interval_cron,
    currency: row.currency,
    is_paused: toBool(row.is_paused) ?? false,
    last_strategy: row.last_strategy,
    created_at: row.created_at,
  };
}

export function listWatches(): Watch[] {
  const rows = getDb()
    .prepare('SELECT * FROM watches ORDER BY created_at DESC')
    .all() as WatchRow[];
  return rows.map(mapWatch);
}

export function getWatch(id: number): Watch | null {
  const row = getDb().prepare('SELECT * FROM watches WHERE id = ?').get(id) as WatchRow | undefined;
  return row ? mapWatch(row) : null;
}

export interface NewWatch {
  url: string;
  label: string;
  mode: WatchMode;
  target_price: number | null;
  interval_cron: string;
  currency: string;
  selector_override: string | null;
}

export function createWatch(input: NewWatch): Watch {
  const info = getDb()
    .prepare(
      `INSERT INTO watches (url, label, mode, target_price, interval_cron, currency, selector_override)
       VALUES (@url, @label, @mode, @target_price, @interval_cron, @currency, @selector_override)`,
    )
    .run(input);
  const created = getWatch(Number(info.lastInsertRowid));
  if (!created) throw new Error('failed to read back created watch');
  return created;
}

/** Columns a client is allowed to change. */
const UPDATABLE = [
  'url',
  'label',
  'mode',
  'target_price',
  'interval_cron',
  'currency',
  'selector_override',
  'is_paused',
] as const;

type UpdatableColumn = (typeof UPDATABLE)[number];

export type WatchPatch = Partial<{
  url: string;
  label: string;
  mode: WatchMode;
  target_price: number | null;
  interval_cron: string;
  currency: string;
  selector_override: string | null;
  is_paused: boolean;
}>;

export function updateWatch(id: number, patch: WatchPatch): Watch | null {
  const entries = UPDATABLE.filter((col) => patch[col] !== undefined).map(
    (col): [UpdatableColumn, string | number | null] => {
      const value = patch[col];
      if (col === 'is_paused') return [col, fromBool(value as boolean) ?? 0];
      return [col, (value ?? null) as string | number | null];
    },
  );

  if (entries.length > 0) {
    const assignments = entries.map(([col]) => `${col} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    getDb()
      .prepare(`UPDATE watches SET ${assignments} WHERE id = ?`)
      .run(...values, id);
  }
  return getWatch(id);
}

/** Records which extraction strategy worked, so the next check can try it first. */
export function setLastStrategy(id: number, strategy: string | null): void {
  getDb().prepare('UPDATE watches SET last_strategy = ? WHERE id = ?').run(strategy, id);
}

export function deleteWatch(id: number): boolean {
  return getDb().prepare('DELETE FROM watches WHERE id = ?').run(id).changes > 0;
}
