/**
 * What one upstream Gemini answer means — in ONE place, with no imports.
 *
 * WHY IT IS A SEPARATE MODULE
 *
 * Two callers need this exact judgement and they could not both have it:
 *
 *   1. `gemini/health.ts`, which answers "is OUR key configured?" from the
 *      server. It has had it right since Phase 5.1.
 *   2. `client/gemini-direct.ts` and `client/key-probe.ts`, which answer "is
 *      the USER's key any good?" from the browser.
 *
 * `health.ts` imports `astro:env/server`, which does not exist in a browser
 * bundle or in a plain unit test, so the browser could not import it — and the
 * browser is where the bug was. Measured 2026-09-27: Google answers a
 * *rejected key* with **400 `API_KEY_INVALID`**, not 401. The browser transport
 * branched on status alone, so that 400 fell through to "The audio format,
 * language, or voice may be unsupported" and told the user to check their
 * microphone. `health.ts` already special-cased it, for the server path only.
 *
 * A second mapping that happens to be correct is not a second source of truth,
 * it is a second opportunity to be wrong. One function, imported by both.
 *
 * ZERO IMPORTS, ON PURPOSE. Not a style rule: any import here — even of a leaf
 * — would drag `astro:env/server` or the SDK into whichever bundle imported it
 * second, and the client bundle is the one place that must never see them.
 * `bun test` proves it stays that way, because a stray import would fail to
 * resolve outside the Astro build.
 */

/**
 * The four states a probe can conclude.
 *
 * `missing` is deliberately absent: it is the state where there is no key to
 * ask about, and that is decided before any request is made. It belongs to the
 * caller (`health.ts` has a server environment that can lack the key;
 * `key-probe.ts` is handed one by definition).
 *
 * `unknown` is here because the other three would otherwise force a lie. A 500
 * from Gemini, an HTML page from a proxy, a DNS failure — none of them say
 * anything about the key, and reporting `configured` after one is exactly the
 * class of false green this classification exists to eliminate.
 */
export type UpstreamState = 'configured' | 'invalid' | 'quota_exhausted' | 'unknown';

/**
 * The key shapes, scrubbed from anything that leaves a message.
 *
 * BOTH prefixes, and the second one is the live one. Google issues new AI
 * Studio keys as `AQ.Ab…`, and unrestricted `AIza…` keys are rejected outright
 * from September 2026. A scrubber that only knew `AIza` would pass an `AQ` key
 * straight through into a `detail` string — and a redaction rule that silently
 * stopped matching is worse than no rule, because it reads as coverage.
 *
 * Assembled from pieces rather than written out in tests, so this repository
 * never contains a literal a scanner would have to be trusted to distinguish
 * from a real credential. `check-secrets.mjs` builds its control the same way.
 */
const KEY_LIKE = /(?:AIza|AQ\.)[0-9A-Za-z_-]{5,}/g;

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
 * The words Google uses when the credential, not the request, is the problem.
 *
 * Spelled three ways because three are live: `API_KEY_INVALID` is the `reason`
 * in the error `details`, `API key not valid` is the human `message`, and
 * `PERMISSION_DENIED` is the `status` on some edge configurations.
 */
export const KEY_REFUSED = /API[_ ]KEY[_ ]INVALID|API key not valid|PERMISSION_DENIED/i;

/**
 * Did Gemini reject the KEY, as opposed to the request?
 *
 * This is the question the 400 branch could not answer by looking at the status,
 * and it is the single most consequential predicate in the file: answering it
 * wrongly is what made a valid key look broken and a broken key look like a
 * microphone fault.
 *
 * 401/403 are unconditionally a credential answer. 400 is only one when the
 * body says so — an authentic 400 about a real field (`INVALID_ARGUMENT`,
 * "audio format must be…") is still a request problem and must keep saying so.
 */
export function keyWasRefused(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  return status === 400 && KEY_REFUSED.test(body);
}

/**
 * Maps one upstream answer onto a state. Pure — the whole point.
 *
 * `body` is the raw response text, not a parsed object: Gemini's error shape is
 * `{error:{code,message,status}}`, but a proxy in the middle can return HTML,
 * and a regex over the text answers the cases that matter without a
 * `try`/`catch` around `JSON.parse` on every response.
 */
export function classify(status: number, body: string): { state: UpstreamState; detail: string } {
  // A 400 on `models` is almost always a rejected key, and a 400 on
  // `generateContent` is one only when the body says so. Either way the body is
  // what decides, which is why this branch exists separately from the key
  // status codes below.
  if (status === 400) {
    return keyWasRefused(status, body)
      ? { state: 'invalid', detail: detail(body, 'Gemini rejected the API key.') }
      : { state: 'invalid', detail: detail(body, 'Gemini rejected the request made with this key.') };
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

/**
 * Where the key that Gemini refused actually lives.
 *
 * The bug this type exists to prevent is naming the wrong one. Under the server
 * provider the key is in `.env` on the operator's machine; under BYOK there is
 * no `.env` on the user's machine at all, and telling someone to edit a file
 * that does not exist for them is a confidently wrong instruction. Both
 * transports share `keyWasRefused` and then differ only in this phrase.
 */
export type KeyLocation = 'page' | 'env';

export const KEY_LOCATION: Readonly<Record<KeyLocation, string>> = {
  page: 'Check the key in this page’s settings.',
  env: 'Check GEMINI_API_KEY in your .env file.',
};

/** The full sentence, in one place so the two providers cannot drift apart. */
export function keyRejectedMessage(location: KeyLocation): string {
  return `Gemini rejected this API key. ${KEY_LOCATION[location]}`;
}
