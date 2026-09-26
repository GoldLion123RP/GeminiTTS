/**
 * The provider seam (Phase 4.1) — one `request()` in front of five different
 * backends, so 4.5 is a one-line change per call site.
 *
 * WHY THIS IS NOT A TWO-VALUE UNION. The plan described the provider as
 * `'server' | 'byok'`, but the five endpoints are not two kinds of thing:
 *
 *   synthesize  needs a key      -> follow the user's choice
 *   transcribe  needs a key      -> follow the user's choice
 *   live-token  needs a key in the WebSocket *query string*  -> ALWAYS server
 *   estimate    needs nothing   -> never leaves the browser
 *   extract     needs Node (mammoth/unpdf)                   -> ALWAYS server
 *
 * Collapsing that into two cases would have done two wrong things under BYOK:
 * `estimate` would round-trip to our origin for arithmetic the browser already
 * had, and `extract` / `live-token` would be pushed down the browser-key path —
 * which is precisely the key leak this entire mode exists to prevent. The
 * second one is a security regression dressed as a simplification, so the
 * routing is expressed as a table instead of a boolean.
 */

import { estimateText } from '../audio/estimate';
import type { LanguageId } from '../gemini/languages';
import { directSynthesize, directTranscribe, upstreamStatusOf } from './gemini-direct';
import { readKey, readMode, type ProviderMode } from './keystore';
import { recordSpend } from './quota';
import { withRetry } from './retry';

/** Which backend an endpoint resolves to. The whole point of this module. */
export type Route = 'browser' | 'server' | 'always-server' | 'local';

/**
 * The five endpoints that reach a panel.
 *
 * Declared before `ROUTES` and spelled out rather than derived from it: a
 * `Record<Endpoint, Route>` annotation on `ROUTES` makes the alias circular,
 * because `Endpoint` would then be defined in terms of the value that is being
 * annotated. A union written down once is also the honest source of truth —
 * `ROUTES` can then be checked for completeness, rather than defining the
 * universe it is supposed to enumerate.
 */
export type Endpoint = 'synthesize' | 'transcribe' | 'live-token' | 'estimate' | 'extract';

/**
 * The routing table, as data.
 *
 * `live-token` is `always-server` because Phase 0.2 measured it: the Live
 * handshake has no header auth, so the key must ride `?key=` and land in
 * browser history and any intermediary log. That is the one concession BYOK
 * makes, and the settings UI states it rather than hiding it.
 */
export const ROUTES: Readonly<Record<Endpoint, Route>> = {
  synthesize: 'browser',
  transcribe: 'browser',
  'live-token': 'always-server',
  estimate: 'local',
  extract: 'always-server',
};

/**
 * Resolves where `endpoint` should actually run.
 *
 * The `byok` state only *upgrades* endpoints that are marked `browser` in the
 * table. Every other route is fixed by architecture, not by user preference, so
 * no amount of mode-switching can redirect them.
 */
export function routeFor(endpoint: Endpoint, mode: ProviderMode = readMode()): Route {
  const route = ROUTES[endpoint];
  if (route !== 'browser') return route;
  return mode === 'byok' && readKey() !== null ? 'browser' : 'server';
}

/** True when the user has selected their own key *and* one is actually stored. */
export function usingByok(): boolean {
  return readMode() === 'byok' && readKey() !== null;
}

/**
 * The single seam. Returns a `Response` either way, so callers branch on
 * `.ok` and parse a body without knowing which provider answered.
 *
 * `estimate` is served locally by calling `estimateText` directly and wrapping
 * the result, rather than by fetching `/api/estimate`. Under the server provider
 * it would be a wasted round-trip, and the plan's §2.4 note that the endpoint
 * is pure local arithmetic is the reason to trust the in-process call.
 *
 * PHASE 5.2: every dispatch is wrapped in `withRetry`. The retry set is `429`
 * and `503` only — the two answers that arrive *before* Gemini does any work,
 * so a second attempt is free. A 502 (our remap of an upstream 5xx) and a
 * status-0 network failure are deliberately excluded even though a naive
 * `status >= 500` would pick them up: both can follow a request Gemini already
 * charged for, and doubling a user's spend is worse than showing them a "try
 * again" they can act on. The full reasoning is in `retry.ts`.
 */
export async function request(
  endpoint: Endpoint,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  // PHASE 5.3: the seam is the only place that knows a request happened, so
  // the spend log is written here rather than in each panel. A log recorded at
  // four call sites is four chances to forget one — and a meter that misses
  // requests understates the one thing it exists to state.
  const response = await withRetry(() => dispatch(endpoint, body, signal), {
    signal,
    upstreamStatus: upstreamStatusOf,
  });
  recordSpend(endpoint, usingByok() ? 'byok' : 'server', response.ok);
  return response;
}

async function dispatch(
  endpoint: Endpoint,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  if (endpoint === 'estimate') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length === 0) {
      return json({ error: '"text" is required and must be a non-empty string.' }, 400);
    }
    return json(estimateText(text));
  }

  const route = routeFor(endpoint);

  if (route === 'browser') {
    const key = readKey();
    // `routeFor` only returns 'browser' when a key exists. Re-reading here
    // would be the safer shape, so a direct call cannot be made keyless: the
    // fallback keeps the request working on the server path instead of
    // throwing a TypeError deep inside a transport.
    if (key === null) return post(`/api/${endpoint}`, body, signal);

    if (endpoint === 'synthesize') {
      return directSynthesize(key, {
        text: String(body.text ?? ''),
        voice: String(body.voice ?? ''),
        language: (body.language ?? 'auto') as LanguageId,
        signal,
      });
    }
    return directTranscribe(key, {
      audioBase64: String(body.audio ?? ''),
      mimeType: String(body.mimeType ?? 'audio/webm'),
      language: (body.language ?? 'auto') as LanguageId,
      structure: body.structure !== false,
    });
  }

  return post(`/api/${endpoint}`, body, signal);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function post(url: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Whether a given feature can run on the user's own key.
 *
 * `live-token` is excluded on purpose, and this is what the settings UI reads
 * to render an honest note rather than letting someone discover the gap when
 * Live transcription fails to connect.
 */
export function byokCovers(endpoint: Endpoint): boolean {
  return ROUTES[endpoint] === 'browser';
}
