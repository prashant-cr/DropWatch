/** Tunables shared across the core. */

/** Failed checks in a row before PriceWatch emails the user about it (once). */
export const CONSECUTIVE_FAILURES_BEFORE_ALERT = 3;

/** Days of history shown on a dashboard sparkline. */
export const SPARKLINE_DAYS = 30;

/** Upper bound on how long a single check may take, including retries. */
export const CHECK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Maximum random delay added to a watch's first scheduled run so that watches
 * created together do not all fire at the same second.
 */
export const SCHEDULE_JITTER_MS = 45_000;
