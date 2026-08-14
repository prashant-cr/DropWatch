/**
 * HTTP-level tests. `app.inject()` drives the real Fastify stack — routing, body
 * parsing, the error handler — without opening a socket, so these stay as fast as
 * the unit tests while covering the layer users actually talk to.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server/index.js';
import { closeDb, initDb } from '../src/server/db/index.js';
import { stopScheduler } from '../src/core/scheduler.js';

let app: FastifyInstance;

beforeEach(async () => {
  initDb(':memory:');
  app = await buildServer();
  await app.ready();
});

afterEach(async () => {
  stopScheduler();
  await app.close();
  closeDb();
});

const body = (response: { body: string }): Record<string, unknown> =>
  JSON.parse(response.body) as Record<string, unknown>;

const newWatch = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://store.example.com/p/1',
  mode: 'price',
  target_price: 99,
  ...overrides,
});

describe('GET /api/health', () => {
  it('reports the running version', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(body(response).ok).toBe(true);
    expect(body(response).version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('settings', () => {
  it('never sends the SMTP password to the browser', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { smtp_host: 'smtp.example.com', smtp_pass: 'hunter2' },
    });

    const response = await app.inject({ method: 'GET', url: '/api/settings' });
    const settings = body(response).settings as Record<string, unknown>;

    expect(response.statusCode).toBe(200);
    expect(settings).not.toHaveProperty('smtp_pass');
    expect(settings.smtp_pass_set).toBe(true);
    // Belt and braces: the secret must not appear anywhere in the payload.
    expect(response.body).not.toContain('hunter2');
  });

  it('reports no password set on a fresh install', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings' });
    const settings = body(response).settings as Record<string, unknown>;

    expect(settings.smtp_pass_set).toBe(false);
    expect(settings).not.toHaveProperty('smtp_pass');
  });

  it('keeps the stored password when the field is omitted', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { smtp_pass: 'hunter2' },
    });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { smtp_host: 'smtp.example.com' },
    });

    const settings = body(response).settings as Record<string, unknown>;
    expect(settings.smtp_pass_set).toBe(true);
    expect(settings.smtp_host).toBe('smtp.example.com');
  });

  it('rejects an out-of-range SMTP port', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { smtp_port: 99999 },
    });

    expect(response.statusCode).toBe(400);
    expect(body(response).message).toMatch(/port/i);
  });

  it('rejects an unknown timezone', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { timezone: 'Middle/Earth' },
    });

    expect(response.statusCode).toBe(400);
    expect(body(response).message).toMatch(/timezone/i);
  });

  it('rejects a retention window too short to draw a sparkline', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { retention_days: 3 },
    });

    expect(response.statusCode).toBe(400);
    expect(body(response).message).toMatch(/at least/i);
  });

  it('accepts 0 as "keep history forever"', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { retention_days: 0 },
    });

    expect(response.statusCode).toBe(200);
    expect((body(response).settings as Record<string, unknown>).retention_days).toBe(0);
  });
});

describe('watches', () => {
  it('creates a watch and returns it with state attached', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/watches', payload: newWatch() });

    expect(response.statusCode).toBe(201);
    const watch = body(response).watch as Record<string, unknown>;
    expect(watch.url).toBe('https://store.example.com/p/1');
    expect(watch.target_price).toBe(99);
    expect(watch).toHaveProperty('next_check_at');
  });

  it('requires a url', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/watches',
      payload: { mode: 'price', target_price: 10 },
    });

    expect(response.statusCode).toBe(400);
    expect(body(response).message).toMatch(/url/i);
  });

  it('requires a target price in price mode', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/watches',
      payload: { url: 'https://store.example.com/p/2', mode: 'price' },
    });

    expect(response.statusCode).toBe(400);
    expect(body(response).message).toMatch(/target price/i);
  });

  it('rejects a target price of zero or less', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/watches',
      payload: newWatch({ target_price: 0 }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a schedule faster than the minimum interval', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/watches',
      payload: newWatch({ interval_cron: '* * * * *' }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses to watch a host on the local network', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/watches',
      payload: newWatch({ url: 'http://192.168.1.1/admin' }),
    });

    expect(response.statusCode).toBe(400);
    expect(body(response).message).toMatch(/local network/i);
  });

  it('404s on a watch that does not exist', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/watches/999',
      payload: { label: 'nope' },
    });
    const remove = await app.inject({ method: 'DELETE', url: '/api/watches/999' });

    expect(patch.statusCode).toBe(404);
    expect(remove.statusCode).toBe(404);
  });

  it('rejects a non-numeric id rather than treating it as 0', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/watches/not-an-id' });

    expect(response.statusCode).toBe(400);
  });

  it('pauses and deletes through the API', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/watches', payload: newWatch() });
    const id = (body(created).watch as { id: number }).id;

    const paused = await app.inject({
      method: 'PATCH',
      url: `/api/watches/${String(id)}`,
      payload: { is_paused: true },
    });
    expect((body(paused).watch as Record<string, unknown>).is_paused).toBe(true);
    // A paused watch has no next run to show.
    expect((body(paused).watch as Record<string, unknown>).next_check_at).toBeNull();

    const removed = await app.inject({ method: 'DELETE', url: `/api/watches/${String(id)}` });
    expect(removed.statusCode).toBe(204);

    const list = await app.inject({ method: 'GET', url: '/api/watches' });
    expect(body(list).watches).toHaveLength(0);
  });
});

describe('error handling', () => {
  it('returns JSON for an unknown API route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(body(response).error).toBe('not_found');
  });

  it('rejects a non-object JSON body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/watches',
      payload: JSON.stringify(['not', 'an', 'object']),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
  });
});
