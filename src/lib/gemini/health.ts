/**
 * `GET /api/health` — the endpoint Phase 5.1 exists for.
 *
 * WHY IT EXISTS
 *
 * The most expensive confusion in this project's history is a 500 whose body
 * says "GEMINI_API_KEY is not set" when the key is in fact fine, because the
 * standalone server bundle loads no `.env` (verified twice; see
 * `scripts/smoke.mjs`). A missing key, a rejected key, and an exhausted quota
 * all collapse into one opaque failure, and the only honest-sounding next step
 * — go and look at the key — is wrong two times out of three.
 *
 * This module answers that question in one request. It is deliberately split
 * into a pure classifier and an impure probe so the interesting part (which
 * upstream answer means what) is unit-testable without a network or a key.
 *
 * THE PROBE IS NOT BILLABLE
 *
 * It is a `models` list with `pageSize=1`, not a `generateContent` call. A
 * health check that spends quota is a health check that manufactures the
 * outage it is looking for, and this app runs on a free tier of ten TTS
 * requests a day.
 *
 * NO KEY MATERIAL, EVER
 *
 * The key is read through `getSecret` and goes out in a header. Nothing in
 * this file formats a key into a message, and `redact` scrubs `AIza…` shaped
 * substrings out of any upstream text that is passed through to the client —
 * upstream error bodies do occasionally echo request headers, and this
 * endpoint's whole audience is people who will paste its output into a bug
 * report.
 */

import { getSecret } from 'astro:env/server';

/** `v1beta`, matching the server path's SDK default and `gemini-direct.ts`. */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * The machine-readable contract.
 *
 * Four states, plus one that exists because the other four would otherwise
 * force a lie:
 *
 *   configured        a key is present and Gemini accepted it
 *   missing           no key in the server's environment
 *   invalid           a key is present and Gemini rejected it
 *   quota_exhausted   the key is fine; the project is out of budget
 *   unknown           the probe itself could not conclude
 *
 * `unknown` is not in the plan's list. It is here because the alternative is
 * mapping a 500 or a DNS failure onto one of the other four, and reporting
 * `configured` when the probe failed is exactly the class of false green this
 * endpoint is meant to eliminate.
 */
export type HealthState = 'configured' | 'missing' | 'invalid' | 'quota_exhausted' | 'unknown';

export interface HealthReport {
  readonly state: HealthState;
  /** Human-readable, key-free. Never contains key material. */
  readonly detail: string;
  /** ISO-8601, for correlating a stale report against a key change. */
  readonly checkedAt: string;
}

/**
 * The key shape, scrubbed from anything that leaves this module.
 *
 * This mirrors `looksLikeGeminiKey` in `lib/client/keystore.ts` but is written
 * independently on purpose: a server module must not import a client module,
 * and a secret-scrubbing rule that depends on a browser `Storage` object is
 * one refactor away from not running at all.
 */
const KEY_LIKE = /AIza[0-9A-Za-z_-]{5,}/g;

/** Replaces anything key-shaped with a fixed, obviously-redacted marker. */
export function redact(text: string): string {
  return text.replace(KEY_LIKE, 'AIza…');
}

/** Caps a detail string so a verbose upstream body cannot become a payload. */
const MAX_DETAIL = 300;

function detail(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  const source = trimmed.length > 0 ? trimmed : fallback;
  return redact(source).slice(0, MAX_DETAIL);
}

/**
 * Maps one upstream answer onto a state. Pure — the whole point.
 *
 * `body` is the raw response text, not a parsed object: Gemini's error shape
 * is `{error:{code,message,status}}`, but a proxy in the middle can return
 * HTML, and a regex over the text answers the two cases that matter (a 400
 * carrying `API key not valid`, and a 429 whose message names the quota)
 * without a `try`/`catch` around `JSON.parse` on every response.
 */
export function classify(status: number, body: string): { state: HealthState; detail: string } {
  // A 400 on `models` is almost always a rejected key. Phase 0 measured
  // exactly this: the preflighted `x-goog-api-key` request answers
  // `400 API_KEY_INVALID` with a readable body rather than a CORS refusal, so
  // a browser hitting this endpoint sees the same thing a server does.
  if (status === 400) {
    if (/API[_ ]KEY[_ ]INVALID|API key not valid/i.test(body)) {
      return { state: 'invalid', detail: detail(body, 'Gemini rejected the API key.') };
    }
    return { state: 'invalid', detail: detail(body, 'Gemini rejected the request made with this key.') };
  }

  if (status === 401 || status === 403) {
    return { state: 'invalid', detail: detail(body, 'Gemini rejected the API key.') };
  }

  if (status === 429) {
    return { state: 'quota_exhausted', detail: detail(body, 'The project has no Gemini quota left right now.') };
  }

  if (status >= 200 && status < 300) {
    return { state: 'configured', detail: 'Gemini accepted the key.' };
  }

  return {
    state: 'unknown',
    detail: detail(body, `The probe reached Gemini but the answer (${status}) says nothing about the key.`),
  };
}

/** Injected so the probe is testable without a network. */
export type FetchLike = typeof fetch;

export interface ProbeOptions {
  readonly fetchImpl?: FetchLike;
  readonly signal?: AbortSignal;
}

/**
 * Reads the key from the server environment and classifies what Gemini says
 * about it.
 *
 * A missing key short-circuits before any network call: there is nothing to
 * ask Gemini, and the round-trip would only add a failure mode to the one
 * answer we can give with certainty.
 *
 * `astro:env/server` is imported statically, as `client.ts` does. It resolves
 * to `process.env[key]` and only exists inside the Astro build, so a unit test
 * mocks it at the top of the file before importing this module — the pattern
 * `lib/gemini/live-token.test.ts` already established.
 */
export async function probeHealth(options: ProbeOptions = {}): Promise<HealthReport> {
  const checkedAt = new Date().toISOString();
  const doFetch = options.fetchImpl ?? fetch;

  const apiKey = getSecret('GEMINI_API_KEY');

  if (!apiKey) {
    return {
      state: 'missing',
      detail:
        'GEMINI_API_KEY is not set in the server environment. Start with `bun run dev` or `bun run start` — a bare `node dist/server/entry.mjs` loads no .env.',
      checkedAt,
    };
  }

  let status: number;
  let body: string;
  try {
    const response = await doFetch(`${BASE}/models?pageSize=1`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: options.signal,
    });
    status = response.status;
    body = await response.text();
  } catch (cause) {
    return {
      state: 'unknown',
      detail: `The health probe could not reach Gemini: ${redact(cause instanceof Error ? cause.message : String(cause))}`,
      checkedAt,
    };
  }

  const { state, detail: reason } = classify(status, body);
  return { state, detail: reason, checkedAt };
}
