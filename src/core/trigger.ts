/**
 * Decides whether a completed check should fire an alert.
 *
 * Pure and side-effect free so every edge case is unit-testable. The rules:
 *
 *  - **Edge-triggered, not level-triggered.** A price alert fires on the crossing
 *    from above target to at-or-below target, and re-arms when the price climbs
 *    back above. A price that simply *stays* below target never re-alerts.
 *  - **Availability** fires on the `unavailable -> available` transition only.
 *  - **Failed checks never alert**, and never change the armed state — a network
 *    blip must not re-arm a watch and cause a duplicate alert on recovery. That is
 *    why the baseline is the last *successful* check rather than the previous row.
 *  - **No prior successful check** counts as "not yet satisfied", so a condition
 *    that is already true on the first check does alert. Watches created through
 *    the UI are seeded with the price detected at add time, so in practice this
 *    only fires when detection failed at creation — better one email than silence.
 */

import { CONSECUTIVE_FAILURES_BEFORE_ALERT } from './constants.js';
import type { AlertKind, CheckStatus, WatchMode } from '../shared/types.js';

export interface CheckState {
  price: number | null;
  available: boolean | null;
}

export interface TriggerContext {
  mode: WatchMode;
  targetPrice: number | null;
  current: CheckState & { status: CheckStatus };
  /** The last successful check before the current one, or null if there is none. */
  previous: CheckState | null;
}

export interface TriggerResult {
  fire: boolean;
  kind: AlertKind | null;
  /** Why the decision went the way it did — surfaced in logs and tests. */
  reason: string;
}

const no = (reason: string): TriggerResult => ({ fire: false, kind: null, reason });

export function evaluateTrigger(context: TriggerContext): TriggerResult {
  const { mode, targetPrice, current, previous } = context;

  if (current.status !== 'ok') return no('check failed');

  if (mode === 'price') {
    if (targetPrice === null) return no('no target price set');
    if (current.price === null) return no('no price found in this check');

    if (current.price > targetPrice) return no('price is above target');

    // Armed unless the previous successful check was already at or below target.
    const wasSatisfied =
      previous?.price !== null && previous?.price !== undefined
        ? previous.price <= targetPrice
        : false;
    if (wasSatisfied) return no('price was already at or below target');

    return { fire: true, kind: 'price', reason: 'price crossed below target' };
  }

  if (current.available !== true) return no('item is not available');

  const wasAvailable = previous?.available === true;
  if (wasAvailable) return no('item was already available');

  return { fire: true, kind: 'availability', reason: 'item came back in stock' };
}

export interface FailureAlertContext {
  consecutiveFailures: number;
  /** Whether the failure notice already went out during this run of failures. */
  alreadyNotified: boolean;
}

/**
 * Exactly one "your check is failing" email per outage, once the failures reach the
 * threshold. Resets implicitly when a check succeeds, because the caller derives
 * both inputs from the checks since the last success.
 */
export function shouldSendFailureAlert(context: FailureAlertContext): boolean {
  return (
    context.consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_ALERT && !context.alreadyNotified
  );
}
