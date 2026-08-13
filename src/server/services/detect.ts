/**
 * One-shot detection for the add-watch flow. Unlike a scheduled check this never
 * retries — a user is watching a spinner, so a fast honest failure beats a slow
 * success.
 */

import type { DetectResponse } from '../../shared/types.js';
import { asScrapeError, fetchPage } from '../../core/scraper/fetch.js';
import { extract } from '../../core/scraper/extract.js';
import { getSettings } from '../db/settings.js';

export async function detect(url: string, selector?: string | null): Promise<DetectResponse> {
  const settings = getSettings();

  try {
    const { snapshot, faviconUrl } = await fetchPage(url, {
      selector: selector ?? null,
      timezone: settings.timezone,
    });
    const extracted = extract(snapshot);

    return {
      ok: true,
      url: snapshot.url,
      title: extracted?.title ?? null,
      price: extracted?.price ?? null,
      currency: extracted?.currency ?? null,
      available: extracted?.available ?? null,
      strategy: extracted?.strategy ?? null,
      favicon: faviconUrl,
      error_kind: null,
      error_message:
        extracted && extracted.price !== null
          ? null
          : 'The page loaded but no price was found. You can still watch it for stock, ' +
            'or paste a CSS selector to point at the price.',
    };
  } catch (error) {
    const scrapeError = asScrapeError(error);
    return {
      ok: false,
      url,
      title: null,
      price: null,
      currency: null,
      available: null,
      strategy: null,
      favicon: null,
      error_kind: scrapeError.kind,
      error_message: scrapeError.message,
    };
  }
}
