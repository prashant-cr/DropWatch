/**
 * Types shared between the server and the web UI.
 *
 * Snake_case fields mirror the SQLite column names exactly so the DB helpers can
 * hand rows straight to the API without a mapping layer.
 */

export type WatchMode = 'price' | 'availability';

export type CheckStatus = 'ok' | 'error';

/**
 * Why a check failed. Kept separate from {@link CheckStatus} so the UI can show a
 * specific message (notably `blocked`, which is never the user's fault to fix by
 * retrying) without widening the status enum.
 */
export type CheckErrorKind = 'blocked' | 'timeout' | 'not_found' | 'network' | 'unknown';

export type AlertKind = 'price' | 'availability' | 'failure';

export interface Watch {
  id: number;
  url: string;
  label: string;
  /** User-supplied CSS selector that overrides automatic price detection. */
  selector_override: string | null;
  target_price: number | null;
  mode: WatchMode;
  interval_cron: string;
  currency: string;
  is_paused: boolean;
  /** Extraction strategy that worked last time, cached to make later checks cheap. */
  last_strategy: string | null;
  created_at: string;
}

export interface Check {
  id: number;
  watch_id: number;
  checked_at: string;
  price: number | null;
  available: boolean | null;
  status: CheckStatus;
  error_kind: CheckErrorKind | null;
  error_message: string | null;
  duration_ms: number;
}

export interface Alert {
  id: number;
  watch_id: number;
  check_id: number | null;
  kind: AlertKind;
  channel: string;
  sent_at: string;
  message: string;
}

/** One point on a sparkline / history chart. */
export interface PricePoint {
  checked_at: string;
  price: number | null;
  available: boolean | null;
}

/** A watch plus everything the dashboard needs to render its card. */
export interface WatchWithState extends Watch {
  last_check: Check | null;
  /** Most recent successful check before `last_check`, used to show price movement. */
  previous_price: number | null;
  next_check_at: string | null;
  consecutive_failures: number;
  /** True when the last check failed because the site blocks automated access. */
  is_blocked: boolean;
  sparkline: PricePoint[];
}

/** Result of extracting product data from a page. */
export interface ExtractResult {
  price: number | null;
  currency: string | null;
  available: boolean | null;
  title: string | null;
  /** Name of the strategy that produced this result. */
  strategy: string;
}

/** Response from `POST /api/detect` — the add-watch modal's "detecting…" step. */
export interface DetectResponse {
  ok: boolean;
  url: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  available: boolean | null;
  strategy: string | null;
  favicon: string | null;
  error_kind: CheckErrorKind | null;
  error_message: string | null;
}

export interface SmtpSettings {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
  alert_to: string;
}

export interface AppSettings extends SmtpSettings {
  default_interval_cron: string;
  timezone: string;
  currency: string;
  /** Dismissed by the user once email is configured or explicitly skipped. */
  onboarding_dismissed: boolean;
}

/**
 * Settings as returned by the API. The SMTP password is never sent back to the
 * client; the UI only learns whether one is stored.
 */
export type SettingsResponse = Omit<AppSettings, 'smtp_pass'> & { smtp_pass_set: boolean };

export interface CreateWatchInput {
  url: string;
  label?: string;
  mode: WatchMode;
  target_price?: number | null;
  interval_cron?: string;
  currency?: string;
  selector_override?: string | null;
}

export type UpdateWatchInput = Partial<CreateWatchInput> & { is_paused?: boolean };

export interface ApiError {
  error: string;
  message: string;
}
