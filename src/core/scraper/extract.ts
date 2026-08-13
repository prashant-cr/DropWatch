/**
 * Price / availability / title extraction.
 *
 * Every strategy is a pure function `(snapshot) => ExtractResult | null` operating
 * on the rendered HTML, so each one can be unit-tested against a saved fixture with
 * no browser involved. `fetch.ts` is responsible for producing the snapshot.
 *
 * Strategies are tried in the order declared in {@link STRATEGIES}: structured data
 * first (most trustworthy), free-text heuristics last.
 */

import type { ExtractResult } from '../../shared/types.js';

export interface PageSnapshot {
  /** Final URL after redirects. */
  url: string;
  /** Fully rendered HTML. */
  html: string;
  /**
   * Text content of the user's CSS selector override, resolved in the browser
   * because we have no selector engine here. `null` when unset or not found.
   */
  selectorText?: string | null;
}

export interface Strategy {
  name: string;
  run: (snapshot: PageSnapshot) => ExtractResult | null;
}

// ---------------------------------------------------------------------------
// HTML / text helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  dollar: '$',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Removes script/style/noscript blocks — their contents are never visible text. */
export function stripNonVisible(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

/**
 * Collapses runs of ordinary whitespace but leaves no-break and thin spaces intact —
 * those carry meaning inside a price ("1 299") and must reach
 * {@link normalizeSpacing} undamaged. JavaScript's `\s` would eat them.
 */
const ASCII_WHITESPACE = /[ \t\n\r\f\v]+/g;

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(ASCII_WHITESPACE, ' ')
    .trim();
}

/** Visible text of the document body (or whole doc when there is no body tag). */
export function visibleText(html: string): string {
  const cleaned = stripNonVisible(html);
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(cleaned);
  return stripTags(body?.[1] ?? cleaned);
}

// ---------------------------------------------------------------------------
// Money parsing
// ---------------------------------------------------------------------------

const SYMBOL_TO_CURRENCY: Array<[string, string]> = [
  ['US$', 'USD'],
  ['CA$', 'CAD'],
  ['AU$', 'AUD'],
  ['NZ$', 'NZD'],
  ['R$', 'BRL'],
  ['C$', 'CAD'],
  ['A$', 'AUD'],
  ['S$', 'SGD'],
  ['HK$', 'HKD'],
  ['NT$', 'TWD'],
  ['zł', 'PLN'],
  ['Kč', 'CZK'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['₹', 'INR'],
  ['¥', 'JPY'],
  ['₩', 'KRW'],
  ['₽', 'RUB'],
  ['₺', 'TRY'],
  ['฿', 'THB'],
  ['₪', 'ILS'],
  ['₫', 'VND'],
  ['₱', 'PHP'],
  ['$', 'USD'],
];

const CURRENCY_CODES = new Set([
  'USD',
  'EUR',
  'GBP',
  'INR',
  'JPY',
  'CAD',
  'AUD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'BRL',
  'MXN',
  'ZAR',
  'SGD',
  'HKD',
  'NZD',
  'KRW',
  'CNY',
  'TRY',
  'AED',
  'ILS',
  'RUB',
  'THB',
  'IDR',
  'MYR',
  'PHP',
  'VND',
  'TWD',
  'HUF',
  'RON',
  'SAR',
]);

/**
 * Converts a display-formatted number into a float, resolving the `.` vs `,`
 * ambiguity between US ("1,234.50") and European ("1.234,50") conventions.
 */
export function normalizeNumber(raw: string): number | null {
  let text = raw.replace(/[\s\u00a0\u202f']/g, '');
  if (!/\d/.test(text)) return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator comes last is the decimal point.
    if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = text.split(',');
    const isGrouping = parts.length > 2 || parts[parts.length - 1]?.length === 3;
    text = isGrouping ? text.replace(/,/g, '') : text.replace(',', '.');
  } else if (lastDot >= 0) {
    const parts = text.split('.');
    // A single dot with exactly three trailing digits is grouping, not a price
    // with three decimal places ("1.234" is 1234, never 1.234).
    const isGrouping = parts.length > 2 || parts[parts.length - 1]?.length === 3;
    if (isGrouping) text = text.replace(/\./g, '');
  }

  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

export interface Money {
  value: number;
  currency: string | null;
  /** Index of the match within the source string. */
  index: number;
}

/**
 * Deliberately contains no `\s`. Allowing whitespace inside a number lets two
 * unrelated prices that sit next to each other ("₹649.00 ₹1,349.00") merge into a
 * single enormous bogus figure. Spacing that genuinely belongs inside one number is
 * repaired by {@link normalizeSpacing} before this pattern ever runs.
 */
const NUMBER_PATTERN = /\d[\d.,']*\d|\d/g;

/** No-break, narrow-no-break and thin spaces — the typographic group separators. */
const TYPO_SPACE = '\u00a0\u202f\u2009';

const SPLIT_DECIMAL = new RegExp(`(\\d)[${TYPO_SPACE} ]*([.,])[${TYPO_SPACE} ]*(\\d)`, 'g');
const SPACED_THOUSANDS = new RegExp(`(\\d)[${TYPO_SPACE}](\\d{3})(?!\\d)`, 'g');

/**
 * Repairs whitespace that belongs *inside* a single number, letting the number
 * pattern itself stay strict:
 *
 *  - Retailers split a price across elements — `<span>14,499</span><span>.</span>
 *    <span>00</span>` — and stripping the tags leaves `"14,499 . 00"`. Spacing that
 *    hugs a decimal separator is closed up.
 *  - French and Scandinavian sites group thousands with a no-break space
 *    (`"10 999"`). Only the typographic spaces are joined, never a plain one, so
 *    prose like "Save 20 000" cannot fuse into a price.
 */
export function normalizeSpacing(text: string): string {
  return text.replace(SPLIT_DECIMAL, '$1$2$3').replace(SPACED_THOUSANDS, '$1$2');
}

/**
 * Finds currency-formatted numbers in free text. A number only counts as money if a
 * currency symbol or ISO code sits immediately before or after it — this is what
 * keeps review counts, model numbers and years out of the results.
 */
export function findMoney(input: string): Money[] {
  const text = normalizeSpacing(input);
  const results: Money[] = [];
  NUMBER_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 6), index);
    const after = text.slice(index + raw.length, index + raw.length + 6);

    let currency: string | null = null;
    for (const [symbol, code] of SYMBOL_TO_CURRENCY) {
      if (before.trimEnd().endsWith(symbol) || after.trimStart().startsWith(symbol)) {
        currency = code;
        break;
      }
    }
    if (!currency) {
      const codeMatch =
        /([A-Z]{3})\s*$/.exec(before.toUpperCase()) ?? /^\s*([A-Z]{3})\b/.exec(after.toUpperCase());
      if (codeMatch?.[1] && CURRENCY_CODES.has(codeMatch[1])) currency = codeMatch[1];
    }
    if (!currency) continue;

    const value = normalizeNumber(raw);
    if (value === null || value <= 0) continue;
    results.push({ value, currency, index });
  }
  return results;
}

/** Parses a single price string such as `"$1,299.00"` or `"1.299,00 €"`. */
export function parseMoney(text: string): Money | null {
  const clean = normalizeSpacing(decodeEntities(text).replace(ASCII_WHITESPACE, ' ').trim());
  const withCurrency = findMoney(clean);
  if (withCurrency[0]) return withCurrency[0];

  // No currency marker (e.g. a JSON-LD `price` field or a selector override that
  // targets a bare number) — accept the first plausible number instead.
  const match = NUMBER_PATTERN.exec(clean);
  NUMBER_PATTERN.lastIndex = 0;
  if (!match) return null;
  const value = normalizeNumber(match[0]);
  if (value === null || value <= 0) return null;
  return { value, currency: null, index: match.index };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

const OUT_OF_STOCK_PHRASES = [
  'out of stock',
  'sold out',
  'currently unavailable',
  'temporarily unavailable',
  'no longer available',
  'notify me when available',
  'email me when available',
  'back in stock soon',
  'out-of-stock',
  'nicht verfügbar',
  'rupture de stock',
  'agotado',
];

const IN_STOCK_PHRASES = [
  'in stock',
  'add to cart',
  'add to bag',
  'add to basket',
  'buy now',
  'buy it now',
  'add to trolley',
  'available now',
  'ships today',
];

export function availabilityFromText(text: string): boolean | null {
  const lower = text.toLowerCase();
  // Out-of-stock wins: pages often keep a disabled "Add to cart" in the markup.
  if (OUT_OF_STOCK_PHRASES.some((phrase) => lower.includes(phrase))) return false;
  if (IN_STOCK_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  return null;
}

export function availabilityFromSchema(value: unknown): boolean | null {
  if (typeof value !== 'string') return null;
  const token = value.split('/').pop()?.toLowerCase() ?? '';
  if (['instock', 'instoreonly', 'onlineonly', 'limitedavailability'].includes(token)) return true;
  if (['outofstock', 'soldout', 'discontinued'].includes(token)) return false;
  if (['preorder', 'presale', 'backorder'].includes(token)) return false;
  return null;
}

// ---------------------------------------------------------------------------
// Meta tags & title
// ---------------------------------------------------------------------------

/** Maps meta `name`/`property`/`itemprop` to `content`, lowercased keys. */
export function readMetaTags(html: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = match[1] ?? '';
    const key =
      attrValue(attrs, 'property') ?? attrValue(attrs, 'name') ?? attrValue(attrs, 'itemprop');
    const content = attrValue(attrs, 'content');
    if (key && content) tags[key.toLowerCase()] = decodeEntities(content);
  }
  return tags;
}

function attrValue(attrs: string, name: string): string | null {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  if (quoted) return quoted[2] ?? quoted[3] ?? null;
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(attrs);
  return bare?.[1] ?? null;
}

export function extractTitle(snapshot: PageSnapshot): string | null {
  const meta = readMetaTags(snapshot.html);

  // og:title and JSON-LD `name` are already the product name — trimming a trailing
  // segment off those would eat real variant suffixes ("Trail Runner X — Men's").
  const fromMeta = meta['og:title'] ?? meta['twitter:title'];
  if (fromMeta?.trim()) return cleanTitle(fromMeta, false);

  const jsonLdName = walkJsonLd(snapshot.html, (node) => {
    if (isProduct(node) && typeof node['name'] === 'string') return node['name'];
    return undefined;
  });
  if (jsonLdName?.trim()) return cleanTitle(jsonLdName, false);

  // The <title> tag, by contrast, almost always carries store branding.
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(snapshot.html);
  if (titleTag?.[1]) return cleanTitle(stripTags(titleTag[1]), true);

  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(stripNonVisible(snapshot.html));
  if (h1?.[1]) return cleanTitle(stripTags(h1[1]), false);

  return null;
}

function cleanTitle(raw: string, trimBranding: boolean): string {
  const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();

  let result = text;
  if (trimBranding) {
    // "Widget Pro | Acme Store" -> "Widget Pro". Only separators that are padded
    // with spaces count, so hyphenated names survive.
    const trimmed = text.replace(/\s+[|·–—]\s+[^|·–—]{1,40}$/, '');
    if (trimmed.length >= 8) result = trimmed;
  }
  return result.length > 140 ? `${result.slice(0, 137)}…` : result;
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    const body = match[1];
    if (!body?.trim()) continue;
    try {
      blocks.push(JSON.parse(decodeEntities(body.trim())));
    } catch {
      // Malformed JSON-LD is common in the wild; skip it and try the next strategy.
    }
  }
  return blocks;
}

/** Depth-first walk over every object in the page's JSON-LD, returning the first hit. */
function walkJsonLd<T>(html: string, visit: (node: JsonObject) => T | undefined): T | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [...readJsonLdBlocks(html)];

  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!isJsonObject(node) || seen.has(node)) continue;
    seen.add(node);

    const hit = visit(node);
    if (hit !== undefined) return hit;
    stack.push(...Object.values(node));
  }
  return undefined;
}

function typeTokens(node: JsonObject): string[] {
  const raw = node['@type'] ?? node['type'];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase());
}

function isProduct(node: JsonObject): boolean {
  return typeTokens(node).some((t) => t === 'product' || t === 'productgroup' || t === 'vehicle');
}

function isOffer(node: JsonObject): boolean {
  return typeTokens(node).some((t) => t === 'offer' || t === 'aggregateoffer');
}

function numberFrom(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === 'string') {
    const parsed = parseMoney(value);
    return parsed?.value ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** Uses the user's manual CSS selector. Always tried first when one is set. */
const selectorOverride: Strategy = {
  name: 'selector-override',
  run(snapshot) {
    const text = snapshot.selectorText;
    if (!text || !text.trim()) return null;
    const money = parseMoney(text);
    if (!money) return null;
    return {
      price: money.value,
      currency: money.currency,
      available: availabilityFromText(visibleText(snapshot.html)),
      title: null,
      strategy: 'selector-override',
    };
  },
};

/** schema.org Product/Offer in JSON-LD — by far the most reliable source. */
const jsonLd: Strategy = {
  name: 'json-ld',
  run(snapshot) {
    const offer = walkJsonLd(snapshot.html, (node) => {
      if (!isOffer(node)) return undefined;
      const price =
        numberFrom(node['price']) ??
        numberFrom(node['lowPrice']) ??
        numberFrom(
          isJsonObject(node['priceSpecification']) ? node['priceSpecification']['price'] : null,
        );
      if (price === null) return undefined;
      return {
        price,
        currency:
          typeof node['priceCurrency'] === 'string' ? node['priceCurrency'].toUpperCase() : null,
        available: availabilityFromSchema(node['availability']),
      };
    });
    if (!offer) return null;

    return {
      price: offer.price,
      currency: offer.currency,
      available: offer.available ?? availabilityFromText(visibleText(snapshot.html)),
      title: null,
      strategy: 'json-ld',
    };
  },
};

/** OpenGraph / product meta tags — `og:price:amount`, `product:price:amount`. */
const metaTags: Strategy = {
  name: 'meta-tags',
  run(snapshot) {
    const meta = readMetaTags(snapshot.html);
    const priceRaw =
      meta['product:price:amount'] ??
      meta['og:price:amount'] ??
      meta['twitter:data1'] ??
      meta['price'];
    if (!priceRaw) return null;

    const money = parseMoney(priceRaw);
    if (!money) return null;

    const currencyRaw = meta['product:price:currency'] ?? meta['og:price:currency'];
    const availabilityRaw = meta['product:availability'] ?? meta['og:availability'];

    return {
      price: money.value,
      currency: currencyRaw?.toUpperCase() ?? money.currency,
      available:
        availabilityFromSchema(availabilityRaw) ??
        (availabilityRaw ? availabilityFromText(availabilityRaw) : null) ??
        availabilityFromText(visibleText(snapshot.html)),
      title: null,
      strategy: 'meta-tags',
    };
  },
};

/** Inline microdata: `<span itemprop="price" content="12.99">`. */
const microdata: Strategy = {
  name: 'microdata',
  run(snapshot) {
    const html = stripNonVisible(snapshot.html);
    for (const match of html.matchAll(/<([a-z0-9-]+)\b([^>]*\bitemprop\s*=\s*["']?price)/gi)) {
      const tagStart = match.index ?? 0;
      const tagEnd = html.indexOf('>', tagStart);
      if (tagEnd === -1) continue;
      const attrs = html.slice(tagStart, tagEnd);

      const money =
        parseMoney(attrValue(attrs, 'content') ?? '') ??
        parseMoney(stripTags(html.slice(tagEnd + 1, tagEnd + 200)));
      if (!money) continue;

      const currencyTag = /itemprop\s*=\s*["']?priceCurrency["']?[^>]*content\s*=\s*["']([^"']+)/i
        .exec(html)?.[1]
        ?.toUpperCase();

      return {
        price: money.value,
        currency: currencyTag ?? money.currency,
        available: availabilityFromText(visibleText(snapshot.html)),
        title: null,
        strategy: 'microdata',
      };
    }
    return null;
  },
};

/** Attribute tokens that mark an element as holding the price the user pays. */
const POSITIVE_TOKENS = ['price', 'preis', 'prix', 'precio', 'prezzo', 'amount', 'money', 'cost'];

/**
 * Tokens that mark a *different* price — the crossed-out original, an add-on, a
 * per-unit figure, a filter widget. Matching one disqualifies the candidate.
 *
 * The add-on group matters more than it looks: marketplace pages inject warranty and
 * accessory offers into the markup *above* the product's own price, so without these
 * the cheapest upsell on the page wins.
 */
const NEGATIVE_TOKENS = [
  // A different price for the same product
  'old',
  'was',
  'strike',
  'compare',
  'list-price',
  'listprice',
  'msrp',
  'rrp',
  'regular',
  'original',
  'range',
  'per-unit',
  'unit-price',
  'history',
  // A price for something that is not this product
  'warranty',
  'accessory',
  'accessories',
  'attach',
  'addon',
  'add-on',
  'protection',
  'insurance',
  'bundle',
  'gift',
  'related',
  'similar',
  'recommend',
  'sponsored',
  'upsell',
  'cross-sell',
  // Not a purchase price at all
  'shipping',
  'delivery',
  'tax',
  'saving',
  'discount',
  'coupon',
  'cashback',
  'reward',
  'exchange',
  'trade-in',
  'emi',
  'installment',
  'instalment',
  'monthly',
  'per-month',
  'subscription',
  'filter',
  'total',
  'subtotal',
  'cart',
  'basket',
];

/** Tokens that make a candidate more likely to be the live selling price. */
const BONUS_TOKENS = [
  'sale',
  'current',
  'now',
  'final',
  'our-price',
  'product-price',
  'sales',
  'selling',
  'offer-price',
  'pricetopay',
  'topay',
  'main',
  'primary',
  'hero',
];

interface PriceCandidate {
  money: Money;
  score: number;
  position: number;
}

/** Attributes worth searching for price-ish naming. */
const SEARCHABLE_ATTRS = [
  'class',
  'id',
  'itemprop',
  'data-testid',
  'data-test',
  'data-qa',
  'data-price-type',
  'data-price',
  'name',
];

/**
 * Groups candidates by value and returns the winner by *consensus*.
 *
 * This is the load-bearing idea, and it is what makes the strategy work on stores it
 * has never seen. A product page states its real price several times over — an
 * accessible off-screen span, the visible digits split across elements, a hidden form
 * input, a data attribute — while a decoy (an upsell, a delivery fee, a crossed-out
 * original) usually appears once or twice. Counting how many independent elements
 * agree on a number is a far better signal than any per-site class name, and unlike a
 * position rule it does not care where in the markup the real price sits.
 */
function pickByConsensus(candidates: PriceCandidate[]): PriceCandidate | null {
  if (candidates.length === 0) return null;

  const groups = new Map<number, { votes: number; best: PriceCandidate; bestScore: number }>();
  for (const candidate of candidates) {
    const key = Math.round(candidate.money.value * 100);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { votes: 1, best: candidate, bestScore: candidate.score });
      continue;
    }
    group.votes += 1;
    if (candidate.score > group.bestScore) {
      group.bestScore = candidate.score;
      group.best = candidate;
    }
  }

  // Agreement is worth a lot, but it saturates: past a handful of mentions an extra
  // repetition says nothing new, and attribute quality should still break ties.
  const ranked = [...groups.values()]
    .map((group) => ({
      candidate: group.best,
      total: group.bestScore + Math.min(group.votes, 6) * 4,
    }))
    .sort((a, b) => b.total - a.total || a.candidate.position - b.candidate.position);

  return ranked[0]?.candidate ?? null;
}

/** Common price-bearing class/id/data attributes, scored and ranked by consensus. */
const commonSelectors: Strategy = {
  name: 'common-selectors',
  run(snapshot) {
    const html = stripNonVisible(snapshot.html);
    const candidates: PriceCandidate[] = [];

    for (const match of html.matchAll(/<([a-z0-9-]+)\b([^>]*)>/gi)) {
      const attrs = match[2] ?? '';
      const searchable = SEARCHABLE_ATTRS.map((name) => attrValue(attrs, name))
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (!searchable) continue;
      if (!POSITIVE_TOKENS.some((token) => searchable.includes(token))) continue;
      if (NEGATIVE_TOKENS.some((token) => searchable.includes(token))) continue;

      const tagStart = match.index ?? 0;
      // `content` and `value` carry the price on <meta> and hidden <input> elements,
      // which have no inner text at all; otherwise read the text that follows.
      const own = attrValue(attrs, 'content') ?? attrValue(attrs, 'value');
      const money = own
        ? parseMoney(own)
        : parseMoney(
            stripTags(html.slice(tagStart + match[0].length, tagStart + match[0].length + 250)),
          );

      // A bare number in `content`/`value` is trustworthy because the attribute is
      // explicitly a price; free text must carry a currency marker to count.
      if (!money) continue;
      if (!own && money.currency === null) continue;
      if (money.value <= 0) continue;

      let score = 10;
      if (BONUS_TOKENS.some((token) => searchable.includes(token))) score += 5;
      if (searchable.includes('price')) score += 2;
      if (own) score += 3;

      candidates.push({ money, score, position: tagStart });
    }

    const best = pickByConsensus(candidates);
    if (!best) return null;

    return {
      price: best.money.value,
      // A machine-readable attribute may omit the symbol; fall back to whatever
      // currency the rest of the candidates agreed on.
      currency:
        best.money.currency ?? candidates.find((c) => c.money.currency)?.money.currency ?? null,
      available: availabilityFromText(visibleText(snapshot.html)),
      title: null,
      strategy: 'common-selectors',
    };
  },
};

/**
 * Last resort for pages with no structured data and no price-ish attributes: the
 * most-repeated currency-formatted number near the top of the page.
 *
 * The original design took the *largest* such number. That turned out to be actively
 * harmful — the biggest figure on a page is typically a financing total, a bulk price
 * or an unrelated item — so this uses the same consensus rule as the selector
 * strategy, falling back to the earliest occurrence when nothing repeats.
 */
const topOfPageHeuristic: Strategy = {
  name: 'heuristic',
  run(snapshot) {
    const text = visibleText(snapshot.html);
    const topRegion = text.slice(0, Math.max(2000, Math.floor(text.length * 0.4)));
    const money = findMoney(topRegion);
    if (money.length === 0) return null;

    const best = pickByConsensus(
      money.map((item) => ({ money: item, score: 10, position: item.index })),
    );
    if (!best) return null;

    return {
      price: best.money.value,
      currency: best.money.currency,
      available: availabilityFromText(text),
      title: null,
      strategy: 'heuristic',
    };
  },
};

/** Availability-only fallback for pages that show no price when sold out. */
const availabilityOnly: Strategy = {
  name: 'availability-only',
  run(snapshot) {
    const available = availabilityFromText(visibleText(snapshot.html));
    if (available === null) return null;
    return { price: null, currency: null, available, title: null, strategy: 'availability-only' };
  },
};

export const STRATEGIES: Strategy[] = [
  selectorOverride,
  jsonLd,
  metaTags,
  microdata,
  commonSelectors,
  topOfPageHeuristic,
  availabilityOnly,
];

export interface ExtractOptions {
  /**
   * Strategy that succeeded last time for this watch. Tried first so repeat checks
   * skip the more expensive scans.
   */
  preferStrategy?: string | null;
}

/**
 * Runs the strategies in order and returns the first usable result, backfilling
 * missing fields (title, availability, currency) from the other strategies.
 */
export function extract(
  snapshot: PageSnapshot,
  options: ExtractOptions = {},
): ExtractResult | null {
  const ordered = orderStrategies(options.preferStrategy);

  let primary: ExtractResult | null = null;
  for (const strategy of ordered) {
    const result = safeRun(strategy, snapshot);
    if (!result) continue;
    if (result.price !== null) {
      primary = result;
      break;
    }
    // Remember the first availability-only hit but keep looking for a price.
    primary ??= result;
  }
  if (!primary) return null;

  if (primary.available === null) {
    primary.available = availabilityFromText(visibleText(snapshot.html));
  }
  primary.title = extractTitle(snapshot);
  return primary;
}

function orderStrategies(preferred?: string | null): Strategy[] {
  if (!preferred) return STRATEGIES;
  const first = STRATEGIES.find((s) => s.name === preferred);
  if (!first) return STRATEGIES;
  return [first, ...STRATEGIES.filter((s) => s !== first)];
}

function safeRun(strategy: Strategy, snapshot: PageSnapshot): ExtractResult | null {
  try {
    return strategy.run(snapshot);
  } catch {
    // A malformed page must never take down a check; fall through to the next one.
    return null;
  }
}
