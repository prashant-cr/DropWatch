/** Check-frequency presets offered in the UI, plus the project's rate-limit floor. */

/**
 * Hard floor on how often any watch may run. This is a politeness rule, not a
 * performance one — see the scraping policy in CLAUDE.md / the README FAQ.
 */
export const MIN_INTERVAL_MINUTES = 15;

export interface IntervalPreset {
  id: string;
  label: string;
  cron: string;
}

export const INTERVAL_PRESETS: IntervalPreset[] = [
  { id: '15m', label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { id: '1h', label: 'Every hour', cron: '0 * * * *' },
  { id: '6h', label: 'Every 6 hours', cron: '0 */6 * * *' },
  { id: '24h', label: 'Once a day', cron: '0 9 * * *' },
];

export const DEFAULT_INTERVAL_CRON = '0 * * * *';

export function presetForCron(cron: string): IntervalPreset | undefined {
  return INTERVAL_PRESETS.find((p) => p.cron === cron);
}

/** Human-readable description of a cron, falling back to the raw expression. */
export function describeCron(cron: string): string {
  return presetForCron(cron)?.label ?? `Custom (${cron})`;
}
