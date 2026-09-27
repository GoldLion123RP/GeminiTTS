import { describe, expect, it } from 'bun:test';
import { upstreamFailure, upstreamStatusOf } from './gemini-direct';

/**
 * A key-shaped string, assembled rather than written out.
 *
 * The assertions below are about the key, so a literal has to exist for them to
 * mean anything — but a key-shaped literal in source is indistinguishable from a
 * real one to any scanner, including this repo's own `check:secrets`.
 * `health.test.ts` and `check-secrets.mjs` build their controls the same way.
 */
const FAKE_KEY = `AIza${'S'.repeat(30)}`;

/** The exact body Google returned, measured 2026-09-27. See `classify.ts`. */
const KEY_INVALID_BODY =
  '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID","domain":"googleapis.com"}]}}';

/** The message an authenticated 400 carries when the REQUEST is the problem. */
const REQUEST_BODY =
  '{"error":{"code":400,"message":"Invalid value at \'generation_config.speech_config\' (type.googleapis.com/google.ai.generativelanguage.v1beta.SpeechConfig).","status":"INVALID_ARGUMENT"}}';

const errorOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { error: string }).error;

describe('upstreamFailure — telling a key failure from a request failure', () => {
  /**
   * The defect this whole file exists for.
   *
   * Google answers a *rejected key* with 400 `API_KEY_INVALID`, not 401. The
   * status-400 branch used to return first, so the one copy that said "check
   * your key" was unreachable dead code and every revoked key was reported as
   * an audio-format problem. The words "audio", "format" and "voice" appearing
   * in a key error is the bug, so they are asserted absent — not merely that
   * the right message is present.
   */
  it('names the key when a 400 says API_KEY_INVALID', async () => {
    const response = upstreamFailure(400, KEY_INVALID_BODY);

    expect(response.status).toBe(502);
    const message = await errorOf(response);
    expect(message).toContain('rejected this API key');
    expect(message).toContain('settings');
    expect(message).not.toMatch(/audio|format|voice/i);
  });

  /**
   * The other direction, and the reason the fix reads the body rather than
   * special-casing 400 wholesale: an authentic 400 about a real field is still
   * a request problem and must keep saying so. A gate that reported every 400 as
   * a key failure would send people to regenerate working credentials over a
   * bad voice name.
   */
  it('still reports a real 400 as a request problem', async () => {
    const message = await errorOf(upstreamFailure(400, REQUEST_BODY));

    expect(message).toContain('rejected the request');
    expect(message).not.toContain('API key');
  });

  it('treats 401 and 403 as key failures', async () => {
    expect(await errorOf(upstreamFailure(401, 'unauthenticated'))).toContain('rejected this API key');
    expect(await errorOf(upstreamFailure(403, '{"error":{"status":"PERMISSION_DENIED"}}'))).toContain(
      'rejected this API key',
    );
  });

  /**
   * The two providers share one sentence and differ only in where the key is.
   * Naming `.env` to a BYOK visitor is a confidently wrong instruction — there
   * is no `.env` on their machine. Naming this page's settings to a server
   * operator is the same error pointed the other way.
   */
  it('names the right key location for each provider', async () => {
    const byok = await errorOf(upstreamFailure(400, KEY_INVALID_BODY, 'page'));
    const server = await errorOf(upstreamFailure(400, KEY_INVALID_BODY, 'env'));

    expect(byok).toContain('this page’s settings');
    expect(byok).not.toContain('.env');
    expect(server).toContain('.env');
    expect(server).not.toContain('this page’s settings');
  });

  it('passes 413, 429 and 5xx through with their own copy', async () => {
    expect(upstreamFailure(413, 'too big').status).toBe(413);
    expect(upstreamFailure(429, 'quota').status).toBe(429);
    expect((await errorOf(upstreamFailure(503, 'boom')))).toContain('unavailable');
  });
});

describe('upstreamFailure — the upstream status rides along', () => {
  /**
   * The retry predicate must see Gemini's number, not the remap.
   *
   * A 400 is remapped to 502 so the panel can render sensible copy. A naive
   * `status < 500` retry check then reads 502, calls it transient, and issues a
   * SECOND billable request for one that can never succeed — doubling a user's
   * spend on exactly the input most likely to be rejected. This is why the
   * status is carried out of band, and it is asserted here for the KEY case as
   * well as the request case, because the key case is the one that now takes
   * the 400 branch.
   */
  it('carries the real 400 past the display remap', () => {
    const response = upstreamFailure(400, KEY_INVALID_BODY);
    expect(response.status).toBe(502);
    expect(upstreamStatusOf(response)).toBe(400);
  });

  it('carries the real 401 past the display remap', () => {
    expect(upstreamStatusOf(upstreamFailure(401, 'unauthenticated'))).toBe(401);
  });

  // 429 is already correct as a UI status, so it needs no marker — and a marker
  // on it would be a lie about what the caller is being told.
  it('leaves 429 unmarked, because it is already the status shown', () => {
    const response = upstreamFailure(429, 'quota');
    expect(response.status).toBe(429);
    expect(upstreamStatusOf(response)).toBeUndefined();
  });
});

describe('detail hygiene', () => {
  /**
   * The key goes out in a header and must not come back in a string the UI
   * renders. Upstream error bodies occasionally echo request headers, and this
   * copy is shown to the user and pasted into bug reports.
   */
  it('never echoes key material back into the failure detail', async () => {
    const response = upstreamFailure(400, `rejected: ${FAKE_KEY}`);
    const { detail } = (await response.json()) as { detail: string };

    expect(detail).not.toContain(FAKE_KEY);
  });
});
