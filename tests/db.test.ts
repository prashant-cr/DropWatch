import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, initDb } from '../src/server/db/index.js';
import {
  consecutiveFailures,
  lastSuccessfulCheckBefore,
  latestCheck,
  priceHistory,
  recordCheck,
} from '../src/server/db/checks.js';
import { failureAlertSentSinceLastSuccess, recordAlert } from '../src/server/db/alerts.js';
import { createWatch, deleteWatch, getWatch, updateWatch } from '../src/server/db/watches.js';
import { getSettings, isEmailConfigured, updateSettings } from '../src/server/db/settings.js';

let watchId = 0;

beforeEach(() => {
  initDb(':memory:');
  watchId = createWatch({
    url: 'https://store.example.com/p/1',
    label: '',
    mode: 'price',
    target_price: 100,
    interval_cron: '0 * * * *',
    currency: 'USD',
    selector_override: null,
  }).id;
});

afterEach(() => {
  closeDb();
});

const ok = (price: number) =>
  recordCheck({ watch_id: watchId, price, available: true, status: 'ok', duration_ms: 10 });

const fail = (kind: 'blocked' | 'timeout' = 'timeout') =>
  recordCheck({
    watch_id: watchId,
    price: null,
    available: null,
    status: 'error',
    error_kind: kind,
    error_message: 'nope',
    duration_ms: 10,
  });

describe('watches', () => {
  it('round-trips booleans through SQLite integers', () => {
    expect(getWatch(watchId)?.is_paused).toBe(false);
    updateWatch(watchId, { is_paused: true });
    expect(getWatch(watchId)?.is_paused).toBe(true);
  });

  it('leaves untouched columns alone on a partial update', () => {
    updateWatch(watchId, { label: 'Renamed' });
    const watch = getWatch(watchId);
    expect(watch?.label).toBe('Renamed');
    expect(watch?.target_price).toBe(100);
    expect(watch?.interval_cron).toBe('0 * * * *');
  });

  it('can clear a nullable column', () => {
    updateWatch(watchId, { selector_override: '.price' });
    expect(getWatch(watchId)?.selector_override).toBe('.price');
    updateWatch(watchId, { selector_override: null });
    expect(getWatch(watchId)?.selector_override).toBeNull();
  });

  it('cascades deletes to checks', () => {
    ok(120);
    deleteWatch(watchId);
    expect(latestCheck(watchId)).toBeNull();
  });
});

describe('lastSuccessfulCheckBefore', () => {
  it('returns the previous successful check', () => {
    ok(120);
    const current = ok(95);
    expect(lastSuccessfulCheckBefore(watchId, current.id)?.price).toBe(120);
  });

  it('skips over failures so a blip cannot re-arm the trigger', () => {
    ok(95);
    fail();
    fail();
    const current = ok(93);
    expect(lastSuccessfulCheckBefore(watchId, current.id)?.price).toBe(95);
  });

  it('returns null when there is no earlier success', () => {
    fail();
    const current = ok(95);
    expect(lastSuccessfulCheckBefore(watchId, current.id)).toBeNull();
  });
});

describe('consecutiveFailures', () => {
  it('counts failures since the last success', () => {
    ok(120);
    fail();
    fail();
    expect(consecutiveFailures(watchId)).toBe(2);
  });

  it('resets to zero after a success', () => {
    fail();
    fail();
    fail();
    ok(120);
    expect(consecutiveFailures(watchId)).toBe(0);
  });

  it('counts every failure when there has never been a success', () => {
    fail();
    fail();
    expect(consecutiveFailures(watchId)).toBe(2);
  });
});

describe('failureAlertSentSinceLastSuccess', () => {
  it('is false before any notice goes out', () => {
    fail();
    fail();
    fail();
    expect(failureAlertSentSinceLastSuccess(watchId)).toBe(false);
  });

  it('is true once a failure notice has been recorded for this outage', () => {
    fail();
    fail();
    const third = fail();
    recordAlert({
      watch_id: watchId,
      check_id: third.id,
      kind: 'failure',
      channel: 'email',
      message: 'Check is failing',
    });
    expect(failureAlertSentSinceLastSuccess(watchId)).toBe(true);
  });

  it('resets after a success, so a later outage gets its own notice', () => {
    const first = fail();
    recordAlert({
      watch_id: watchId,
      check_id: first.id,
      kind: 'failure',
      channel: 'email',
      message: 'Check is failing',
    });
    expect(failureAlertSentSinceLastSuccess(watchId)).toBe(true);

    ok(120);
    fail();
    expect(failureAlertSentSinceLastSuccess(watchId)).toBe(false);
  });

  it('ignores price alerts', () => {
    const check = ok(95);
    recordAlert({
      watch_id: watchId,
      check_id: check.id,
      kind: 'price',
      channel: 'email',
      message: 'Price drop',
    });
    fail();
    expect(failureAlertSentSinceLastSuccess(watchId)).toBe(false);
  });
});

describe('priceHistory', () => {
  it('returns successful checks oldest first and omits failures', () => {
    ok(120);
    fail();
    ok(110);
    ok(95);

    const points = priceHistory(watchId, 30);
    expect(points.map((p) => p.price)).toEqual([120, 110, 95]);
  });

  it('excludes checks older than the window', () => {
    recordCheck({
      watch_id: watchId,
      price: 500,
      available: true,
      status: 'ok',
      duration_ms: 10,
      checked_at: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(),
    });
    ok(120);
    expect(priceHistory(watchId, 30).map((p) => p.price)).toEqual([120]);
  });
});

describe('settings', () => {
  it('returns defaults for an untouched database', () => {
    const settings = getSettings();
    expect(settings.smtp_port).toBe(587);
    expect(settings.currency).toBe('USD');
    expect(settings.onboarding_dismissed).toBe(false);
  });

  it('coerces stored strings back to numbers and booleans', () => {
    updateSettings({ smtp_port: 465, smtp_secure: true, onboarding_dismissed: true });
    const settings = getSettings();
    expect(settings.smtp_port).toBe(465);
    expect(settings.smtp_secure).toBe(true);
    expect(settings.onboarding_dismissed).toBe(true);
  });

  it('ignores unknown keys', () => {
    updateSettings({ nonsense: 'value' } as never);
    expect(getSettings()).not.toHaveProperty('nonsense');
  });

  it('reports email as configured only once a host and recipient exist', () => {
    expect(isEmailConfigured()).toBe(false);
    updateSettings({ smtp_host: 'smtp.example.com' });
    expect(isEmailConfigured()).toBe(false);
    updateSettings({ alert_to: 'me@example.com' });
    expect(isEmailConfigured()).toBe(true);
  });
});
