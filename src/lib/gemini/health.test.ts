import { describe, expect, mock, test } from 'bun:test';

/**
 * `astro:env/server` only exists inside the Astro build. It is mocked before
 * the module under test is imported, matching `live-token.test.ts` — a
 * `beforeAll` hook would run after the module graph had already tried to
 * resolve the real one.
 *
 * The mock is a function over a mutable holder rather than a fixed string,
 * because the `missing` state is one of the four this endpoint exists to
 * distinguish and it cannot be reached with a constant key.
 */
let currentKey: string | undefined = 'test-key-never-real';
mock.module('astro:env/server', () => ({ getSecret: () => currentKey }));

const { classify, probeHealth, redact } = await import('./health');

/**
 * A key-shaped string, assembled rather than written out.
 *
 * `redact` and `classify` are *about* the key shape, so a literal has to be
 * present for the assertions to mean anything — but a key-shaped literal in
 * source is indistinguishable from a real one to any scanner, including this
 * repo's own `check:secrets`. Constructing it keeps the assertion exact and
 * keeps the repository free of anything that looks like a credential.
 * `check-secrets.mjs` builds its positive control the same way.
 */
const FAKE_KEY = `AIza${'S'.repeat(30)}`;

/** A `fetch` stand-in that never touches the network. */
function stubFetch(status: number, body = '', headers: Record<string, string> = {}) {
  return mock(async () => new Response(body, { status, headers })) as unknown as typeof fetch;
}

describe('classify', () => {
  test('a 200 is the only path to `configured`', () => {
    expect(classify(200, '{"models":[]}').state).toBe('configured');
    expect(classify(204, '').state).toBe('configured');
  });

  /**
   * The 400 case is the one that matters most and the one that is easy to get
   * wrong. Phase 0 measured it directly: a preflighted `x-goog-api-key`
   * request against `v1beta` answers `400 API_KEY_INVALID` with a *readable*
   * body, not a 401. A classifier that only looks for 401/403 would report
   * this rejected key as `unknown`, and the endpoint would then be useless for
   * the single most common real failure.
   */
  test('the 400 API_KEY_INVALID answer is `invalid`, not `unknown`', () => {
    const result = classify(400, '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}');
    expect(result.state).toBe('invalid');
  });

  test('401 and 403 are `invalid`', () => {
    expect(classify(401, 'unauthenticated').state).toBe('invalid');
    expect(classify(403, '{"error":{"status":"PERMISSION_DENIED"}}').state).toBe('invalid');
  });

  test('429 is `quota_exhausted` — a working key with no budget left', () => {
    const result = classify(429, '{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}');
    expect(result.state).toBe('quota_exhausted');
  });

  /**
   * The honest fifth state. A 500 from Gemini, an HTML error page from a
   * proxy, or a 404 from a moved endpoint say nothing about the key, and
   * reporting any of them as `configured` would reintroduce the false green
   * this endpoint was written to eliminate.
   */
  test('an uninformative status is `unknown`, never `configured`', () => {
    expect(classify(500, 'upstream boom').state).toBe('unknown');
    expect(classify(404, '<html>Not Found</html>').state).toBe('unknown');
    expect(classify(302, '').state).toBe('unknown');
  });
  test('a detail never carries key material', () => {
    const result = classify(400, `rejected: ${FAKE_KEY}`);
    expect(result.state).toBe('invalid');
    expect(result.detail).not.toContain(FAKE_KEY);
    expect(result.detail).toContain('AIza…');
  });
});

describe('redact', () => {
  test('scrubs a key-shaped substring wherever it appears', () => {
    expect(redact(`key=${FAKE_KEY} trailing`)).toBe('key=AIza… trailing');
  });

  // A scrubber that stopped matching would read as coverage while letting a real
  // key through into `detail`, which is served over /api/health. New keys are
  // `AQ.Ab…`, so this is the format that actually matters now.
  test('scrubs a current AQ auth key too', () => {
    const authKey = `AQ.Ab${'S'.repeat(35)}`;
    expect(redact(`key=${authKey} trailing`)).toBe('key=AIza… trailing');
    expect(redact(authKey)).not.toContain(authKey);
  });

  test('leaves ordinary text alone', () => {
    expect(redact('GEMINI_API_KEY is not set.')).toBe('GEMINI_API_KEY is not set.');
  });

  test('is not fooled by a short or malformed match', () => {
    // Below the pattern's 5-character tail, so it is not a key.
    expect(redact('AIza')).toBe('AIza');
  });
});

describe('probeHealth', () => {
  test('a missing key short-circuits and never calls the network', async () => {
    currentKey = undefined;
    const fetchImpl = mock(() => {
      throw new Error('the probe must not reach the network without a key');
    }) as unknown as typeof fetch;

    const report = await probeHealth({ fetchImpl });
    expect(report.state).toBe('missing');
    // The hint has to name the actual cause: a bare `node dist/server/entry.mjs`
    // cannot see .env, and that has cost real debugging time here before.
    expect(report.detail).toContain('bun run start');
  });

  test('a rejected key is reported as invalid', async () => {
    currentKey = 'test-key-never-real';
    const report = await probeHealth({
      fetchImpl: stubFetch(400, '{"error":{"message":"API key not valid."}}'),
    });
    expect(report.state).toBe('invalid');
  });

  test('an exhausted quota is distinguished from a rejected key', async () => {
    currentKey = 'test-key-never-real';
    const report = await probeHealth({ fetchImpl: stubFetch(429, 'quota') });
    expect(report.state).toBe('quota_exhausted');
  });

  test('a working key is reported as configured, with a timestamp', async () => {
    currentKey = 'test-key-never-real';
    const report = await probeHealth({ fetchImpl: stubFetch(200, '{"models":[]}') });
    expect(report.state).toBe('configured');
    expect(Number.isNaN(Date.parse(report.checkedAt))).toBe(false);
  });

  /**
   * A probe that throws is `unknown`, not `configured` and not `invalid`.
   * This is the case a local-only deployment hits every time, and it is the
   * one that used to be indistinguishable from a bad key.
   */
  test('a network failure is `unknown` and says so', async () => {
    currentKey = 'test-key-never-real';
    const report = await probeHealth({
      fetchImpl: mock(() => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(report.state).toBe('unknown');
    expect(report.detail).toContain('fetch failed');
  });

  /**
   * The probe must not be billable. `models` is a metadata list, not a
   * `generateContent` call, and this app has ten TTS requests a day of free
   * tier to spend. The URL is asserted rather than trusted, because swapping
   * it for a generation call is exactly the kind of change that is invisible
   * in review and expensive in production.
   */
  test('the probe reads the model list, not a generation', async () => {
    currentKey = 'test-key-never-real';
    const seen: string[] = [];
    const fetchImpl = mock(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response('{"models":[]}', { status: 200 });
    }) as unknown as typeof fetch;

    await probeHealth({ fetchImpl });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('/models?');
    expect(seen[0]).toContain('pageSize=1');
    expect(seen[0]).not.toContain('generateContent');
  });

  test('the key is sent in a header, never in the URL', async () => {
    currentKey = 'test-key-never-real';
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), init: init ?? {} });
      return new Response('{"models":[]}', { status: 200 });
    }) as unknown as typeof fetch;

    await probeHealth({ fetchImpl });
    expect(seen[0].url).not.toContain('test-key');
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('test-key-never-real');
  });
});
