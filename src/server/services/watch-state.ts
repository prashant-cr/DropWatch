/** Assembles the dashboard view-model for a watch. */

import type { Watch, WatchWithState } from '../../shared/types.js';
import { SPARKLINE_DAYS } from '../../core/constants.js';
import { nextRunFor } from '../../core/scheduler.js';
import {
  consecutiveFailures,
  lastSuccessfulCheckBefore,
  latestCheck,
  priceHistory,
} from '../db/checks.js';

export function withState(watch: Watch): WatchWithState {
  const lastCheck = latestCheck(watch.id);
  const previous = lastCheck ? lastSuccessfulCheckBefore(watch.id, lastCheck.id) : null;

  return {
    ...watch,
    last_check: lastCheck,
    previous_price: previous?.price ?? null,
    next_check_at: nextRunFor(watch),
    consecutive_failures: consecutiveFailures(watch.id),
    is_blocked: lastCheck?.status === 'error' && lastCheck.error_kind === 'blocked',
    sparkline: priceHistory(watch.id, SPARKLINE_DAYS),
  };
}
