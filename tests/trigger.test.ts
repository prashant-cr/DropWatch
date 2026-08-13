import { describe, expect, it } from 'vitest';
import {
  evaluateTrigger,
  shouldSendFailureAlert,
  type CheckState,
  type TriggerContext,
} from '../src/core/trigger.js';

function priceCheck(
  current: number | null,
  previous: number | null | 'none',
  target: number | null = 100,
): TriggerContext {
  return {
    mode: 'price',
    targetPrice: target,
    current: { status: 'ok', price: current, available: true },
    previous: previous === 'none' ? null : ({ price: previous, available: true } as CheckState),
  };
}

function stockCheck(current: boolean | null, previous: boolean | null | 'none'): TriggerContext {
  return {
    mode: 'availability',
    targetPrice: null,
    current: { status: 'ok', price: null, available: current },
    previous: previous === 'none' ? null : ({ price: null, available: previous } as CheckState),
  };
}

describe('price mode', () => {
  it('fires when the price crosses below the target', () => {
    const result = evaluateTrigger(priceCheck(95, 120));
    expect(result.fire).toBe(true);
    expect(result.kind).toBe('price');
  });

  it('fires when the price lands exactly on the target', () => {
    expect(evaluateTrigger(priceCheck(100, 120)).fire).toBe(true);
  });

  it('does not fire while the price stays above the target', () => {
    expect(evaluateTrigger(priceCheck(120, 130)).fire).toBe(false);
  });

  it('does not fire again while the price stays below the target', () => {
    const result = evaluateTrigger(priceCheck(93, 95));
    expect(result.fire).toBe(false);
    expect(result.reason).toMatch(/already at or below/);
  });

  it('re-arms: fires again after the price goes back above and drops once more', () => {
    // below -> above (no alert) -> below (alert)
    expect(evaluateTrigger(priceCheck(130, 95)).fire).toBe(false);
    expect(evaluateTrigger(priceCheck(95, 130)).fire).toBe(true);
  });

  it('fires on a first-ever check that is already below target', () => {
    // No baseline exists, so the condition counts as newly satisfied. Watches added
    // through the UI are seeded with the detected price, so this is the rare case
    // where detection failed at creation — one email beats silence.
    expect(evaluateTrigger(priceCheck(80, 'none')).fire).toBe(true);
  });

  it('does not fire without a target price', () => {
    expect(evaluateTrigger(priceCheck(80, 120, null)).fire).toBe(false);
  });

  it('does not fire when no price was found', () => {
    expect(evaluateTrigger(priceCheck(null, 120)).fire).toBe(false);
  });

  it('ignores a previous check that had no price', () => {
    // Previous succeeded but yielded no price: treat the condition as newly met.
    expect(evaluateTrigger(priceCheck(80, null)).fire).toBe(true);
  });
});

describe('availability mode', () => {
  it('fires on the out-of-stock to in-stock transition', () => {
    const result = evaluateTrigger(stockCheck(true, false));
    expect(result.fire).toBe(true);
    expect(result.kind).toBe('availability');
  });

  it('does not fire while the item stays in stock', () => {
    expect(evaluateTrigger(stockCheck(true, true)).fire).toBe(false);
  });

  it('does not fire while the item stays out of stock', () => {
    expect(evaluateTrigger(stockCheck(false, false)).fire).toBe(false);
  });

  it('does not fire when availability is unknown', () => {
    expect(evaluateTrigger(stockCheck(null, false)).fire).toBe(false);
  });

  it('fires on a first-ever check that is already in stock', () => {
    expect(evaluateTrigger(stockCheck(true, 'none')).fire).toBe(true);
  });
});

describe('failed checks', () => {
  it('never alert', () => {
    const result = evaluateTrigger({
      mode: 'price',
      targetPrice: 100,
      current: { status: 'error', price: null, available: null },
      previous: { price: 120, available: true },
    });
    expect(result.fire).toBe(false);
    expect(result.reason).toBe('check failed');
  });

  it('do not re-arm a watch, because the baseline is the last successful check', () => {
    // A network blip between two below-target checks must not produce a second
    // alert once the site recovers: the caller passes the last *successful* check.
    expect(evaluateTrigger(priceCheck(93, 95)).fire).toBe(false);
  });
});

describe('flapping prices', () => {
  it('alerts once per crossing, not once per check', () => {
    const series: Array<[current: number, previous: number | 'none']> = [
      [120, 'none'],
      [118, 120],
      [95, 118], // crossing -> alert
      [94, 95],
      [96, 94],
      [130, 96], // back above -> re-armed
      [99, 130], // crossing -> alert
      [98, 99],
    ];
    const fired = series.map(
      ([current, previous]) => evaluateTrigger(priceCheck(current, previous)).fire,
    );
    expect(fired).toEqual([false, false, true, false, false, false, true, false]);
  });
});

describe('shouldSendFailureAlert', () => {
  it('stays quiet below the threshold', () => {
    expect(shouldSendFailureAlert({ consecutiveFailures: 2, alreadyNotified: false })).toBe(false);
  });

  it('fires at the threshold', () => {
    expect(shouldSendFailureAlert({ consecutiveFailures: 3, alreadyNotified: false })).toBe(true);
  });

  it('sends only one notice per outage', () => {
    expect(shouldSendFailureAlert({ consecutiveFailures: 9, alreadyNotified: true })).toBe(false);
  });
});
