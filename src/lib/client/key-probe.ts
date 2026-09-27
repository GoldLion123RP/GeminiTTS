/**
 * "Save and test" — the button that has to test.
 *
 * THE BUG THIS EXISTS TO KEEP FIXED
 *
 * The control in `ByokSettings.astro` is labelled **"Save and test"** and, until
 * this module existed, performed no test at all. It ran a regular expression
 * against the pasted string, stored the result, and told the user to go and
 * generate something to find out whether the key worked. A key that was
 * revoked, mistyped, or from the wrong project was therefore stored, kept, and
 * used — and the first thing the user learned about it was a failure that named
 * their *audio format*.
 *
 * WHY A LIVE PROBE AND NOT A SHAPE CHECK
 *
 * The regex it replaces had no security value to give up: it guarded a
 * credential the visitor pasted into their own browser, which is already in
 * their own `sessionStorage`. A format check there cannot prevent anything, it
 * can only reject — and it was rejecting *valid* keys, because Google changed
 * the format twice in three months. VERIFIED
 * [ai.google.dev/gemini-api/docs/api-key, fetched 2026-09-27]: new AI Studio
 * keys are auth keys prefixed `AQ.Ab…`, and unrestricted `AIza…` keys are
 * rejected outright from September 2026. The maintenance cost of pinning a
 * character class against a provider that publishes no stable key grammar
 * exceeds the cost of one HTTP request.
 *
 * THE PROBE IS NOT BILLABLE
 *
 * `models?pageSize=1`, not `generateContent`. This app runs on ten free TTS
 * requests a day, and a health check that spends quota is a health check that
 * manufactures the outage it is looking for. `gemini/health.ts` established the
 * rule for the server key; this applies it to the user's.
 *
 * The judgement is `classify` from `gemini/classify`, not a second mapping.
 * The browser and the server disagreeing about what a 400 means was the defect,
 * so the fix is one classifier called twice.
 *
 * CORS: measured, not assumed. From the Pages origin Google's edge answers the
 * preflight and echoes `Access-Control-Allow-Origin`, which is why BYOK is a
 * working design on a static host at all.
 */

import { classify, type UpstreamState } from '../gemini/classify';

/** `v1beta`, matching `gemini-direct.ts` and `gemini/health.ts`. */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * The three answers, and no fourth.
 *
 * `unknown` is not a hedge. It exists so a flaky network, an offline laptop or
 * a captive portal says "could not check" instead of "your key is wrong" —
 * pushing someone to regenerate a working credential because their train went
 * into a tunnel is a worse failure than saying less.
 */
export type KeyVerdict = 'accepted' | 'rejected' | 'unknown';

export interface KeyTestResult {
  readonly verdict: KeyVerdict;
  /** The classifier's own state, so a caller can tell an empty project from a working key. */
  readonly state: UpstreamState;
  /** Human-readable and key-free: `classify` redacts before it returns. */
  readonly detail: string;
}

export interface TestKeyOptions {
  /** Injected so the probe is testable without a network. Defaults to `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

/**
 * `quota_exhausted` is `accepted`, deliberately.
 *
 * Gemini answered, and the answer was about the *project's* budget rather than
 * about the credential. The key works — telling the user otherwise would send
 * them to AI Studio to mint a new one and hit the same wall. The state is
 * carried through so the caller can add the reason.
 */
function verdictOf(state: UpstreamState): KeyVerdict {
  if (state === 'configured' || state === 'quota_exhausted') return 'accepted';
  if (state === 'invalid') return 'rejected';
  return 'unknown';
}

/**
 * Asks Google whether the key is good. Never throws.
 *
 * `classify` maps an answer to a state; a *thrown* fetch — offline, DNS
 * failure, a blocked request, an abort — is `unknown` rather than an exception,
 * because every caller of this function is a button handler, and a rejected
 * promise there becomes an unhandled rejection and a button that appears hung.
 * The `signal` is forwarded but never treated as an error: an abort is a
 * deliberate cancellation, and it resolves as `unknown` like any other
 * inconclusive outcome.
 */
export async function testKey(key: string, options: TestKeyOptions = {}): Promise<KeyTestResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const trimmed = key.trim();

  if (trimmed.length === 0) {
    return { verdict: 'rejected', state: 'invalid', detail: 'No key was supplied.' };
  }

  let status: number;
  let body: string;
  try {
    const response = await doFetch(`${BASE}/models?pageSize=1`, {
      headers: { 'x-goog-api-key': trimmed },
      signal: options.signal,
    });
    status = response.status;
    body = await response.text();
  } catch (cause) {
    return {
      verdict: 'unknown',
      state: 'unknown',
      detail: `Could not reach Google to check this key: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    };
  }

  const { state, detail: reason } = classify(status, body);
  return { verdict: verdictOf(state), state, detail: reason };
}
