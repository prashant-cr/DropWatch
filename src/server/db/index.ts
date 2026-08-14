import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));

let instance: Db | null = null;

/** Absolute path of the SQLite file, honouring `DROPWATCH_DATA_DIR`. */
export function databasePath(): string {
  if (process.env.DROPWATCH_DB) return resolve(process.env.DROPWATCH_DB);
  const dir = resolve(process.env.DROPWATCH_DATA_DIR ?? 'data');
  const target = resolve(dir, 'dropwatch.db');

  // The project was renamed from PriceWatch; keep using an existing pricewatch.db
  // rather than silently starting over with an empty database.
  if (!existsSync(target)) {
    const legacy = resolve(dir, 'pricewatch.db');
    if (existsSync(legacy)) return legacy;
  }
  return target;
}

/**
 * Opens (and on first call creates) the database, applying the schema. Safe to
 * call repeatedly — subsequent calls return the same connection.
 *
 * Pass `:memory:` for tests.
 */
export function initDb(file?: string): Db {
  if (instance) return instance;

  const target = file ?? databasePath();
  if (target !== ':memory:') mkdirSync(dirname(target), { recursive: true });

  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  if (target !== ':memory:') restrictPermissions(target);

  instance = db;
  return db;
}

/**
 * Locks the database down to the owner.
 *
 * The SMTP password is stored in this file in plain text — it has to be, since
 * DropWatch needs the original to authenticate to the mail server, and there is no
 * second secret to encrypt it with on a zero-config local tool. What we can do is
 * make sure other accounts on the machine cannot read it, which the default 0644
 * would happily allow.
 *
 * Best-effort: chmod is meaningless on Windows and may fail on exotic filesystems,
 * and neither case is worth refusing to start over.
 */
function restrictPermissions(target: string): void {
  // WAL mode keeps two sidecar files next to the database; they hold recently
  // written pages, so leaving them world-readable would defeat the exercise.
  for (const file of [target, `${target}-wal`, `${target}-shm`]) {
    try {
      if (existsSync(file)) chmodSync(file, 0o600);
    } catch {
      // Non-POSIX filesystem or no permission to change it — carry on.
    }
  }
}

export function getDb(): Db {
  if (!instance) return initDb();
  return instance;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/** SQLite has no boolean type; we store 0/1 and convert at the edges. */
export function toBool(value: number | null): boolean | null {
  if (value === null || value === undefined) return null;
  return value === 1;
}

export function fromBool(value: boolean | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value ? 1 : 0;
}

/** ISO-8601 UTC timestamp in the same format the schema defaults produce. */
export function nowIso(): string {
  return new Date().toISOString();
}
