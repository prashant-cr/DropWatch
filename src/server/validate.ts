/**
 * Hand-rolled request validation. The API surface is small enough that a schema
 * library would be more dependency than it is worth.
 */

/** Fastify turns any thrown error carrying `statusCode` into that HTTP response. */
export class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = 'ValidationError';
  }
}

export const notFound = (message = 'Not found.'): HttpError => new HttpError(404, message);
export const conflict = (message: string): HttpError => new HttpError(409, message);

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('Expected a JSON object body.');
  }
  return value as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`"${key}" is required.`);
  }
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value !== 'string') throw new ValidationError(`"${key}" must be a string.`);
  return value.trim();
}

export function optionalNumber(
  body: Record<string, unknown>,
  key: string,
): number | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new ValidationError(`"${key}" must be a number.`);
  return parsed;
}

export function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  throw new ValidationError(`"${key}" must be a boolean.`);
}

/**
 * Hostname suffixes that only ever resolve inside a local network.
 *
 * `.home.arpa` is the RFC 8375 name for home networks; the others are the de facto
 * conventions (mDNS `.local`, container/VPC `.internal`).
 */
const PRIVATE_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

type Ipv4 = [number, number, number, number];

function ipv4Octets(host: string): Ipv4 | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (!octets.every((n) => n >= 0 && n <= 255)) return null;
  return octets as Ipv4;
}

function isPrivateIpv6(host: string): boolean {
  const address = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (address === '::1' || address === '::') return true;

  // ::ffff:127.0.0.1 and friends are IPv4 wearing an IPv6 hat.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped?.[1]) return isPrivateHost(mapped[1]);

  const leading = address.split(':')[0] ?? '';
  if (/^f[cd]/.test(leading)) return true; // fc00::/7  unique local
  if (/^fe[89ab]/.test(leading)) return true; // fe80::/10 link local
  return false;
}

/**
 * True for hosts that live inside the machine or the local network.
 *
 * Caveat worth knowing: this inspects the URL only. A public hostname whose DNS
 * record points at 10.0.0.1 still passes, because the name is not resolved until
 * the browser navigates. Closing that would mean resolving every URL up front and
 * pinning the result through the fetch, which is more machinery than a loopback
 * tool warrants — this guard exists to stop the obvious cases and to make the
 * intent explicit if DropWatch ever grows auth and multiple users.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost') return true;
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  const octets = ipv4Octets(host);
  if (octets) {
    const [a, b] = octets;
    if (a === 0 || a === 127 || a === 10) return true; // this host, loopback, private
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link local, incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    return false;
  }

  if (host.includes(':')) return isPrivateIpv6(host);
  return false;
}

/** Opt-in for people genuinely watching a store on their own LAN. */
export function privateHostsAllowed(): boolean {
  const raw = process.env.DROPWATCH_ALLOW_PRIVATE_HOSTS;
  return raw === '1' || raw === 'true';
}

/**
 * Accepts a user-typed URL, adding `https://` when the scheme is missing so that
 * pasting `example.com/product` just works.
 *
 * Also refuses to point the checker at the local network. DropWatch drives a real
 * browser at whatever URL ends up in the database and has no authentication, so
 * without this a stray request could be used to reach things the browser can see
 * but the network cannot — a router admin page, a cloud metadata endpoint, another
 * container. Set `DROPWATCH_ALLOW_PRIVATE_HOSTS=1` when that is the actual goal.
 */
export function normalizeUrl(input: string): string {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ValidationError(`"${input}" is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('Only http and https URLs can be watched.');
  }
  // Before the shape check below: a bracketed IPv6 literal has no dot in it, and
  // "[::1] does not look like a website address" would be the wrong explanation.
  if (!privateHostsAllowed() && isPrivateHost(url.hostname)) {
    throw new ValidationError(
      `"${url.hostname}" is on the local network, which DropWatch does not check by default. ` +
        'Set DROPWATCH_ALLOW_PRIVATE_HOSTS=1 if you really are watching a store on your own network.',
    );
  }
  if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.includes(':')) {
    throw new ValidationError(`"${input}" does not look like a website address.`);
  }
  return url.toString();
}

export function parseId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Invalid id.');
  return id;
}

export function parseIntInRange(raw: unknown, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
