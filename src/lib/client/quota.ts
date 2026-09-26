/**
 * The client-side request log behind the quota meter — Phase 5.3.
 *
 * WHAT THIS IS NOT
 *
 * A rate limiter. A rate limiter has to know the provider's real remaining
 * budget, and the browser cannot know it: under the server provider the
 * counter lives in Google's project, not in this tab, and under BYOK the
 * counter lives in the user's project and our server never sees a single
 * request. A local counter that pretended to enforce anything would be a
 * lie with a progress bar on it.
 *
 * What it actually is: a log of requests *this device* made, so a user about
 * to spend their tenth request of the day is told so before it happens. The
 * UI copy says exactly that — "requests this device has made" — because the
 * only truthful framing of a local counter is a local one. The plan reached
 * the same conclusion in §2.4.
 *
 * WHY PACIFIC DAYS
 *
 * Gemini's free-tier daily limits reset at midnight Pacific — VERIFIED
 * [ai.google.dev/gemini-api/docs/rate-limits, fetched 2026-09-26]. Bucketing
 * by the browser's local day would show a reset at midnight for a user in
 * Kolkata, which is nine hours and a half after the real one, and would
 * cheerfully invite exactly the over-spend the meter exists to prevent. The
 * boundary is the provider's, not the reader's.
 *
 * STORAGE IS BEST-EFFORT, ALWAYS
 *
 * Every access is guarded, for the same reason `keystore.ts` guards its own:
 * Safari's private mode exposes `localStorage` and throws only on write. A
 * meter that throws inside the request path would turn a cosmetic feature
 * into an outage.
 */

const LOG_KEY = 'geminitts.quota.log';
const REMEMBER_KEY = 'geminitts.quota.remember';

/**
 * The cap. This is a spend *log* for a daily ceiling of ten, so the useful
 * window is small; the cap exists so the log cannot grow without bound in a
 * tab left open for a month, not because the numbers ever get that large.
 */
const MAX_ENTRIES = 200;

export interface SpendEntry {
  /** Which endpoint was called. Matches `provider.Endpoint`. */
  readonly endpoint: string;
  /**
   * Which provider carried the request. Keyed per provider because the two
   * budgets are genuinely different projects: the server's key spends *our*
   * free tier, and a BYOK key spends the user's. Merging them into one number
   * would hide exactly the distinction that decides whether someone should
   * keep going.
   */
  readonly provider: 'server' | 'byok';
  /** Whether the call ultimately succeeded. */
  readonly ok: boolean;
  /** Epoch milliseconds. */
  readonly at: number;
}

export interface SpendSummary {
  /** Number of requests made today, Pacific time. */
  readonly today: number;
  /** How many of today's requests were carried by the user's own key. */
  readonly byok: number;
  /** How many of today's requests failed. */
  readonly failed: number;
  /** The day bucket these counts belong to, `YYYY-MM-DD` in Pacific time. */
  readonly day: string;
  /** True when this count comes from remembered history rather than this tab. */
  readonly remembered: boolean;
}

/** Fired on `window` after a request is recorded, so open meters can redraw. */
export const SPEND_EVENT = 'geminitts:spend';

/** Endpoints that reach the network. `estimate` is local arithmetic. */
const NETWORKED = new Set(['synthesize', 'transcribe', 'live-token', 'extract']);

function store(kind: 'local' | 'session'): Storage | null {
  try {
    const s = kind === 'local' ? localStorage : sessionStorage;
    s.getItem(LOG_KEY);
    return s;
  } catch {
    return null;
  }
}

/** The log lives in `sessionStorage` unless the user asks to keep it. */
function activeStore(): Storage | null {
  return store(store('local')?.getItem(REMEMBER_KEY) === 'true' ? 'local' : 'session');
}

function read(): SpendEntry[] {
  try {
    const raw = activeStore()?.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Each entry is validated rather than cast. The log is user-writable —
    // anyone with devtools can edit it — and one malformed object reaching the
    // renderer would be an unhandled `undefined.toLocaleString()`.
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function isEntry(value: unknown): value is SpendEntry {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.endpoint === 'string' &&
    (record.provider === 'server' || record.provider === 'byok') &&
    typeof record.ok === 'boolean' &&
    typeof record.at === 'number' &&
    Number.isFinite(record.at)
  );
}

function write(entries: SpendEntry[]): void {
  try {
    // The tail is kept, not the head: the newest entries are the ones a user
    // looking at a daily meter cares about.
    activeStore()?.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* storage full or unavailable — the meter degrades to "no history" */
  }
}

/**
 * Today, in Pacific time, as `YYYY-MM-DD`.
 *
 * `en-CA` is the locale whose short date format *is* ISO-8601, so this needs
 * no manual assembly of year/month/day — and `timeZone` does the boundary.
 */
export function pacificDay(at: number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(at));
  } catch {
    // An environment without ICU (some minimal server-side renders) falls
    // back to the UTC day. Wrong by hours at worst, and it is a counter, not
    // a billing record — better than throwing inside a request.
    return new Date(at).toISOString().slice(0, 10);
  }
}

/**
 * Records one request.
 *
 * Returns silently on anything it cannot record. A meter that fails loudly
 * would be a worse bug than a meter that under-counts.
 */
export function recordSpend(endpoint: string, provider: 'server' | 'byok', ok: boolean): void {
  if (!NETWORKED.has(endpoint)) return;

  // Yesterday's entries are dropped rather than kept and filtered: the meter
  // only ever reports today, so retaining them is storage spent on a number
  // nobody will read.
  const today = pacificDay();
  const kept = read().filter((entry) => pacificDay(entry.at) === today);
  kept.push({ endpoint, provider, ok, at: Date.now() });
  write(kept);
  announce();
}

/**
 * Tells any open meter to redraw.
 *
 * A poll would be the alternative, and it would be worse on every axis: it
 * costs a timer on every page for a number that changes only when the user
 * does something, and it needs a teardown path. An event is a few lines and no
 * lifecycle. Wrapped in a guard because the meter only exists on the two tool
 * routes and `recordSpend` runs on the landing page too.
 */
function announce(): void {
  try {
    window.dispatchEvent(new CustomEvent(SPEND_EVENT));
  } catch {
    /* no window (SSR) or no CustomEvent — nothing is listening anyway */
  }
}

/** Today's counts. Never throws; a broken log reads as an empty one. */
export function summariseSpend(at: number = Date.now()): SpendSummary {
  const day = pacificDay(at);
  const entries = read().filter((entry) => pacificDay(entry.at) === day);

  return {
    today: entries.length,
    byok: entries.filter((entry) => entry.provider === 'byok').length,
    failed: entries.filter((entry) => !entry.ok).length,
    day,
    remembered: store('local')?.getItem(REMEMBER_KEY) === 'true',
  };
}

/** Opt into keeping the log between visits. Off by default, like the key. */
export function setRememberSpend(remember: boolean): void {
  const entries = read();
  store('local')?.setItem(REMEMBER_KEY, String(remember));
  // Migrate rather than clear: ticking "remember" must not erase the history
  // the user is looking at, and unticking must not strand it in `localStorage`
  // where the meter would stop seeing it.
  store('local')?.removeItem(LOG_KEY);
  store('session')?.removeItem(LOG_KEY);
  try {
    store(remember ? 'local' : 'session')?.setItem(LOG_KEY, JSON.stringify(entries));
  } catch {
    /* best effort */
  }
  announce();
}

/** Forgets the log and the remember flag. */
export function clearSpend(): void {
  store('local')?.removeItem(LOG_KEY);
  store('session')?.removeItem(LOG_KEY);
  store('local')?.removeItem(REMEMBER_KEY);
  announce();
}
