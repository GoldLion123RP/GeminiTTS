import { ConfigError, GeminiError } from './gemini/client';

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequest';
  }
}

/**
 * A JSON body with the content type every route in this app speaks.
 *
 * `headers` was added in Phase 5.1 for `/api/health`'s `cache-control:
 * no-store`. It merges rather than replaces, so `content-type` cannot be
 * dropped by a caller who only wanted to add a cache directive — a header map
 * that replaced wholesale would let a future route quietly serve JSON as
 * `text/plain`.
 */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/**
 * Every thrown error becomes a plain-language body. A `GeminiError` keeps its
 * upstream status so 4xx stays 4xx, and its raw detail for the collapsible
 * technical disclosure. A stack trace is never serialised.
 */
export function failure(error: unknown): Response {
  if (error instanceof BadRequest) return json({ error: error.message }, 400);
  if (error instanceof ConfigError) return json({ error: error.message }, 500);
  if (error instanceof GeminiError) {
    return json({ error: error.message, detail: error.detail }, error.status ?? 502);
  }
  return json({ error: 'The request could not be completed.' }, 500);
}

/** Parses a JSON body, converting a malformed one into a 400 rather than a 500. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new BadRequest('Request body must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequest('Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  { maxLength }: { maxLength?: number } = {},
): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequest(`"${field}" is required and must be a non-empty string.`);
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new BadRequest(`"${field}" is longer than the ${maxLength} character limit.`);
  }
  return value;
}
