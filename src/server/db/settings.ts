import type { AppSettings } from '../../shared/types.js';
import { DEFAULT_INTERVAL_CRON } from '../../shared/intervals.js';
import { getDb } from './index.js';

function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function defaultSettings(): AppSettings {
  return {
    smtp_host: '',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: '',
    smtp_pass: '',
    smtp_from: '',
    alert_to: '',
    default_interval_cron: DEFAULT_INTERVAL_CRON,
    timezone: systemTimezone(),
    currency: 'USD',
    onboarding_dismissed: false,
  };
}

export function getRaw(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function setRaw(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function getSettings(): AppSettings {
  const defaults = defaultSettings();
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const result = { ...defaults } as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(defaults)) {
    const raw = stored.get(key);
    if (raw === undefined) continue;
    if (typeof fallback === 'number') {
      const parsed = Number(raw);
      result[key] = Number.isFinite(parsed) ? parsed : fallback;
    } else if (typeof fallback === 'boolean') {
      result[key] = raw === 'true' || raw === '1';
    } else {
      result[key] = raw;
    }
  }
  return result as unknown as AppSettings;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const allowed = new Set(Object.keys(defaultSettings()));
  const write = getDb().transaction((entries: Array<[string, string]>) => {
    for (const [key, value] of entries) setRaw(key, value);
  });

  const entries = Object.entries(patch)
    .filter(([key, value]) => allowed.has(key) && value !== undefined)
    .map(([key, value]): [string, string] => [key, String(value)]);

  write(entries);
  return getSettings();
}

/** Email can only be sent once a host and a destination address exist. */
export function isEmailConfigured(settings: AppSettings = getSettings()): boolean {
  return settings.smtp_host.trim() !== '' && settings.alert_to.trim() !== '';
}
