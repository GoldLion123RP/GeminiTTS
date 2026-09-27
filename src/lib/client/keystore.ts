/**
 * Client-side storage for a user's own Gemini API key (Phase 4 BYOK).
 *
 * Three rules, each of them load-bearing:
 *
 * 1. **Session-only by default.** The key lives in `sessionStorage`, which dies
 *    with the tab. Persisting to `localStorage` is opt-in, per the plan's 4.2.
 *    The default is the safe one because a key in `localStorage` survives every
 *    browser close and is readable by any script on the origin for as long as
 *    the profile lives.
 *
 * 2. **Never in a URL, never in a log.** `sessionStorage` is the widest blast
 *    radius a browser secret can have, and it is still bounded to one tab. The
 *    module exports no function that formats a key into a message, and nothing
 *    here is ever concatenated into an error string.
 *
 * 3. **The mode is cleared on provider change.** Switching back to the server
 *    key must not leave a user key sitting in storage, because "the app is
 *    using the server key now" and "a key is sitting in localStorage forever"
 *    are two different security postures and the UI has to be able to say which
 *    one is true.
 *
 * The key is deliberately NOT a `PUBLIC_` env var and never reaches the server
 * bundle. Nothing in `src/lib/` server code imports this module.
 */

import { serverAvailable } from './capability';

const STORAGE_KEY = 'geminitts.byok.key';
const REMEMBER_KEY = 'geminitts.byok.remember';
const MODE_KEY = 'geminitts.byok.mode';

export type ProviderMode = 'server' | 'byok';

/**
 * WHY THERE IS NO SHAPE CHECK HERE ANY MORE
 *
 * The removed `looksLikeGeminiKey` guarded a credential the visitor pasted into
 * their own browser, so it had no security value: a user who can type a key can
 * also type a different one, and the string never left the origin. All the check
 * could ever do is reject.
 *
 * It rejected the right things for the wrong reasons. Google changed the key
 * format twice in three months — new AI Studio keys are issued as `AQ.Ab…` auth
 * keys, and unrestricted `AIza…` keys are rejected outright from September 2026
 * VERIFIED [ai.google.dev/gemini-api/docs/api-key, fetched 2026-09-27] — so a
 * pinned character class had to be widened twice, and a class wide enough to
 * cover both eras is wide enough to pass a pasted console URL. Pinning a prefix
 * rejects valid keys while passing malformed ones; that is the failure mode, not
 * a stricter check.
 *
 * The replacement asks the only question that actually matters, live and without
 * billing: `testKey` in `src/lib/client/key-probe.ts`.
 */

/**
 * Guarded so this module is importable from a plain unit test and from SSR.
 *
 * Astro renders both panels on the server, and `sessionStorage` does not exist
 * there. Touching it unguarded would throw a `ReferenceError` during the SSR
 * pass — the kind of failure that looks like a build break but is really a
 * missing guard.
 */
function storage(kind: 'session' | 'local'): Storage | null {
  try {
    const store = kind === 'session' ? sessionStorage : localStorage;
    // Touching a property is the only reliable existence probe: Safari's
    // private mode exposes the object and throws only on write.
    store.getItem(STORAGE_KEY);
    return store;
  } catch {
    return null;
  }
}

/** Strips whitespace and any data-URL prefix a paste may carry. */
export function normalizeKey(raw: string): string {
  return raw.trim().replace(/^data:[^;,]+;base64,/, '');
}

function readRemember(): boolean {
  return storage('local')?.getItem(REMEMBER_KEY) === 'true';
}

/**
 * The persisted user choice, not a derived value.
 *
 * A user who ticks "remember" gets `localStorage`; everyone else gets
 * `sessionStorage`. Both stores are cleared on clear, so no residue survives.
 */
function activeStore(remember: boolean): Storage | null {
  return storage(remember ? 'local' : 'session');
}

/**
 * Reads the stored key, falling back across both stores.
 *
 * The fallback is deliberate: a user who ticks "remember" and then unticks it
 * must not have the key stranded in `localStorage`. The remembered flag is
 * cleared on untick, so the next read still finds the session copy.
 */
export function readKey(): string | null {
  const remembered = storage('local')?.getItem(STORAGE_KEY) ?? null;
  if (remembered) return remembered;
  return storage('session')?.getItem(STORAGE_KEY) ?? null;
}

/**
 * Stores a key. `remember` selects the store; changing it migrates the value so
 * the key is never left behind in the other store.
 */
export function writeKey(key: string, remember: boolean): void {
  const value = normalizeKey(key);
  if (value.length === 0) return;

  // Clear both first, then write to the chosen one: a mode switch must not
  // leave a copy in the store that is no longer authoritative.
  storage('local')?.removeItem(STORAGE_KEY);
  storage('session')?.removeItem(STORAGE_KEY);
  activeStore(remember)?.setItem(STORAGE_KEY, value);
  storage('local')?.setItem(REMEMBER_KEY, String(remember));
}

/** Forgets the key and the remember flag. Both stores, unconditionally. */
export function clearKey(): void {
  storage('local')?.removeItem(STORAGE_KEY);
  storage('session')?.removeItem(STORAGE_KEY);
  storage('local')?.removeItem(REMEMBER_KEY);
}

/** Whether the user opted into persistence on this device. */
export function remembersKey(): boolean {
  return readRemember();
}

/**
 * The provider the user selected, or the only one that can work here.
 *
 * The default is a function of the deployment target, not a constant. A default
 * of `'server'` is correct on the node build and provably wrong on the static
 * GitHub Pages one, where `/api/synthesize` is a GitHub 404: the first thing
 * every visitor would have done is type text, wait, and read that 404 explained
 * back to them. The build already knows which of the two it produced
 * (`serverAvailable`, backed by the build-time `BASE_URL`), so the default now
 * reads that fact instead of discarding it and reconstructing it from a failure.
 *
 * `'server'` stays selectable on the static build anyway. A visitor can still
 * pick it and gets an honest 501 that says the deployment has no server, and
 * that is the better of the two outcomes: silently deleting a choice leaves
 * someone wondering why their preference is gone, while an option that explains
 * itself teaches them something true about the deployment.
 *
 * An explicitly stored mode is never overruled. "The user chose this" outranks
 * "this is the sensible default here" — a visitor who has deliberately pinned
 * byok on a server build, or server on a static one, is better served by an
 * attempt that fails honestly than by a preference that silently rewrites
 * itself. And the key's mere presence never changes the mode: a transport that
 * switches on its own makes the trust model invisible.
 */
export function readMode(serverPresent: boolean = serverAvailable()): ProviderMode {
  const stored = storage('local')?.getItem(MODE_KEY);
  if (stored === 'byok' || stored === 'server') return stored;
  return serverPresent ? 'server' : 'byok';
}

export function writeMode(mode: ProviderMode): void {
  storage('local')?.setItem(MODE_KEY, mode);
  // Reverting to the server key must not leave a key behind. See rule 3.
  if (mode === 'server') clearKey();
}
