import type { FastifyInstance } from 'fastify';
import { countAllChecks, countChecks, listChecks, listRecentChecks } from '../db/checks.js';
import { listAlerts } from '../db/alerts.js';
import { getWatch } from '../db/watches.js';
import { notFound, parseId, parseIntInRange } from '../validate.js';

interface CheckQuery {
  watch_id?: string;
  limit?: string;
  offset?: string;
}

export async function checkRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The check log behind the history page. Without `watch_id` it returns the most
   * recent checks across every watch, each carrying its watch's label and URL.
   */
  app.get('/api/checks', async (request) => {
    const query = request.query as CheckQuery;
    const limit = parseIntInRange(query.limit, 50, 1, 500);
    const offset = parseIntInRange(query.offset, 0, 0, 1_000_000);

    if (query.watch_id === undefined || query.watch_id === '') {
      return { checks: listRecentChecks(limit, offset), total: countAllChecks(), limit, offset };
    }

    const watchId = parseId(query.watch_id);
    if (!getWatch(watchId)) throw notFound('No such watch.');

    return {
      checks: listChecks(watchId, limit, offset),
      total: countChecks(watchId),
      limit,
      offset,
    };
  });

  app.get('/api/alerts', async (request) => {
    const query = request.query as CheckQuery;
    const watchId = parseId(query.watch_id);
    if (!getWatch(watchId)) throw notFound('No such watch.');
    return { alerts: listAlerts(watchId, parseIntInRange(query.limit, 50, 1, 200)) };
  });
}
