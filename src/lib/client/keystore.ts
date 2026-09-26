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

const STORAGE_KEY = 'geminitts.byok.key';
const REMEMBER_KEY = 'geminitts.byok.remember';
const MODE_KEY = 'geminitts.byok.mode';

export type ProviderMode = 'server' | 'byok';

/** Google auth keys are `AIza…`; anything else is rejected before it is stored. */
const KEY_PATTERN = /^AIza[0-9A-Za-z_-]{20,}$/;

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

/**
 * True when the value is shaped like a Gemini key. A format check is not
 * authentication — a well-formed key can still be revoked — but it catches a
 * pasted URL or a truncated paste before it is persisted anywhere.
 */
export function looksLikeGeminiKey(value: string): boolean {
  return KEY_PATTERN.test(value.trim());
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
 * The provider the user selected.
 *
 * Defaults to `'server'`: a visitor with no key must see exactly today's
 * behaviour. There is no path where a key's mere presence silently switches the
 * transport — that would make the trust model invisible.
 */
export function readMode(): ProviderMode {
  return storage('local')?.getItem(MODE_KEY) === 'byok' ? 'byok' : 'server';
}

export function writeMode(mode: ProviderMode): void {
  storage('local')?.setItem(MODE_KEY, mode);
  // Reverting to the server key must not leave a key behind. See rule 3.
  if (mode === 'server') clearKey();
}
