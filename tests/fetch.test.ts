import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asScrapeError,
  detectsBlock,
  MIN_DOMAIN_GAP_MS,
  ScrapeError,
  withDomainLimit,
} from '../src/core/scraper/fetch.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('detectsBlock', () => {
  it('treats the standard refusal status codes as a block', () => {
    expect(detectsBlock(403, '<html>nope</html>')).toBe(true);
    expect(detectsBlock(429, '<html>slow down</html>')).toBe(true);
    expect(detectsBlock(503, '<html></html>')).toBe(true);
  });

  it('recognises interstitial challenge pages on a 200', () => {
    expect(detectsBlock(200, '<title>Just a moment...</title>')).toBe(true);
    expect(detectsBlock(200, '<h1>Attention Required! | Cloudflare</h1>')).toBe(true);
    expect(detectsBlock(200, '<p>Enable JavaScript and cookies to continue</p>')).toBe(true);
    expect(detectsBlock(200, '<p>Pardon Our Interruption</p>')).toBe(true);
  });

  it('leaves ordinary product pages alone', () => {
    expect(detectsBlock(200, '<html><body><h1>Widget</h1><span>$19.99</span></body></html>')).toBe(
      false,
    );
  });

  it('only inspects the head of very large documents', () => {
    const html = `${'<div>filler</div>'.repeat(5000)}captcha`;
    expect(detectsBlock(200, html)).toBe(false);
  });
});

describe('asScrapeError', () => {
  it('passes through an existing ScrapeError', () => {
    const original = new ScrapeError('blocked', 'nope');
    expect(asScrapeError(original)).toBe(original);
  });

  it('classifies timeouts', () => {
    expect(asScrapeError(new Error('Timeout 30000ms exceeded')).kind).toBe('timeout');
  });

  it('classifies DNS failures', () => {
    expect(asScrapeError(new Error('net::ERR_NAME_NOT_RESOLVED at https://nope')).kind).toBe(
      'network',
    );
  });

  it('classifies connection failures', () => {
    expect(asScrapeError(new Error('net::ERR_CONNECTION_REFUSED')).kind).toBe('network');
  });

  it('falls back to unknown', () => {
    expect(asScrapeError(new Error('something odd')).kind).toBe('unknown');
  });
});

describe('withDomainLimit', () => {
  it('runs the first request to a host immediately', async () => {
    const result = await withDomainLimit('https://first.example.com/a', async () => 'done');
    expect(result).toBe('done');
  });

  it('serialises requests to the same host and spaces them out', async () => {
    vi.useFakeTimers();
    const order: string[] = [];

    const first = withDomainLimit('https://same.example.com/a', async () => {
      order.push('a');
    });
    const second = withDomainLimit('https://same.example.com/b', async () => {
      order.push('b');
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['a']);

    // The second request must wait out the politeness gap.
    await vi.advanceTimersByTimeAsync(MIN_DOMAIN_GAP_MS - 1);
    expect(order).toEqual(['a']);

    await vi.advanceTimersByTimeAsync(2);
    expect(order).toEqual(['a', 'b']);

    await Promise.all([first, second]);
  });

  it('does not make one host wait on another', async () => {
    vi.useFakeTimers();
    const order: string[] = [];

    const a = withDomainLimit('https://one.example.com/x', async () => {
      order.push('one');
    });
    const b = withDomainLimit('https://two.example.com/x', async () => {
      order.push('two');
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(order.sort()).toEqual(['one', 'two']);
    await Promise.all([a, b]);
  });

  it('keeps the queue alive after a task throws', async () => {
    vi.useFakeTimers();
    const order: string[] = [];

    const failing = withDomainLimit('https://flaky.example.com/a', async () => {
      order.push('boom');
      throw new Error('boom');
    });
    const following = withDomainLimit('https://flaky.example.com/b', async () => {
      order.push('after');
    });

    await expect(failing).rejects.toThrow('boom');
    await vi.advanceTimersByTimeAsync(MIN_DOMAIN_GAP_MS + 1);
    await following;

    expect(order).toEqual(['boom', 'after']);
  });
});
