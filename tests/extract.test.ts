import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  availabilityFromText,
  extract,
  findMoney,
  normalizeNumber,
  normalizeSpacing,
  parseMoney,
  readMetaTags,
  type PageSnapshot,
} from '../src/core/scraper/extract.js';

function fixture(name: string, url = 'https://store.example.com/p/1'): PageSnapshot {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return { url, html: readFileSync(path, 'utf8') };
}

describe('normalizeNumber', () => {
  it('parses US grouping', () => {
    expect(normalizeNumber('1,234.50')).toBe(1234.5);
    expect(normalizeNumber('1,234,567.89')).toBe(1234567.89);
  });

  it('parses European grouping', () => {
    expect(normalizeNumber('1.234,50')).toBe(1234.5);
    expect(normalizeNumber('1.234.567,89')).toBe(1234567.89);
  });

  it('treats a lone comma with two decimals as a decimal separator', () => {
    expect(normalizeNumber('149,95')).toBe(149.95);
  });

  it('treats a lone separator with three digits as grouping', () => {
    expect(normalizeNumber('1,299')).toBe(1299);
    expect(normalizeNumber('1.299')).toBe(1299);
  });

  it('ignores thin and non-breaking spaces used as separators', () => {
    expect(normalizeNumber('1 299,00')).toBe(1299);
  });
});

describe('parseMoney', () => {
  it('reads a symbol before the number', () => {
    expect(parseMoney('$1,299.00')).toEqual({ value: 1299, currency: 'USD', index: 1 });
  });

  it('reads a symbol after the number', () => {
    expect(parseMoney('1.299,00 €')?.currency).toBe('EUR');
    expect(parseMoney('1.299,00 €')?.value).toBe(1299);
  });

  it('distinguishes the dollar variants', () => {
    expect(parseMoney('C$49.99')?.currency).toBe('CAD');
    expect(parseMoney('R$49,99')?.currency).toBe('BRL');
  });

  it('reads ISO codes', () => {
    expect(parseMoney('USD 45')?.value).toBe(45);
    expect(parseMoney('45 SEK')?.currency).toBe('SEK');
  });

  it('accepts a bare number with no currency marker', () => {
    expect(parseMoney('  1049.00 ')).toEqual({ value: 1049, currency: null, index: 0 });
  });

  it('rejects text with no number', () => {
    expect(parseMoney('Out of stock')).toBeNull();
  });
});

describe('findMoney', () => {
  it('only returns numbers next to a currency marker', () => {
    const found = findMoney('Rated 4.7 by 2,193 reviewers. Yours for $59.99 today.');
    expect(found).toHaveLength(1);
    expect(found[0]?.value).toBe(59.99);
  });

  it('returns nothing when no currency appears', () => {
    expect(findMoney('Founded in 1998, 4,500 employees')).toHaveLength(0);
  });
});

describe('availabilityFromText', () => {
  it('lets out-of-stock win over a leftover cart button', () => {
    expect(availabilityFromText('Add to cart. Currently unavailable.')).toBe(false);
  });

  it('detects in stock', () => {
    expect(availabilityFromText('In stock — ships today')).toBe(true);
  });

  it('returns null when the page says nothing', () => {
    expect(availabilityFromText('A book about gardening')).toBeNull();
  });
});

describe('readMetaTags', () => {
  it('indexes property, name and itemprop by lowercase key', () => {
    const tags = readMetaTags(fixture('meta-tags.html').html);
    expect(tags['product:price:amount']).toBe('149.95');
    expect(tags['og:title']).toBe("Trail Runner X — Men's");
  });
});

describe('extract — strategy order', () => {
  it('prefers JSON-LD, ignoring the decoy list price earlier in the DOM', () => {
    const result = extract(fixture('json-ld.html'));
    expect(result?.strategy).toBe('json-ld');
    expect(result?.price).toBe(1049);
    expect(result?.currency).toBe('USD');
    expect(result?.available).toBe(true);
    expect(result?.title).toBe('Herman Miller Aeron Chair, Size B');
  });

  it('falls back to meta tags', () => {
    const result = extract(fixture('meta-tags.html'));
    expect(result?.strategy).toBe('meta-tags');
    expect(result?.price).toBe(149.95);
    expect(result?.currency).toBe('USD');
    expect(result?.available).toBe(true);
    expect(result?.title).toBe("Trail Runner X — Men's");
  });

  it('falls back to microdata', () => {
    const result = extract(fixture('microdata.html'));
    expect(result?.strategy).toBe('microdata');
    expect(result?.price).toBe(329);
    expect(result?.currency).toBe('EUR');
    expect(result?.available).toBe(true);
  });

  it('falls back to price-ish selectors, skipping was/compare/shipping/unit prices', () => {
    const result = extract(fixture('common-selectors.html'));
    expect(result?.strategy).toBe('common-selectors');
    expect(result?.price).toBe(57.5);
    expect(result?.currency).toBe('GBP');
  });

  it('handles European number formatting in free text', () => {
    const result = extract(fixture('european-format.html'));
    expect(result?.price).toBe(1299);
    expect(result?.currency).toBe('EUR');
  });

  it('reports a price alongside out-of-stock', () => {
    const result = extract(fixture('out-of-stock.html'));
    expect(result?.price).toBe(499.99);
    expect(result?.available).toBe(false);
  });

  it('returns no price for a page that has none', () => {
    const result = extract(fixture('no-price.html'));
    expect(result?.price ?? null).toBeNull();
  });
});

describe('normalizeSpacing', () => {
  const NBSP = '\u00a0';

  it('closes up a decimal separator split across elements', () => {
    // What tag-stripping leaves behind when a retailer splits the price into
    // <span>14,499</span><span>.</span><span>00</span>.
    expect(normalizeSpacing('14,499 . 00')).toBe('14,499.00');
    expect(normalizeSpacing('1 299 , 90')).toBe('1 299,90');
  });

  it('joins no-break-space thousands grouping', () => {
    expect(normalizeSpacing(`1${NBSP}299,90`)).toBe('1299,90');
    expect(normalizeSpacing(`10${NBSP}999`)).toBe('10999');
  });

  it('leaves plain-space-separated numbers apart', () => {
    // Otherwise two adjacent prices, or prose like "Save 20 000", would fuse.
    expect(normalizeSpacing('89.99 129.99')).toBe('89.99 129.99');
    expect(normalizeSpacing('Save 20 000')).toBe('Save 20 000');
  });
});

describe('findMoney — adjacent numbers', () => {
  it('does not merge two prices separated by a plain space', () => {
    const found = findMoney('$89.99 $129.99');
    expect(found.map((m) => m.value)).toEqual([89.99, 129.99]);
  });
});

describe('extract — picks the right price among decoys', () => {
  it('ignores add-ons above the real price and financing totals below it', () => {
    const result = extract(fixture('marketplace-addons.html'));
    expect(result?.price).toBe(14499);
    expect(result?.currency).toBe('INR');
    expect(result?.available).toBe(true);
  });

  it('does not merge two prices separated only by whitespace', () => {
    const result = extract(fixture('adjacent-prices.html'));
    expect(result?.price).toBe(89.99);
    // The failure this guards against produced a five-figure number.
    expect(result?.price).toBeLessThan(1000);
  });

  it('reassembles a price split across spans with no-break grouping', () => {
    const result = extract(fixture('split-price-spans.html'));
    expect(result?.price).toBe(1299.9);
    expect(result?.currency).toBe('EUR');
  });

  it('still prefers structured data when the page provides it', () => {
    expect(extract(fixture('json-ld.html'))?.strategy).toBe('json-ld');
  });
});

describe('extract — titles', () => {
  it('keeps a variant suffix that came from og:title', () => {
    const result = extract(fixture('meta-tags.html'));
    expect(result?.title).toBe("Trail Runner X — Men's");
  });

  it('trims store branding off a <title> tag', () => {
    const snapshot: PageSnapshot = {
      url: 'https://example.com/p',
      html: '<html><head><title>Espresso Machine Pro | Kaffeehaus</title></head><body>$99</body></html>',
    };
    expect(extract(snapshot)?.title).toBe('Espresso Machine Pro');
  });

  it('keeps hyphenated names in a <title> tag', () => {
    const snapshot: PageSnapshot = {
      url: 'https://example.com/p',
      html: '<html><head><title>Wi-Fi Range Extender AC1200</title></head><body>$99</body></html>',
    };
    expect(extract(snapshot)?.title).toBe('Wi-Fi Range Extender AC1200');
  });
});

describe('extract — selector override', () => {
  const snapshot: PageSnapshot = {
    ...fixture('json-ld.html'),
    selectorText: '$1,395.00',
  };

  it('wins over every automatic strategy', () => {
    const result = extract(snapshot);
    expect(result?.strategy).toBe('selector-override');
    expect(result?.price).toBe(1395);
  });

  it('is skipped when the selector matched nothing', () => {
    const result = extract({ ...snapshot, selectorText: '' });
    expect(result?.strategy).toBe('json-ld');
  });
});

describe('extract — cached strategy', () => {
  it('tries the remembered strategy first', () => {
    const result = extract(fixture('json-ld.html'), { preferStrategy: 'common-selectors' });
    expect(result?.strategy).toBe('common-selectors');
  });

  it('falls back to the normal order when the remembered one no longer works', () => {
    const result = extract(fixture('meta-tags.html'), { preferStrategy: 'json-ld' });
    expect(result?.strategy).toBe('meta-tags');
  });
});

describe('extract — resilience', () => {
  it('survives malformed JSON-LD', () => {
    const snapshot: PageSnapshot = {
      url: 'https://example.com/p',
      html: `<html><head><title>Thing</title>
        <script type="application/ld+json">{ this is not json }</script>
        <meta property="product:price:amount" content="19.99">
        </head><body>In stock</body></html>`,
    };
    const result = extract(snapshot);
    expect(result?.price).toBe(19.99);
  });

  it('returns null for an empty document', () => {
    expect(extract({ url: 'https://example.com', html: '' })).toBeNull();
  });
});
