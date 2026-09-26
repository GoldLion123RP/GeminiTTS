import { ConfigError, GeminiError } from './gemini/client';

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequest';
  }
}

/**
 * A body larger than the route will accept.
 *
 * Its own class rather than a `BadRequest`, because "your file is too big" and
 * "your JSON is malformed" are different answers and a client retrying a 400
 * unchanged will loop forever on a 413 it never sees.
 */
export class PayloadTooLarge extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadTooLarge';
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
  if (error instanceof PayloadTooLarge) return json({ error: error.message }, 413);
  if (error instanceof ConfigError) return json({ error: error.message }, 500);
  if (error instanceof GeminiError) {
    return json({ error: error.message, detail: error.detail }, error.status ?? 502);
  }
  return json({ error: 'The request could not be completed.' }, 500);
}

/**
 * The default body cap for a JSON route.
 *
 * Sized against the largest legitimate payload in this app rather than picked
 * round: `/api/extract` accepts a document that base64-inflates by 4/3, and
 * `MAX_EXTRACT_BYTES` is 20 MB, so a 20 MB document arrives as ~27 MB of JSON.
 * A cap below that would reject a file the extractor's own limit permits, and
 * the two limits disagreeing is a bug report waiting to happen — so this is
 * derived from the same constant rather than typed twice.
 *
 * The cap is enforced while READING, not after: `request.json()` buffers the
 * entire body first, so a check that runs on the parsed value has already
 * allowed the allocation it was meant to prevent. That is the whole reason
 * this function streams.
 */
export const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;

/**
 * Parses a JSON body, converting a malformed one into a 400 rather than a 500.
 *
 * `maxBytes` bounds the body as it streams in. A missing or absent `body`
 * (a bodyless POST) still produces the same 400 as before, so no route's
 * error handling changes shape.
 */
export async function readJson(
  request: Request,
  { maxBytes = DEFAULT_MAX_BODY_BYTES }: { maxBytes?: number } = {},
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readBody(request, maxBytes);
  } catch (cause) {
    if (cause instanceof PayloadTooLarge) throw cause;
    throw new BadRequest('Request body must be valid JSON.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadRequest('Request body must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequest('Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Reads a request body as text, refusing to buffer more than `maxBytes`.
 *
 * The stream is consumed chunk by chunk and the running total is checked
 * before each chunk is appended, so the process never holds more than the cap
 * plus one chunk. A `content-length` check alone would not do: the header is
 * client-supplied, and a request that omits it or lies about it is exactly the
 * case a limit exists for. It is used only as a cheap early exit.
 */
async function readBody(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PayloadTooLarge(
      `Request body is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
    );
  }

  const body = request.body;
  // No stream (a bodyless request, or a `Request` built without one): the
  // empty string is the correct text, and JSON.parse reports it as malformed.
  if (!body) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Cancel rather than drain: the point is to stop reading, and a
      // half-read body left open keeps the connection and its buffers alive.
      await reader.cancel().catch(() => {});
      throw new PayloadTooLarge(
        `Request body is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
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
