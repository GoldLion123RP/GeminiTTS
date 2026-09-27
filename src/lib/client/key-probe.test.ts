import { describe, expect, it } from 'bun:test';
import { testKey } from './key-probe';

/**
 * A key-shaped string, assembled rather than written out — a literal in source
 * is indistinguishable from a real credential to `check:secrets`, which scans
 * this tree. The assertions below are about the key, so one has to exist for
 * them to mean anything.
 */
const FAKE_KEY = `AIza${'S'.repeat(30)}`;

/** A `fetch` stand-in that never touches the network. */
const stub = (status: number, body = '') =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

const KEY_INVALID_BODY =
  '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID","domain":"googleapis.com"}]}}';

describe('testKey — the three answers', () => {
  it('accepts a key Gemini accepted', async () => {
    const result = await testKey(FAKE_KEY, { fetchImpl: stub(200, '{"models":[]}') });

    expect(result.verdict).toBe('accepted');
    expect(result.state).toBe('configured');
  });

  /**
   * The measurement that makes this module necessary: a rejected key comes back
   * as 400 `API_KEY_INVALID`, not 401. A probe that only understood 401/403
   * would report every revoked key as inconclusive, and the user would be told
   * "could not check" while staring at a definitive refusal.
   */
  it('rejects a key Gemini refused, on a 400', async () => {
    const result = await testKey(FAKE_KEY, { fetchImpl: stub(400, KEY_INVALID_BODY) });

    expect(result.verdict).toBe('rejected');
    expect(result.state).toBe('invalid');
  });

  it('rejects on 401 and 403 too', async () => {
    expect((await testKey(FAKE_KEY, { fetchImpl: stub(401, 'no') })).verdict).toBe('rejected');
    expect((await testKey(FAKE_KEY, { fetchImpl: stub(403, 'no') })).verdict).toBe('rejected');
  });

  /**
   * `unknown` is not a hedge — it is the state that keeps a flaky network from
   * being reported as a bad credential. Pushing someone to regenerate a working
   * key because their train went into a tunnel is a worse failure than saying
   * less, and it is not recoverable by the user.
   */
  it('reports a thrown fetch as unknown, not as a bad key', async () => {
    const result = await testKey(FAKE_KEY, {
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.detail).toContain('fetch failed');
  });

  it('reports an uninformative status as unknown', async () => {
    expect((await testKey(FAKE_KEY, { fetchImpl: stub(500, 'boom') })).verdict).toBe('unknown');
    expect((await testKey(FAKE_KEY, { fetchImpl: stub(404, '') })).verdict).toBe('unknown');
  });

  /**
   * A 429 is about the PROJECT's budget, not the credential. Gemini answered,
   * and the key demonstrably works. Reporting it as `rejected` would send the
   * user to AI Studio to mint a new key and hit the identical wall.
   */
  it('treats an exhausted quota as an accepted key with a reason', async () => {
    const result = await testKey(FAKE_KEY, { fetchImpl: stub(429, 'quota exceeded') });

    expect(result.verdict).toBe('accepted');
    expect(result.state).toBe('quota_exhausted');
  });

  it('refuses an empty key without spending a request', async () => {
    let called = false;
    const result = await testKey('   ', {
      fetchImpl: (async () => {
        called = true;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(called).toBe(false);
    expect(result.verdict).toBe('rejected');
  });
});

describe('testKey — the probe is not billable and does not leak', () => {
  /**
   * This app has ten free TTS requests a day. A health check that spends quota
   * manufactures the outage it is looking for, so the URL is asserted rather
   * than trusted — swapping it for a generation call is invisible in review and
   * expensive in production.
   */
  it('reads the model list, never a generation', async () => {
    const seen: string[] = [];
    await testKey(FAKE_KEY, {
      fetchImpl: (async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response('{"models":[]}', { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('/models?');
    expect(seen[0]).toContain('pageSize=1');
    expect(seen[0]).not.toContain('generateContent');
  });

  /**
   * A header is not written to `history`, not copied into a `Referer`, and not
   * logged by intermediaries the way `?key=` is. It also forces a CORS
   * preflight, which Phase 0.1 measured Google's edge answering from the Pages
   * origin — which is the whole reason BYOK works on a static host.
   */
  it('carries the key in a header and never in the URL', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    await testKey(FAKE_KEY, {
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({
          url: String(input),
          headers: (init?.headers ?? {}) as Record<string, string>,
        });
        return new Response('{"models":[]}', { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(seen[0].url).not.toContain('AIza');
    expect(seen[0].url).not.toContain('key=');
    expect(seen[0].headers['x-goog-api-key']).toBe(FAKE_KEY);
  });

  it('trims a paste that carried surrounding whitespace', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    await testKey(`  ${FAKE_KEY}\n`, {
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: '', headers: (init?.headers ?? {}) as Record<string, string> });
        return new Response('{"models":[]}', { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(seen[0].headers['x-goog-api-key']).toBe(FAKE_KEY);
  });

  /**
   * The probe is called from a button handler, where a rejected promise becomes
   * an unhandled rejection and a control that appears permanently hung. The
   * contract is that it resolves.
   */
  it('never throws', () => {
    expect(
      testKey(FAKE_KEY, {
        fetchImpl: (async () => {
          throw new DOMException('aborted', 'AbortError');
        }) as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ verdict: 'unknown' });
  });

  it('never echoes key material back in its detail', async () => {
    const result = await testKey(FAKE_KEY, { fetchImpl: stub(400, `rejected: ${FAKE_KEY}`) });

    expect(result.detail).not.toContain(FAKE_KEY);
  });
});
