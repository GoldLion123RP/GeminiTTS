/**
 * Retry with exponential backoff and full jitter — Phase 5.2.
 *
 * THE RETRY SET IS TWO STATUSES, AND THAT IS THE WHOLE DESIGN
 *
 * The obvious implementation is `if (status >= 500) retry`. It is wrong here,
 * and wrong in the way that costs real money rather than merely being
 * inelegant, because the two statuses it would pick up have already been
 * billed upstream:
 *
 *   502  This app reports "I could not get an answer from Gemini" as 502 —
 *        either because Gemini itself answered 5xx (it started work and then
 *        fell over partway through) or because the request never came back at
 *        all (`UNREACHABLE` in `gemini-direct.ts`). Re-sending the whole
 *        request re-generates every chunk that already succeeded.
 *
 *   500  Our own server never emits it, and if it did it would be our bug
 *        rather than Gemini's. A status that can only mean "this deployment is
 *        broken" is not something a second identical request fixes.
 *
 * What remains is what a refusal looks like: Gemini said no before doing any
 * work, so nothing was billed and a second attempt is free.
 *
 *   429  rate limited — the canonical retryable answer
 *   503  service unavailable — the canonical transient answer
 *
 * The asymmetry is the point. This app talks to a free tier with a hard daily
 * ceiling, so the failure mode of an over-eager retry is a user whose quota
 * is gone by the time they notice, and the failure mode of an under-eager one
 * is a message that says "try again" — which the UI already offers via its
 * explicit Try again button. Under-retrying is recoverable; over-retrying
 * spends money that is already spent.
 *
 * The 400-remapped-to-502 bug in `gemini-direct.ts` is the same trap one step
 * further along: a naive `status < 500` check read a UI status of 502,
 * decided "transient", and issued a second billable request for an input that
 * could never succeed. Here the upstream status travels out of band, and
 * `shouldRetry` reads *that*, never the number the UI will render.
 */

/** The only statuses worth a second attempt. See the note above. */
const RETRYABLE: ReadonlySet<number> = new Set([429, 503]);

/** Total attempts, including the first. Three means at most two retries. */
export const MAX_ATTEMPTS = 3;

/** First backoff ceiling, doubled per attempt. */
const BASE_DELAY_MS = 400;
const MAX_DELAY_MS = 4_000;

/**
 * True when this response is worth retrying.
 *
 * `upstream` is the *real* status, passed separately because both transports
 * remap it for display. When it is absent — a plain 503 from our own server,
 * say — the response's own status is authoritative.
 */
export function shouldRetry(response: Response, upstream?: number): boolean {
  return RETRYABLE.has(upstream ?? response.status);
}

/**
 * Full jitter: the delay is uniform over `[0, ceiling]`, not `ceiling ± noise`.
 *
 * The distinction is not cosmetic. Fixed or narrow-window backoff from many
 * clients that were all refused at the same instant re-creates the same
 * thundering herd one `base * 2^n` later, which is the entire phenomenon
 * backoff exists to break. The cost is that the delay is sometimes near zero;
 * that is acceptable, because the attempt ceiling still bounds the total.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);
  return Math.round(random() * ceiling);
}

/**
 * `Retry-After` is honoured when Gemini sends one, because it is a better
 * estimate than any local formula — but it is clamped. An untrusted or
 * mistaken `Retry-After: 86400` would otherwise park a tab on a promise it
 * cannot keep, and the UI has no way to render a wait that long honestly.
 */
export function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (raw === null) return null;

  const seconds = Number(raw);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : // HTTP-date form. `Date.parse` yields NaN on a malformed value, which the
      // finite check below then rejects.
      Date.parse(raw) - Date.now();

  if (!Number.isFinite(delay) || delay <= 0) return null;
  return Math.min(delay, MAX_DELAY_MS);
}

/** A sleep that a cancelled request does not have to sit through. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RetryOptions {
  readonly signal?: AbortSignal;
  readonly attempts?: number;
  /** Injected for tests; the default is `Math.random`. */
  readonly random?: () => number;
  /** Observability hook. Receives the 1-based number of the attempt just made. */
  readonly onRetry?: (attempt: number, delayMs: number) => void;
  /**
   * Reads the *real* upstream status off a response, for transports that remap
   * one for display. Defaults to the response's own status.
   *
   * Injected rather than imported from `gemini-direct.ts` so this module stays
   * free of a dependency on the browser transport — the server provider path
   * never loads it, and a module that reaches for it unconditionally would
   * pull the whole direct-transport graph into that bundle.
   */
  readonly upstreamStatus?: (response: Response) => number | undefined;
}

/**
 * Runs `attempt` until it succeeds, returns a non-retryable failure, or the
 * attempt ceiling is reached.
 *
 * The last failure is *returned*, not thrown. A caller that gets a 429 back
 * after three tries needs the response body to show the user, and a wrapper
 * that threw would force every panel to reimplement the unwrap.
 */
export async function withRetry(
  attempt: (n: number) => Promise<Response>,
  options: RetryOptions = {},
): Promise<Response> {
  const max = Math.max(1, options.attempts ?? MAX_ATTEMPTS);
  const random = options.random ?? Math.random;
  const upstreamStatus = options.upstreamStatus ?? ((response: Response) => response.status);

  let last: Response | null = null;

  for (let n = 1; n <= max; n++) {
    // `throwIfAborted` before the first attempt too, so a pre-cancelled
    // request never reaches the network.
    options.signal?.throwIfAborted();

    const response = await attempt(n);
    if (response.ok) return response;

    last = response;
    if (n === max || !shouldRetry(response, upstreamStatus(response))) return response;

    const delay = retryAfterMs(response) ?? backoffMs(n, random);
    options.onRetry?.(n, delay);
    await sleep(delay, options.signal);
  }

  /* The loop returns on its last iteration, so this is unreachable today. It
     exists because a `Response` return type needs one, and returning a
     synthetic 502 beats returning `null` and failing the type check. */
  return last ?? new Response(null, { status: 502 });
}
