import type { WatchWithState } from '@shared/types';
import { CONSECUTIVE_FAILURES_BEFORE_ALERT } from '../core/constants';

export type StatusTone = 'good' | 'warn' | 'bad' | 'muted' | 'neutral';

export interface WatchStatus {
  tone: StatusTone;
  label: string;
  /** Longer explanation shown on the detail page and as a tooltip. */
  detail?: string;
  /** Condensed form of `detail` for the space-constrained dashboard card. */
  short?: string;
}

/** Single source of truth for the status pill, so cards and detail pages agree. */
export function watchStatus(watch: WatchWithState, isChecking = false): WatchStatus {
  if (isChecking) return { tone: 'neutral', label: 'Checking…' };
  if (watch.is_paused)
    return { tone: 'muted', label: 'Paused', detail: 'This watch is not being checked.' };

  if (watch.is_blocked) {
    return {
      tone: 'bad',
      label: 'Blocked by site',
      detail:
        'This site blocks automated checking. PriceWatch will not try to get around that — ' +
        'check the page manually, or use the store’s own price-alert feature.',
      short: 'This site blocks automated checking. Check it manually instead.',
    };
  }

  if (watch.consecutive_failures >= CONSECUTIVE_FAILURES_BEFORE_ALERT) {
    return {
      tone: 'bad',
      label: 'Check failing',
      detail: watch.last_check?.error_message ?? 'The last few checks did not succeed.',
      short: `${watch.consecutive_failures} checks in a row have failed.`,
    };
  }

  if (watch.last_check?.status === 'error') {
    return {
      tone: 'warn',
      label: 'Last check failed',
      detail: watch.last_check.error_message ?? undefined,
    };
  }

  if (!watch.last_check) {
    return { tone: 'neutral', label: 'Not checked yet', detail: 'The first check has not run.' };
  }

  if (watch.mode === 'availability') {
    return watch.last_check.available
      ? { tone: 'good', label: 'In stock' }
      : { tone: 'muted', label: 'Out of stock', detail: 'You will be alerted when it returns.' };
  }

  if (watch.last_check.available === false) {
    return { tone: 'muted', label: 'Out of stock' };
  }

  if (
    watch.target_price !== null &&
    watch.last_check.price !== null &&
    watch.last_check.price <= watch.target_price
  ) {
    return { tone: 'good', label: 'Below target' };
  }

  return { tone: 'neutral', label: 'Tracking' };
}

export const TONE_CLASSES: Record<StatusTone, string> = {
  good: 'bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300',
  warn: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  bad: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  muted: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-400',
  neutral: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
};
