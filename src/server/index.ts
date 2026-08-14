/**
 * DropWatch server: REST API + the built web UI, on one port.
 *
 * Boot order matters — the database must exist before any route or the scheduler
 * touches it, and channels must be registered before the first check can alert.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { registerChannel, createEmailChannel } from '../core/channels/index.js';
import { closeBrowser } from '../core/scraper/fetch.js';
import { startScheduler, stopScheduler } from '../core/scheduler.js';
import { closeDb, databasePath, initDb } from './db/index.js';
import { getSettings } from './db/settings.js';
import { checkRoutes } from './routes/checks.js';
import { settingsRoutes } from './routes/settings.js';
import { watchRoutes } from './routes/watches.js';
import { HttpError } from './validate.js';

const DEFAULT_PORT = 3070;

/** True when running from TypeScript sources under tsx rather than from dist/. */
const isDev = import.meta.url.endsWith('.ts');

function webRoot(): string {
  return isDev
    ? fileURLToPath(new URL('../../dist/web/', import.meta.url))
    : fileURLToPath(new URL('../web/', import.meta.url));
}

/** Fastify errors carry `statusCode`; ours do too. Anything else is a 500. */
function statusCodeOf(error: unknown): number {
  if (error instanceof HttpError) return error.statusCode;
  const code = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === 'number' && code >= 400 && code < 600 ? code : 500;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    // 'warn' also suppresses Fastify's per-request info logs.
    logger: { level: process.env.LOG_LEVEL ?? 'warn' },
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const status = statusCodeOf(error);
    if (status >= 500) {
      request.log.error({ err: error }, 'request failed');
      console.error('[dropwatch]', error);
    }
    void reply.code(status).send({
      error: status >= 500 ? 'internal_error' : 'request_error',
      message:
        status >= 500 ? 'Something went wrong on the server.' : messageOf(error) || 'Bad request.',
    });
  });

  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }));

  await app.register(watchRoutes);
  await app.register(checkRoutes);
  await app.register(settingsRoutes);

  const root = webRoot();
  const hasBuiltUi = existsSync(join(root, 'index.html'));

  if (hasBuiltUi) {
    await app.register(fastifyStatic, { root, prefix: '/' });
    // Client-side routing: anything that is not an API call falls back to the SPA.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found', message: 'No such endpoint.' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((request, reply) =>
      reply.code(404).send({
        error: 'not_found',
        message: request.url.startsWith('/api/')
          ? 'No such endpoint.'
          : 'The web UI has not been built yet. Run `npm run build` (or use `npm run dev`).',
      }),
    );
  }

  return app;
}

export async function start(): Promise<FastifyInstance> {
  initDb();
  registerChannel(createEmailChannel({ getSettings }));

  const app = await buildServer();
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  // Loopback by default: DropWatch has no auth, so it should not appear on the LAN
  // unless the operator asks for it (the Docker image sets HOST=0.0.0.0).
  const host = process.env.HOST ?? '127.0.0.1';

  await app.listen({ port, host });
  startScheduler();

  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log('');
  console.log(`  DropWatch is running → http://${shown}:${port}`);
  console.log(`  Database: ${databasePath()}`);
  if (!getSettings().smtp_host) {
    console.log('  Email is not configured yet — open Settings to enable alerts.');
  }
  console.log('');

  installShutdownHandlers(app);
  return app;
}

function installShutdownHandlers(app: FastifyInstance): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[dropwatch] ${signal} received, shutting down…`);

    void (async () => {
      stopScheduler();
      await app.close().catch(() => undefined);
      await closeBrowser();
      closeDb();
      process.exit(0);
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A rejected promise somewhere in a check must never kill the server.
  process.on('unhandledRejection', (reason) => {
    console.error('[dropwatch] unhandled rejection:', reason);
  });
}

// Entry point when executed directly (`node dist/server/index.js` or `tsx src/server/index.ts`).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly || process.env.DROPWATCH_AUTOSTART === '1') {
  start().catch((error: unknown) => {
    console.error('[dropwatch] failed to start:', error);
    process.exit(1);
  });
}
