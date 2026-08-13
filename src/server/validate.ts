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
 * Accepts a user-typed URL, adding `https://` when the scheme is missing so that
 * pasting `example.com/product` just works.
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
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
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
