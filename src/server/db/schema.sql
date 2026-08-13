-- PriceWatch schema. Applied on every boot; every statement is idempotent so this
-- doubles as the migration for a fresh database.

CREATE TABLE IF NOT EXISTS watches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  url               TEXT    NOT NULL,
  label             TEXT    NOT NULL DEFAULT '',
  selector_override TEXT,
  target_price      REAL,
  mode              TEXT    NOT NULL DEFAULT 'price' CHECK (mode IN ('price', 'availability')),
  interval_cron     TEXT    NOT NULL DEFAULT '0 * * * *',
  currency          TEXT    NOT NULL DEFAULT 'USD',
  is_paused         INTEGER NOT NULL DEFAULT 0 CHECK (is_paused IN (0, 1)),
  last_strategy     TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id      INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  checked_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  price         REAL,
  available     INTEGER CHECK (available IN (0, 1)),
  status        TEXT    NOT NULL CHECK (status IN ('ok', 'error')),
  error_kind    TEXT    CHECK (error_kind IN ('blocked', 'timeout', 'not_found', 'network', 'unknown')),
  error_message TEXT,
  duration_ms   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_checks_watch_time ON checks (watch_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  check_id INTEGER REFERENCES checks(id) ON DELETE SET NULL,
  kind     TEXT    NOT NULL CHECK (kind IN ('price', 'availability', 'failure')),
  channel  TEXT    NOT NULL,
  sent_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  message  TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_alerts_watch_time ON alerts (watch_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
