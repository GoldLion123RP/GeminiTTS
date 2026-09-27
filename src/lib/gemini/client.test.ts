import { describe, expect, mock, test } from 'bun:test';

/**
 * `astro:env/server` only exists inside the Astro build, so it is mocked before
 * the module under test is imported — the same order `health.test.ts` and
 * `live-token.test.ts` established, for the same reason: a `beforeAll` hook runs
 * after the real specifier has already been resolved.
 */
mock.module('astro:env/server', () => ({ getSecret: () => 'test-key-never-real' }));

const { asGeminiError, ConfigError, GeminiError, MISSING_KEY_MESSAGE } = await import('./client');
const { keyRejectedMessage } = await import('./classify');

/** The key copy both providers now share, asserted rather than re-typed. */
const KEY_COPY = keyRejectedMessage('env');

/** The honest request-problem copy, likewise taken from the source. */
const AUDIO_COPY = 'Gemini rejected the request. The audio format, language, or voice may be unsupported.';

/**
 * An upstream failure as the SDK hands it over: an `Error` carrying a numeric
 * `status`. A plain object would not do — `asGeminiError` reads the message via
 * `instanceof Error`, so an object literal would arrive as `"[object Object]"`
 * and every body assertion below would be vacuously true.
 */
function upstream(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe('asGeminiError — the dead 400 branch', () => {
  /**
   * The regression this file exists for. Measured 2026-09-27: Google answers a
   * rejected key with `400 API_KEY_INVALID`, not 401. The old `plainMessage`
   * returned the audio-format copy for every 400 and left its own key test
   * unreachable, so a revoked server key was reported to the operator as a
   * microphone problem.
   */
  test('a 400 carrying "API key not valid" is a KEY failure, not an audio one', () => {
    const error = asGeminiError(upstream(400, 'API key not valid. Please pass a valid API key.'));
    expect(error.message).toBe(KEY_COPY);
    expect(error.message).toContain('.env');
    expect(error.message).not.toBe(AUDIO_COPY);
  });

  test('a 400 that is a real request complaint keeps the audio copy', () => {
    const error = asGeminiError(upstream(400, 'Audio format must be LINEAR16 at 24000 Hz.'));
    expect(error.message).toBe(AUDIO_COPY);
    expect(error.message).not.toContain('.env');
  });

  test('the raw upstream text is preserved in `detail` for the disclosure', () => {
    const error = asGeminiError(upstream(400, 'API key not valid. Please pass a valid API key.'));
    expect(error.status).toBe(400);
    expect(error.detail).toBe('API key not valid. Please pass a valid API key.');
  });
});

describe('asGeminiError — status mapping', () => {
  test('401 and 403 are key failures, through the same shared sentence', () => {
    expect(asGeminiError(upstream(401, 'unauthenticated')).message).toBe(KEY_COPY);
    expect(asGeminiError(upstream(403, '{"error":{"status":"PERMISSION_DENIED"}}')).message).toBe(KEY_COPY);
  });

  test('413, 429 and 5xx keep their own copy', () => {
    expect(asGeminiError(upstream(413, 'too big')).message).toContain('too large');
    expect(asGeminiError(upstream(429, 'slow down')).message).toContain('rate limit');
    expect(asGeminiError(upstream(503, 'unavailable')).message).toContain('unavailable');
  });

  test('a quota complaint is named as a quota, not as a rate limit', () => {
    // Only reachable on a status that is not already spoken for. 429 is handled
    // above it and reports a rate limit, which is the existing behaviour and is
    // left alone — so the billing case is asserted on the status that actually
    // reaches this line.
    expect(asGeminiError(upstream(402, 'Quota exceeded for quota metric')).message).toContain('exceeded the quota');
  });

  test('an unrecognised status falls back to the generic sentence', () => {
    expect(asGeminiError(upstream(418, 'teapot')).message).toBe('Gemini could not complete the request.');
    expect(asGeminiError(new Error('no status at all')).message).toBe('Gemini could not complete the request.');
  });
});

describe('asGeminiError — configuration failures', () => {
  /**
   * A missing key is our misconfiguration, not an upstream failure, so it keeps
   * a 500 of our own. Reporting it as a bad gateway (502) would send an operator
   * to Gemini for a problem that lives in their own `.env`.
   */
  test('a ConfigError keeps status 500 and its own message', () => {
    const error = asGeminiError(new ConfigError(MISSING_KEY_MESSAGE));
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.status).toBe(500);
    expect(error.message).toBe(MISSING_KEY_MESSAGE);
    // Deliberately not the shared key-refusal copy: Gemini never rejected
    // anything here, so it must not be reported as a rejected key.
    expect(error.message).not.toBe(KEY_COPY);
  });

  test('an error that is already a GeminiError passes through untouched', () => {
    const original = new GeminiError('already mapped', { status: 400, detail: 'body' });
    expect(asGeminiError(original)).toBe(original);
  });
});
