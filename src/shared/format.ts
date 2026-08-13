/** Formatting helpers shared by the server (email bodies) and the web UI. */

export function formatMoney(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatPercent(delta: number): string {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

/** Percentage change from `from` to `to`, or null when it cannot be computed. */
export function percentChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}

const UNITS: Array<[limit: number, seconds: number, name: Intl.RelativeTimeFormatUnit]> = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86400, 3600, 'hour'],
  [2592000, 86400, 'day'],
  [31536000, 2592000, 'month'],
  [Number.POSITIVE_INFINITY, 31536000, 'year'],
];

/** "12m ago", "in 48m". Returns "—" for missing timestamps. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '—';

  const diffSeconds = (timestamp - now) / 1000;
  const absolute = Math.abs(diffSeconds);
  if (absolute < 45) return diffSeconds >= 0 ? 'in a moment' : 'just now';

  const unit = UNITS.find(([limit]) => absolute < limit) ?? UNITS[UNITS.length - 1]!;
  const [, seconds, name] = unit;
  const value = Math.round(diffSeconds / seconds);

  try {
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, name);
  } catch {
    return `${Math.abs(value)} ${name}${Math.abs(value) === 1 ? '' : 's'} ${value < 0 ? 'ago' : 'from now'}`;
  }
}

/**
 * Compact relative time for dense UI: "12m ago", "in 48m", "3d ago". Dashboard
 * cards show two of these on one line, so the long Intl phrasing does not fit.
 */
export function formatRelativeShort(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '—';

  const seconds = (timestamp - now) / 1000;
  const future = seconds > 0;
  const absolute = Math.abs(seconds);

  if (absolute < 45) return future ? 'in a moment' : 'just now';

  const amount =
    absolute < 3600
      ? `${Math.round(absolute / 60)}m`
      : absolute < 86400
        ? `${Math.round(absolute / 3600)}h`
        : absolute < 2592000
          ? `${Math.round(absolute / 86400)}d`
          : `${Math.round(absolute / 2592000)}mo`;

  return future ? `in ${amount}` : `${amount} ago`;
}

export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toISOString();
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Hostname without `www.`, used as the store name on cards. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function faviconUrl(url: string): string | null {
  try {
    return new URL('/favicon.ico', url).toString();
  } catch {
    return null;
  }
}
