import type { FastifyInstance } from 'fastify';
import type { WatchMode } from '../../shared/types.js';
import { validateSchedule } from '../../core/cron.js';
import { checkWatch, isChecking, syncWatch } from '../../core/scheduler.js';
import { priceHistory, recordCheck } from '../db/checks.js';
import { getSettings } from '../db/settings.js';
import {
  createWatch,
  deleteWatch,
  getWatch,
  listWatches,
  updateWatch,
  type WatchPatch,
} from '../db/watches.js';
import { detect } from '../services/detect.js';
import { withState } from '../services/watch-state.js';
import {
  asRecord,
  conflict,
  normalizeUrl,
  notFound,
  optionalBoolean,
  optionalNumber,
  optionalString,
  parseId,
  parseIntInRange,
  requireString,
  ValidationError,
} from '../validate.js';

function parseMode(raw: string | undefined, fallback: WatchMode = 'price'): WatchMode {
  if (raw === undefined) return fallback;
  if (raw !== 'price' && raw !== 'availability') {
    throw new ValidationError('"mode" must be "price" or "availability".');
  }
  return raw;
}

function assertSchedule(cronExpression: string): void {
  const result = validateSchedule(cronExpression, getSettings().timezone);
  if (!result.ok) throw new ValidationError(result.message ?? 'Invalid schedule.');
}

export async function watchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/watches', async () => {
    const watches = listWatches().map(withState);
    return { watches, checking: watches.filter((w) => isChecking(w.id)).map((w) => w.id) };
  });

  app.get('/api/watches/:id', async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const watch = getWatch(id);
    if (!watch) throw notFound('No such watch.');
    return { watch: withState(watch), checking: isChecking(id) };
  });

  app.post('/api/watches', async (request, reply) => {
    const body = asRecord(request.body);
    const settings = getSettings();

    const url = normalizeUrl(requireString(body, 'url'));
    const mode = parseMode(optionalString(body, 'mode'));
    const intervalCron = optionalString(body, 'interval_cron') || settings.default_interval_cron;
    assertSchedule(intervalCron);

    const targetPrice = optionalNumber(body, 'target_price') ?? null;
    if (mode === 'price' && targetPrice === null) {
      throw new ValidationError('A target price is required in price mode.');
    }
    if (targetPrice !== null && targetPrice <= 0) {
      throw new ValidationError('Target price must be greater than zero.');
    }

    const watch = createWatch({
      url,
      label: optionalString(body, 'label') ?? '',
      mode,
      target_price: targetPrice,
      interval_cron: intervalCron,
      currency: optionalString(body, 'currency') || settings.currency,
      selector_override: optionalString(body, 'selector_override') || null,
    });

    // Seed history with what the add-watch modal already detected, so the very first
    // scheduled check has a baseline to edge-trigger against instead of alerting
    // immediately on a price the user has already seen.
    const seedPrice = optionalNumber(body, 'detected_price');
    const seedAvailable = optionalBoolean(body, 'detected_available');
    if (seedPrice !== undefined || seedAvailable !== undefined) {
      recordCheck({
        watch_id: watch.id,
        price: seedPrice ?? null,
        available: seedAvailable ?? null,
        status: 'ok',
        duration_ms: 0,
      });
    }

    syncWatch(watch.id);
    reply.code(201);
    return { watch: withState(watch) };
  });

  app.patch('/api/watches/:id', async (request) => {
    const id = parseId((request.params as { id: string }).id);
    if (!getWatch(id)) throw notFound('No such watch.');

    const body = asRecord(request.body);
    const patch: WatchPatch = {};

    const url = optionalString(body, 'url');
    if (url !== undefined) patch.url = normalizeUrl(url);

    const label = optionalString(body, 'label');
    if (label !== undefined) patch.label = label;

    const mode = optionalString(body, 'mode');
    if (mode !== undefined) patch.mode = parseMode(mode);

    const intervalCron = optionalString(body, 'interval_cron');
    if (intervalCron !== undefined && intervalCron !== '') {
      assertSchedule(intervalCron);
      patch.interval_cron = intervalCron;
    }

    const targetPrice = optionalNumber(body, 'target_price');
    if (targetPrice !== undefined) {
      if (targetPrice !== null && targetPrice <= 0) {
        throw new ValidationError('Target price must be greater than zero.');
      }
      patch.target_price = targetPrice;
    }

    const currency = optionalString(body, 'currency');
    if (currency) patch.currency = currency;

    const selector = optionalString(body, 'selector_override');
    if (selector !== undefined) patch.selector_override = selector || null;

    const paused = optionalBoolean(body, 'is_paused');
    if (paused !== undefined) patch.is_paused = paused;

    const updated = updateWatch(id, patch);
    if (!updated) throw notFound('No such watch.');

    // Schedule, pause state or URL may have changed — rebuild the cron registration.
    syncWatch(id);
    return { watch: withState(updated) };
  });

  app.delete('/api/watches/:id', async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    const removed = deleteWatch(id);
    if (!removed) throw notFound('No such watch.');
    syncWatch(id);
    reply.code(204);
    return null;
  });

  app.post('/api/watches/:id/check', async (request) => {
    const id = parseId((request.params as { id: string }).id);
    const watch = getWatch(id);
    if (!watch) throw notFound('No such watch.');

    const check = await checkWatch(id, { immediate: true });
    if (!check) throw conflict('A check for this watch is already running.');

    const refreshed = getWatch(id);
    return { check, watch: refreshed ? withState(refreshed) : null };
  });

  app.get('/api/watches/:id/history', async (request) => {
    const id = parseId((request.params as { id: string }).id);
    if (!getWatch(id)) throw notFound('No such watch.');
    const days = parseIntInRange((request.query as { days?: string }).days, 30, 1, 365);
    return { days, points: priceHistory(id, days) };
  });

  app.post('/api/detect', async (request) => {
    const body = asRecord(request.body);
    const url = normalizeUrl(requireString(body, 'url'));
    return detect(url, optionalString(body, 'selector_override') || null);
  });
}
