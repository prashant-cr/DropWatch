import { afterEach, describe, expect, it } from 'vitest';
import { isPrivateHost, normalizeUrl, ValidationError } from '../src/server/validate.js';

afterEach(() => {
  delete process.env.DROPWATCH_ALLOW_PRIVATE_HOSTS;
});

describe('normalizeUrl', () => {
  it('adds https:// to a bare host', () => {
    expect(normalizeUrl('store.example.com/p/1')).toBe('https://store.example.com/p/1');
  });

  it('keeps an explicit scheme', () => {
    expect(normalizeUrl('http://store.example.com/')).toBe('http://store.example.com/');
  });

  it('rejects non-web schemes', () => {
    expect(() => normalizeUrl('ftp://files.example.com/x')).toThrow(ValidationError);
    expect(() => normalizeUrl('file:///etc/passwd')).toThrow(ValidationError);
  });

  it('rejects something that is not a hostname at all', () => {
    expect(() => normalizeUrl('not a url')).toThrow(ValidationError);
  });
});

describe('local network guard', () => {
  const blocked = [
    'http://localhost:3000/x',
    'http://127.0.0.1/x',
    'http://10.1.2.3/x',
    'http://192.168.0.1/x',
    'http://172.16.5.4/x',
    'http://172.31.255.255/x',
    'http://169.254.169.254/latest/meta-data', // cloud metadata
    'http://100.64.0.1/x', // CGNAT
    'http://0.0.0.0/x',
    'http://printer.local/x',
    'http://db.internal/x',
    'http://gateway.home.arpa/x',
    'http://[::1]/x',
    'http://[fd00::1]/x',
    'http://[fe80::1]/x',
  ];

  for (const url of blocked) {
    it(`refuses ${url}`, () => {
      expect(() => normalizeUrl(url)).toThrow(/local network/i);
    });
  }

  const allowed = [
    'https://store.example.com/p/1',
    'https://8.8.8.8/x',
    'https://172.15.0.1/x', // just outside 172.16/12
    'https://172.32.0.1/x', // just outside 172.16/12
    'https://192.169.0.1/x', // just outside 192.168/16
    'https://100.63.0.1/x', // just outside 100.64/10
    'https://100.128.0.1/x',
    'https://localhost.example.com/x', // not actually local
  ];

  for (const url of allowed) {
    it(`allows ${url}`, () => {
      expect(() => normalizeUrl(url)).not.toThrow();
    });
  }

  it('lets the opt-in through', () => {
    process.env.DROPWATCH_ALLOW_PRIVATE_HOSTS = '1';
    expect(normalizeUrl('http://192.168.1.10:8080/product')).toBe(
      'http://192.168.1.10:8080/product',
    );
    expect(() => normalizeUrl('http://localhost:3000/x')).not.toThrow();
  });
});

describe('isPrivateHost', () => {
  it('is case-insensitive and tolerates a trailing dot', () => {
    expect(isPrivateHost('LOCALHOST')).toBe(true);
    expect(isPrivateHost('localhost.')).toBe(true);
    expect(isPrivateHost('Printer.Local')).toBe(true);
  });

  it('treats IPv4-mapped IPv6 as the address it wraps', () => {
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateHost('::ffff:8.8.8.8')).toBe(false);
  });

  it('does not mistake a long numeric hostname for an IP', () => {
    expect(isPrivateHost('10.1.2.3.example.com')).toBe(false);
    expect(isPrivateHost('999.999.999.999')).toBe(false);
  });
});
