import { describe, expect, test } from 'bun:test';
import {
  classify,
  KEY_LOCATION,
  KEY_REFUSED,
  keyRejectedMessage,
  keyWasRefused,
  redact,
} from './classify';

/**
 * A key-shaped string, assembled rather than written out.
 *
 * `redact` and `classify` are *about* the key shape, so a literal has to be
 * present for the assertions to mean anything — but a key-shaped literal in
 * source is indistinguishable from a real one to any scanner, including this
 * repo's own `check:secrets`. Concatenating the prefix keeps the assertion exact
 * and keeps the repository free of anything that looks like a credential.
 * `check-secrets.mjs` builds its positive controls the same way.
 */
const LEGACY_KEY = `AIza${'S'.repeat(30)}`;
const AUTH_KEY = `AQ.Ab${'S'.repeat(35)}`;

/**
 * The body Google actually returns for a rejected key, measured 2026-09-27.
 * It is a 400, not a 401 — which is the fact this whole module exists to
 * encode, so the test data is the real shape rather than a convenient one.
 */
const REJECTED_KEY_BODY = '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}';

/** A real request complaint, from the other direction: the request is at fault. */
const BAD_AUDIO_BODY = '{"error":{"code":400,"message":"Audio format must be LINEAR16 at 24000 Hz.","status":"INVALID_ARGUMENT"}}';

describe('classify', () => {
  test('a 200 is the only path to `configured`', () => {
    expect(classify(200, '{"models":[]}').state).toBe('configured');
    expect(classify(204, '').state).toBe('configured');
  });

  test('a 400 carrying API_KEY_INVALID is `invalid`, not `unknown`', () => {
    const result = classify(400, REJECTED_KEY_BODY);
    expect(result.state).toBe('invalid');
    expect(result.detail).toContain('API key not valid');
  });

  test('401 and 403 are `invalid`', () => {
    expect(classify(401, 'unauthenticated').state).toBe('invalid');
    expect(classify(403, '{"error":{"status":"PERMISSION_DENIED"}}').state).toBe('invalid');
  });

  test('429 is `quota_exhausted` — a working key with no budget left', () => {
    expect(classify(429, '{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}').state).toBe('quota_exhausted');
  });

  /**
   * The honest fifth state. A 500 from Gemini, an HTML page from a proxy, or a
   * 302 from something that is not an API at all say nothing about the key, and
   * reporting any of them as `configured` is the false green this classifier
   * exists to eliminate.
   */
  test('an uninformative status is `unknown`, never `configured`', () => {
    expect(classify(500, 'upstream boom').state).toBe('unknown');
    expect(classify(404, '<html>Not Found</html>').state).toBe('unknown');
    expect(classify(302, '').state).toBe('unknown');
  });

  test('a detail is capped and never carries key material', () => {
    const result = classify(400, `rejected: ${LEGACY_KEY}`);
    expect(result.state).toBe('invalid');
    expect(result.detail).not.toContain(LEGACY_KEY);
    expect(result.detail).toContain('AIza…');

    // A verbose upstream body must not become the payload of this endpoint.
    expect(classify(500, 'x'.repeat(5000)).detail.length).toBeLessThanOrEqual(300);
  });
});

describe('keyWasRefused', () => {
  test('a 400 whose body names the key is a refusal', () => {
    expect(keyWasRefused(400, REJECTED_KEY_BODY)).toBe(true);
    expect(keyWasRefused(400, '{"error":{"status":"API_KEY_INVALID"}}')).toBe(true);
  });

  /**
   * The asymmetry that makes the predicate worth having. A 400 about a real
   * field is still a request problem: telling someone their key is broken when
   * their sample rate is wrong sends them off to mint a new credential and hit
   * the same wall. That misdirection is the bug this module was extracted to
   * stop, so it is asserted directly rather than inferred.
   */
  test('a 400 about the request is NOT a key refusal', () => {
    expect(keyWasRefused(400, BAD_AUDIO_BODY)).toBe(false);
    expect(keyWasRefused(400, 'Bad Request')).toBe(false);
  });

  test('401 and 403 are refusals regardless of the body', () => {
    expect(keyWasRefused(401, '')).toBe(true);
    expect(keyWasRefused(403, '')).toBe(true);
    expect(keyWasRefused(400, '')).toBe(false);
  });

  test('nothing else is a refusal, whatever the body says', () => {
    expect(keyWasRefused(429, REJECTED_KEY_BODY)).toBe(false);
    expect(keyWasRefused(500, '')).toBe(false);
  });
});

describe('redact', () => {
  test('scrubs both live key formats wherever they appear', () => {
    expect(redact(`key=${LEGACY_KEY} trailing`)).toBe('key=AIza… trailing');
    expect(redact(`key=${AUTH_KEY} trailing`)).toBe('key=AIza… trailing');
  });

  test('leaves ordinary text alone', () => {
    expect(redact('GEMINI_API_KEY is not set.')).toBe('GEMINI_API_KEY is not set.');
    expect(redact('Audio format must be LINEAR16')).toBe('Audio format must be LINEAR16');
  });

  test('is not fooled by a short or malformed match', () => {
    // Below the pattern's 5-character tail, so it is not a key.
    expect(redact('AIza')).toBe('AIza');
    expect(redact('AQ.')).toBe('AQ.');
  });

  test('a scrubber that stopped matching would read as coverage while leaking', () => {
    const mixed = `first ${LEGACY_KEY} then ${AUTH_KEY} end`;
    const scrubbed = redact(mixed);
    expect(scrubbed).toBe('first AIza… then AIza… end');
    expect(scrubbed).not.toContain('S'.repeat(30));
  });
});

describe('keyRejectedMessage', () => {
  test('each location names its own key, and only its own', () => {
    expect(keyRejectedMessage('page')).toContain(KEY_LOCATION.page);
    expect(keyRejectedMessage('env')).toContain(KEY_LOCATION.env);
  });

  /**
   * Under BYOK there is no `.env` on the user's machine at all, so pointing them
   * at one is a confidently wrong instruction; and the server key is nowhere near
   * the page settings. The two providers share the sentence and nothing else.
   */
  test('neither message points at the other provider’s file', () => {
    expect(keyRejectedMessage('page')).not.toContain('.env');
    expect(keyRejectedMessage('page')).not.toContain('GEMINI_API_KEY');
    expect(keyRejectedMessage('env')).not.toContain('page');
    expect(keyRejectedMessage('env')).toContain('.env');
  });

  test('both are one sentence, so the two providers cannot drift', () => {
    expect(keyRejectedMessage('page').startsWith('Gemini rejected this API key.')).toBe(true);
    expect(keyRejectedMessage('env').startsWith('Gemini rejected this API key.')).toBe(true);
  });
});

describe('KEY_REFUSED', () => {
  /**
   * Three spellings are live at once — the `reason` in the error `details`, the
   * human `message`, and the `status` on some edge configurations — so dropping
   * any one of them would put a real rejected key back into the "just a bad
   * request" bucket. Asserted because a silently narrower regex fails open.
   */
  test('matches all three spellings Google uses', () => {
    expect(KEY_REFUSED.test('API_KEY_INVALID')).toBe(true);
    expect(KEY_REFUSED.test('API key not valid')).toBe(true);
    expect(KEY_REFUSED.test('PERMISSION_DENIED')).toBe(true);
    expect(KEY_REFUSED.test(BAD_AUDIO_BODY)).toBe(false);
  });
});
