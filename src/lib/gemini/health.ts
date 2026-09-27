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
 * THE CLASSIFIER IS NOT HERE ANY MORE
 *
 * `classify`, `redact` and `keyWasRefused` moved to `./classify` so the browser
 * transport and this one cannot disagree about what a `400 API_KEY_INVALID`
 * means. Only the server-side half is left: reading OUR key and asking Google
 * about it. The rules the probe obeys are noted at the lines that obey them.
 */

/**
 * `astro:env/server` is imported statically, as `client.ts` does, and that is
 * not a style choice: it resolves to `process.env[key]` and exists only inside
 * the Astro build, so a unit test has to mock the module at the top of the file
 * *before* importing this one — the pattern `live-token.test.ts` established. A
 * `beforeAll` hook runs too late, the real specifier has already been resolved.
 */
import { getSecret } from 'astro:env/server';

import { classify, redact, type UpstreamState } from './classify';

/**
 * Re-exported rather than re-implemented. `health.test.ts` imports `classify`
 * and `redact` from here, and every other caller of this module is a route
 * handler that should not have to know which file owns the mapping.
 */
export { classify, redact };

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
 *
 * The four upstream states are no longer written out here: they are
 * `UpstreamState` from `./classify`, the one definition the browser transport
 * also uses, so a fifth state cannot be added for the server path and forgotten
 * on the client one. `missing` stays local because it is the state where there
 * is no key to ask about, and that is decided here before any request is made —
 * `key-probe.ts` is handed a key by definition and so has no such state.
 */
export type HealthState = UpstreamState | 'missing';

export interface HealthReport {
  readonly state: HealthState;
  /** Human-readable, key-free. Never contains key material. */
  readonly detail: string;
  /** ISO-8601, for correlating a stale report against a key change. */
  readonly checkedAt: string;
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
    // THE PROBE IS NOT BILLABLE. A `models` list with `pageSize=1`, never a
    // `generateContent` call: a health check that spends quota is a health check
    // that manufactures the outage it is looking for, and this app runs on a
    // free tier of ten TTS requests a day. The URL is asserted in
    // `health.test.ts` rather than trusted, because swapping it for a generation
    // call is invisible in review and expensive in production.
    //
    // NO KEY MATERIAL LEAVES THIS MODULE. The key is read through `getSecret`
    // and goes out in a header; nothing here formats one into a message, and
    // `redact` scrubs `AIza…` / `AQ.Ab…` substrings out of any upstream text
    // passed to the client — upstream error bodies do occasionally echo request
    // headers, and this endpoint's whole audience is people who will paste its
    // output into a bug report.
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
