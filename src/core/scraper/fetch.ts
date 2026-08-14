/**
 * Page fetching via headless Chromium.
 *
 * Deliberately boring: a realistic desktop browser, one request at a time per
 * domain, a minimum gap between requests, and images/fonts/media dropped so checks
 * stay cheap. When a site turns us away we say so and stop — DropWatch does not
 * implement CAPTCHA solving, anti-bot bypass, fingerprint spoofing or proxy
 * rotation, and contributions adding them are declined. See the README FAQ.
 */

import { chromium, type Browser, type BrowserContext, type Route } from 'playwright';
import type { CheckErrorKind } from '../../shared/types.js';
import type { PageSnapshot } from './extract.js';

/** Minimum gap between two requests to the same host. */
export const MIN_DOMAIN_GAP_MS = 10_000;

const NAVIGATION_TIMEOUT_MS = 30_000;
const SELECTOR_TIMEOUT_MS = 10_000;
const SETTLE_TIMEOUT_MS = 8_000;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

export class ScrapeError extends Error {
  readonly kind: CheckErrorKind;

  constructor(kind: CheckErrorKind, message: string) {
    super(message);
    this.name = 'ScrapeError';
    this.kind = kind;
  }
}

export interface FetchOptions {
  /** CSS selector to wait for and read, when the user set a manual override. */
  selector?: string | null;
  acceptLanguage?: string;
  timezone?: string;
}

export interface FetchResult {
  snapshot: PageSnapshot;
  status: number;
  faviconUrl: string | null;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

let browserPromise: Promise<Browser> | null = null;

/**
 * How long the shared Chromium may sit unused before it is shut down.
 *
 * Checks are minutes apart at best and a day apart at worst, so for almost all of
 * its life the browser is idle resident memory — a couple of hundred MB doing
 * nothing on a machine that is probably also the user's laptop. Ten minutes is long
 * enough that a burst of checks reuses one browser, and short enough that the idle
 * case is genuinely idle. The cost is a cold start (~1s) on the next check, which is
 * nothing next to the page load that follows it.
 */
export const BROWSER_IDLE_MS = 10 * 60 * 1000;

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;

function cancelIdleShutdown(): void {
  if (idleTimer === null) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdleShutdown(): void {
  cancelIdleShutdown();
  if (inFlight > 0 || !browserPromise) return;

  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (inFlight > 0) return;
    void closeBrowser();
  }, BROWSER_IDLE_MS);

  // Never hold the process open just to close a browser later.
  idleTimer.unref?.();
}

async function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ headless: true }).catch((error: unknown) => {
    browserPromise = null;
    const message = error instanceof Error ? error.message : String(error);
    if (/Executable doesn't exist|please run the following command/i.test(message)) {
      throw new ScrapeError(
        'unknown',
        'Chromium is not installed. Run `npx playwright install chromium` and try again.',
      );
    }
    throw new ScrapeError('unknown', `Could not start Chromium: ${message}`);
  });
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  cancelIdleShutdown();
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    await (await pending).close();
  } catch {
    // Shutting down anyway.
  }
}

/** True while a Chromium instance is alive. Exposed for tests. */
export function browserIsRunning(): boolean {
  return browserPromise !== null;
}

// ---------------------------------------------------------------------------
// Per-domain politeness: one in flight, minimum gap between requests
// ---------------------------------------------------------------------------

interface DomainState {
  queue: Promise<void>;
  lastFinishedAt: number;
}

const domains = new Map<string, DomainState>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Serialises `task` against every other request to the same host and enforces
 * {@link MIN_DOMAIN_GAP_MS} between them.
 */
export function withDomainLimit<T>(url: string, task: () => Promise<T>): Promise<T> {
  const host = hostOf(url);
  const state = domains.get(host) ?? { queue: Promise.resolve(), lastFinishedAt: 0 };

  const run = state.queue.then(async (): Promise<T> => {
    const waitFor = state.lastFinishedAt + MIN_DOMAIN_GAP_MS - Date.now();
    if (waitFor > 0) await sleep(waitFor);
    try {
      return await task();
    } finally {
      state.lastFinishedAt = Date.now();
    }
  });

  // Keep the chain alive regardless of this task's outcome.
  state.queue = run.then(
    () => undefined,
    () => undefined,
  );
  domains.set(host, state);
  return run;
}

// ---------------------------------------------------------------------------
// Block detection
// ---------------------------------------------------------------------------

const BLOCK_MARKERS = [
  'just a moment...',
  'checking your browser before accessing',
  'enable javascript and cookies to continue',
  'verify you are a human',
  'are you a robot',
  'unusual traffic from your computer',
  'access denied',
  'request unsuccessful. incapsula',
  'pardon our interruption',
  'attention required! | cloudflare',
  'ddos protection by',
  'please complete the security check',
  'captcha',
];

/**
 * Recognises the common "you look automated" interstitials so the UI can tell the
 * user plainly instead of retrying forever. Detection only — nothing here attempts
 * to get past the block.
 */
export function detectsBlock(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const head = html.slice(0, 20_000).toLowerCase();
  return BLOCK_MARKERS.some((marker) => head.includes(marker));
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function newContext(browser: Browser, options: FetchOptions): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
    locale: options.acceptLanguage?.split(',')[0] ?? 'en-US',
    timezoneId: options.timezone,
    extraHTTPHeaders: {
      'Accept-Language': options.acceptLanguage ?? 'en-US,en;q=0.9',
    },
  });
}

/** Single fetch attempt. Throws {@link ScrapeError} on any failure. */
export async function fetchPage(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  return withDomainLimit(url, () => fetchPageNow(url, options));
}

async function fetchPageNow(url: string, options: FetchOptions): Promise<FetchResult> {
  const startedAt = Date.now();

  inFlight++;
  cancelIdleShutdown();
  try {
    return await withBrowser(url, options, startedAt);
  } finally {
    inFlight--;
    scheduleIdleShutdown();
  }
}

async function withBrowser(
  url: string,
  options: FetchOptions,
  startedAt: number,
): Promise<FetchResult> {
  const browser = await getBrowser();
  const context = await newContext(browser, options);

  try {
    const page = await context.newPage();

    // Drop heavy subresources — we only ever read the DOM.
    await page.route('**/*', (route: Route) => {
      if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) return route.abort();
      return route.continue();
    });

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!response) throw new ScrapeError('network', 'No response from the server.');

    const status = response.status();
    if (status === 404 || status === 410) {
      throw new ScrapeError('not_found', `Page not found (HTTP ${status}).`);
    }

    if (options.selector) {
      await page.waitForSelector(options.selector, { timeout: SELECTOR_TIMEOUT_MS }).catch(() => {
        // Missing selector is reported by the extractor, not as a fetch failure.
      });
    } else {
      await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {
        // Chatty pages never go idle; the DOM is usually ready regardless.
      });
    }

    const html = await page.content();

    if (detectsBlock(status, html)) {
      throw new ScrapeError(
        'blocked',
        'This site blocks automated checking. DropWatch will not try to get around it — ' +
          'check the page manually, or use the store’s own price-alert feature.',
      );
    }
    if (status >= 400) {
      throw new ScrapeError('network', `Server returned HTTP ${status}.`);
    }

    const selectorText = options.selector
      ? await page
          .locator(options.selector)
          .first()
          .textContent({ timeout: 2_000 })
          .catch(() => null)
      : null;

    const faviconUrl = await page
      .locator('link[rel~="icon" i]')
      .first()
      .getAttribute('href', { timeout: 1_000 })
      .catch(() => null);

    const finalUrl = page.url();
    return {
      snapshot: { url: finalUrl, html, selectorText },
      status,
      faviconUrl: resolveFavicon(faviconUrl, finalUrl),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    throw asScrapeError(error);
  } finally {
    await context.close().catch(() => undefined);
  }
}

function resolveFavicon(href: string | null, pageUrl: string): string | null {
  try {
    return new URL(href ?? '/favicon.ico', pageUrl).toString();
  } catch {
    return null;
  }
}

export function asScrapeError(error: unknown): ScrapeError {
  if (error instanceof ScrapeError) return error;
  const message = error instanceof Error ? error.message : String(error);

  if (/Timeout .* exceeded|timed? ?out/i.test(message)) {
    return new ScrapeError('timeout', 'The page took too long to load.');
  }
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(message)) {
    return new ScrapeError('network', 'Could not resolve that domain — is the URL correct?');
  }
  if (/ERR_CONNECTION|ECONNREFUSED|ECONNRESET|net::/i.test(message)) {
    return new ScrapeError('network', `Could not reach the site: ${message}`);
  }
  return new ScrapeError('unknown', message);
}

/**
 * Fetches with two retries and exponential backoff. Blocks and 404s are never
 * retried — repeating them is pointless and rude.
 */
export async function fetchPageWithRetry(
  url: string,
  options: FetchOptions = {},
  backoffMs: readonly number[] = [30_000, 120_000],
): Promise<FetchResult> {
  let lastError: ScrapeError = new ScrapeError('unknown', 'Check never ran.');

  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      return await fetchPage(url, options);
    } catch (error) {
      lastError = asScrapeError(error);
      if (lastError.kind === 'blocked' || lastError.kind === 'not_found') throw lastError;

      const delay = backoffMs[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }
  throw lastError;
}
