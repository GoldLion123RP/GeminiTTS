import { describe, expect, mock, test } from 'bun:test';

// `astro:env/server` exists only inside the Astro build, and `client.ts` imports
// it for the key. Registered at top level so it is in place before the dynamic
// imports below — a `beforeAll` hook would run too late.
mock.module('astro:env/server', () => ({ getSecret: () => 'test-key-never-real' }));

const {
  BadRequest,
  DEFAULT_MAX_BODY_BYTES,
  PayloadTooLarge,
  failure,
  json,
  readJson,
  requireString,
} = await import('./api-response');
const { ConfigError, GeminiError } = await import('./gemini/client');

describe('json', () => {
  test('serialises the body with a JSON content type', async () => {
    const response = json({ a: 1 });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({ a: 1 });
  });

  test('honours a non-default status', () => {
    expect(json({}, 418).status).toBe(418);
  });
});

describe('failure', () => {
  test('maps a BadRequest to 400 with the message', async () => {
    const response = failure(new BadRequest('nope'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'nope' });
  });

  test('maps a ConfigError to 500 — a missing key is our misconfiguration', async () => {
    const response = failure(new ConfigError('GEMINI_API_KEY is not set.'));
    expect(response.status).toBe(500);
    expect((await response.json() as { error: string }).error).toContain('GEMINI_API_KEY');
  });

  test('preserves a GeminiError status and its raw detail', async () => {
    const response = failure(new GeminiError('plain', { status: 429, detail: 'raw upstream text' }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'plain', detail: 'raw upstream text' });
  });

  test('defaults a GeminiError with no status to 502, not 500', () => {
    expect(failure(new GeminiError('plain')).status).toBe(502);
  });

  test('an unknown throw becomes a generic 500 with no internal detail leaked', async () => {
    const response = failure(new TypeError('cannot read property secretKey of undefined'));
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe('The request could not be completed.');
    expect(body.detail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('secretKey');
  });

  test('never serialises a stack trace', async () => {
    const response = failure(new Error('boom'));
    expect(await response.text()).not.toContain('at ');
  });
});

describe('readJson', () => {
  const request = (body: string) =>
    new Request('http://localhost/api/x', { method: 'POST', body });

  test('returns the parsed object', async () => {
    expect(await readJson(request('{"a":1}'))).toEqual({ a: 1 });
  });

  test('malformed JSON is a 400, not a 500', () => {
    expect(readJson(request('{oops'))).rejects.toBeInstanceOf(BadRequest);
  });

  test('rejects a JSON array', () => {
    expect(readJson(request('[1,2]'))).rejects.toBeInstanceOf(BadRequest);
  });

  test('rejects a JSON null', () => {
    expect(readJson(request('null'))).rejects.toBeInstanceOf(BadRequest);
  });

  test('rejects a JSON scalar', () => {
    expect(readJson(request('7'))).rejects.toBeInstanceOf(BadRequest);
  });

  test('accepts a body exactly at the cap', async () => {
    // The boundary is the interesting case: an off-by-one that rejects a body
    // at the limit would break the largest legitimate upload.
    const filler = 'x'.repeat(1000);
    const body = `{"a":"${filler}"}`;
    const parsed = await readJson(request(body), { maxBytes: body.length });
    expect(parsed.a).toBe(filler);
  });

  test('refuses a body over the cap with a 413, not a 400', async () => {
    const body = `{"a":"${'x'.repeat(5000)}"}`;
    const error = await readJson(request(body), { maxBytes: 1000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayloadTooLarge);
    // A client that retries a 400 unchanged loops forever; 413 is the status
    // that tells it the body, not the request, is the problem.
    expect(failure(error).status).toBe(413);
  });

  test('the cap is enforced from the stream, not from content-length', async () => {
    // A client that omits or lies about `content-length` is exactly the case a
    // limit exists for. Checking only the header would pass this body through.
    const body = `{"a":"${'x'.repeat(5000)}"}`;
    const stripped = new Request('http://localhost/api/x', { method: 'POST', body });
    stripped.headers.delete('content-length');
    expect(stripped.headers.get('content-length')).toBeNull();
    expect(readJson(stripped, { maxBytes: 1000 })).rejects.toBeInstanceOf(PayloadTooLarge);
  });

  test('the default cap admits the largest legitimate upload', async () => {
    // `/api/extract` accepts a 20 MB document, which arrives base64-inflated
    // by 4/3. The cap is derived from that constant; if it drifts below the
    // real payload, a legitimate document is refused by a limit that exists to
    // refuse illegitimate ones.
    const inflated = Math.ceil((20 * 1024 * 1024 * 4) / 3) + 1024;
    expect(DEFAULT_MAX_BODY_BYTES).toBeGreaterThan(inflated);
  });

  test('a bodyless request is still a 400, not a crash', async () => {
    expect(readJson(new Request('http://localhost/api/x', { method: 'POST' }))).rejects.toBeInstanceOf(
      BadRequest,
    );
  });
});

describe('requireString', () => {
  test('returns a present string', () => {
    expect(requireString({ text: 'hi' }, 'text')).toBe('hi');
  });

  test('rejects a missing field', () => {
    expect(() => requireString({}, 'text')).toThrow(BadRequest);
  });

  test('rejects a non-string', () => {
    expect(() => requireString({ text: 7 }, 'text')).toThrow(BadRequest);
  });

  test('rejects a whitespace-only string — it is empty for every caller', () => {
    expect(() => requireString({ text: '   \n ' }, 'text')).toThrow(BadRequest);
  });

  test('rejects a string over the limit and names the limit', () => {
    expect(() => requireString({ text: 'abcdef' }, 'text', { maxLength: 3 })).toThrow(/3 character limit/);
  });

  test('accepts a string exactly at the limit — the bound is inclusive', () => {
    expect(requireString({ text: 'abc' }, 'text', { maxLength: 3 })).toBe('abc');
  });
});
