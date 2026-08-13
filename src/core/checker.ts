/**
 * Runs a single check end to end: fetch -> extract -> record -> compare -> alert.
 *
 * The contract the scheduler relies on: `runCheck` never throws. Every failure is
 * written to the `checks` table and returned as an error row, so one bad site can
 * never take down the scheduler loop.
 */

import type { Check, ExtractResult, Watch } from '../shared/types.js';
import { formatMoney, hostLabel } from '../shared/format.js';
import { failureAlertSentSinceLastSuccess, recordAlert } from '../server/db/alerts.js';
import {
  consecutiveFailures,
  lastSuccessfulCheckBefore,
  recordCheck,
} from '../server/db/checks.js';
import { getSettings } from '../server/db/settings.js';
import { setLastStrategy, updateWatch } from '../server/db/watches.js';
import { dispatchAlert } from './channels/index.js';
import { evaluateTrigger, shouldSendFailureAlert } from './trigger.js';
import { asScrapeError, fetchPage, fetchPageWithRetry, ScrapeError } from './scraper/fetch.js';
import { extract } from './scraper/extract.js';

export interface RunCheckOptions {
  /**
   * Skip the 30s/2m retry backoff. Used by the "run check now" button, where a user
   * is waiting on the response.
   */
  immediate?: boolean;
}

export async function runCheck(watch: Watch, options: RunCheckOptions = {}): Promise<Check> {
  const startedAt = Date.now();
  const settings = getSettings();

  try {
    const fetcher = options.immediate ? fetchPage : fetchPageWithRetry;
    const result = await fetcher(watch.url, {
      selector: watch.selector_override,
      timezone: settings.timezone,
    });

    const extracted = extract(result.snapshot, { preferStrategy: watch.last_strategy });
    if (!extracted) {
      throw new ScrapeError(
        'not_found',
        watch.selector_override
          ? 'Your CSS selector did not match anything on the page.'
          : 'Could not find a price on this page. Try setting a CSS selector override.',
      );
    }
    if (watch.mode === 'price' && extracted.price === null) {
      throw new ScrapeError('not_found', 'The page loaded, but no price was found on it.');
    }

    const check = recordCheck({
      watch_id: watch.id,
      price: extracted.price,
      available: extracted.available,
      status: 'ok',
      duration_ms: Date.now() - startedAt,
    });

    persistLearnings(watch, extracted);
    await maybeAlert(watch, check, extracted);
    return check;
  } catch (error) {
    const scrapeError = asScrapeError(error);
    const check = recordCheck({
      watch_id: watch.id,
      price: null,
      available: null,
      status: 'error',
      error_kind: scrapeError.kind,
      error_message: scrapeError.message,
      duration_ms: Date.now() - startedAt,
    });

    await maybeAlertFailure(watch, check, scrapeError);
    return check;
  }
}

/** Caches the winning strategy and backfills an empty label from the page title. */
function persistLearnings(watch: Watch, extracted: ExtractResult): void {
  if (extracted.strategy !== watch.last_strategy) {
    setLastStrategy(watch.id, extracted.strategy);
  }

  const patch: { label?: string; currency?: string } = {};
  if (!watch.label.trim() && extracted.title) patch.label = extracted.title;
  if (extracted.currency && extracted.currency !== watch.currency) {
    patch.currency = extracted.currency;
  }
  if (Object.keys(patch).length > 0) updateWatch(watch.id, patch);
}

async function maybeAlert(watch: Watch, check: Check, extracted: ExtractResult): Promise<void> {
  const previous = lastSuccessfulCheckBefore(watch.id, check.id);

  const decision = evaluateTrigger({
    mode: watch.mode,
    targetPrice: watch.target_price,
    current: { status: check.status, price: check.price, available: check.available },
    previous: previous ? { price: previous.price, available: previous.available } : null,
  });
  if (!decision.fire || !decision.kind) return;

  const currency = extracted.currency ?? watch.currency;
  const label = watch.label.trim() || extracted.title || hostLabel(watch.url);

  const alert =
    decision.kind === 'price'
      ? {
          subject: `${formatMoney(check.price, currency)} — ${label}`,
          body:
            `${label} dropped to ${formatMoney(check.price, currency)} ` +
            `(your target: ${formatMoney(watch.target_price, currency)}).` +
            (previous?.price !== null && previous?.price !== undefined
              ? `\nLast seen at ${formatMoney(previous.price, currency)}.`
              : ''),
        }
      : {
          subject: `Back in stock — ${label}`,
          body: `${label} is available again at ${hostLabel(watch.url)}.`,
        };

  const results = await dispatchAlert({
    kind: decision.kind,
    watch,
    check,
    url: watch.url,
    ...alert,
  });

  for (const result of results) {
    if (!result.ok) {
      console.error(`[pricewatch] alert via ${result.channel} failed: ${result.error}`);
      continue;
    }
    recordAlert({
      watch_id: watch.id,
      check_id: check.id,
      kind: decision.kind,
      channel: result.channel,
      message: alert.subject,
    });
  }
}

async function maybeAlertFailure(watch: Watch, check: Check, error: ScrapeError): Promise<void> {
  const failures = consecutiveFailures(watch.id);
  const alreadyNotified = failureAlertSentSinceLastSuccess(watch.id);
  if (!shouldSendFailureAlert({ consecutiveFailures: failures, alreadyNotified })) return;

  const label = watch.label.trim() || hostLabel(watch.url);
  const advice =
    error.kind === 'blocked'
      ? '\n\nThis site blocks automated checking. PriceWatch will not try to work around that — ' +
        'check the page manually, or use the store’s own price-alert feature.'
      : '\n\nPriceWatch will keep trying on the normal schedule.';

  const alert = {
    subject: `Check is failing — ${label}`,
    body: `The last ${failures} checks for ${label} failed.\n\nReason: ${error.message}${advice}`,
  };

  const results = await dispatchAlert({ kind: 'failure', watch, check, url: watch.url, ...alert });
  for (const result of results) {
    if (!result.ok) {
      console.error(`[pricewatch] failure notice via ${result.channel} failed: ${result.error}`);
      continue;
    }
    recordAlert({
      watch_id: watch.id,
      check_id: check.id,
      kind: 'failure',
      channel: result.channel,
      message: alert.subject,
    });
  }
}
