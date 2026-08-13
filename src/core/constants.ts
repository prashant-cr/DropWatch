/** Tunables shared across the core. */

/** Failed checks in a row before PriceWatch emails the user about it (once). */
export const CONSECUTIVE_FAILURES_BEFORE_ALERT = 3;

/** Days of history shown on a dashboard sparkline. */
export const SPARKLINE_DAYS = 30;

/**
 * A price this many times larger or smaller than the last known good one is treated
 * as a misread rather than a real change.
 *
 * Extraction is a heuristic over markup we do not control, and a store can restyle
 * its page overnight. Real prices do not move 20x; a number that does is the
 * extractor having latched onto a financing total or an unrelated element. Rejecting
 * it keeps one bad parse from firing a false "price dropped" email and from wrecking
 * the history chart. The threshold is deliberately loose — clearance stock at 90% off
 * is a 10x move and must still get through.
 */
export const IMPLAUSIBLE_PRICE_FACTOR = 20;

/** Upper bound on how long a single check may take, including retries. */
export const CHECK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Maximum random delay added to a watch's first scheduled run so that watches
 * created together do not all fire at the same second.
 */
export const SCHEDULE_JITTER_MS = 45_000;
