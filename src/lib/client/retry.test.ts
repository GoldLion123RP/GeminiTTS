import { describe, expect, mock, test } from 'bun:test';

import { backoffMs, MAX_ATTEMPTS, retryAfterMs, shouldRetry, withRetry } from './retry';

/** A `Response` with a chosen status and optional headers. */
function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('shouldRetry', () => {
  test('retries 429 and 503', () => {
    expect(shouldRetry(res(429))).toBe(true);
    expect(shouldRetry(res(503))).toBe(true);
  });

  /**
   * The regression this whole module exists to prevent. A 502 covers both
   * "Gemini answered 5xx after starting work" and "the request never came
   * back" — in either case the request may already have been generated and
   * billed, so retrying re-spends the user's quota.
   */
  test('never retries a 502, whatever produced it', () => {
    expect(shouldRetry(res(502))).toBe(false);
    // The network branch of the direct transport attaches no upstream marker,
    // so the response's own 502 is what the layer sees.
    expect(shouldRetry(res(502), undefined)).toBe(false);
  });

  test('never retries a 4xx, which cannot become a 200', () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(shouldRetry(res(status))).toBe(false);
    }
  });

  test('never retries a bare 500 — the server only emits 503 for transient', () => {
    expect(shouldRetry(res(500))).toBe(false);
  });

  /**
   * The out-of-band upstream status wins over the remapped one. This is the
   * 400→502 remap `gemini-direct.ts` performs, seen from the retry layer's
   * side: a naive read of `response.status` would see 502 and re-send a
   * billable request for an input Gemini has already permanently rejected.
   */
  test('prefers the supplied upstream status over the response status', () => {
    expect(shouldRetry(res(502), 400)).toBe(false);
    expect(shouldRetry(res(502), 503)).toBe(true);
    expect(shouldRetry(res(429), 429)).toBe(true);
  });
});

describe('backoffMs', () => {
  test('doubles the ceiling per attempt', () => {
    // `random` of 1 is the top of the jitter window, so it reads the ceiling.
    expect(backoffMs(1, () => 1)).toBe(400);
    expect(backoffMs(2, () => 1)).toBe(800);
    expect(backoffMs(3, () => 1)).toBe(1600);
  });

  test('clamps at the maximum ceiling', () => {
    expect(backoffMs(20, () => 1)).toBe(4_000);
  });

  /**
   * Full jitter, not `ceiling ± noise`. A fixed delay from clients refused at
   * the same instant re-creates the same herd one window later, which is the
   * phenomenon backoff exists to break — so `random() = 0` must be allowed to
   * yield ~zero.
   */
  test('spans zero to the ceiling', () => {
    expect(backoffMs(3, () => 0)).toBe(0);
    const midpoint = backoffMs(3, () => 0.5);
    expect(midpoint).toBe(800);
  });
});

describe('retryAfterMs', () => {
  test('honours a numeric Retry-After', () => {
    expect(retryAfterMs(res(429, { 'retry-after': '2' }))).toBe(2_000);
  });

  test('honours an HTTP-date Retry-After', () => {
    const when = new Date(Date.now() + 5_000).toUTCString();
    const delay = retryAfterMs(res(503, { 'retry-after': when }));
    expect(delay).not.toBeNull();
    expect(delay!).toBeGreaterThan(0);
    expect(delay!).toBeLessThanOrEqual(5_000);
  });

  /**
   * A mistaken or hostile `Retry-After` must not park a tab on a promise the
   * UI cannot render. One day is clamped to the same ceiling every other delay
   * obeys.
   */
  test('clamps an absurd Retry-After to the maximum', () => {
    expect(retryAfterMs(res(503, { 'retry-after': '86400' }))).toBe(4_000);
  });

  test('rejects a malformed or absent header', () => {
    expect(retryAfterMs(res(429))).toBeNull();
    expect(retryAfterMs(res(429, { 'retry-after': 'soon' }))).toBeNull();
    expect(retryAfterMs(res(429, { 'retry-after': '0' }))).toBeNull();
    expect(retryAfterMs(res(429, { 'retry-after': 'banana' }))).toBeNull();
  });
});

describe('withRetry', () => {
  /** No real waiting: jitter of 0 makes every backoff immediate. */
  const instant = { random: () => 0 };

  test('returns a success on the first attempt without retrying', async () => {
    let calls = 0;
    const response = await withRetry(async () => {
      calls++;
      return res(200);
    }, instant);

    expect(response.status).toBe(200);
    expect(calls).toBe(1);
  });

  test('retries a 429 and returns the eventual success', async () => {
    let calls = 0;
    const response = await withRetry(async () => {
      calls++;
      return calls < 3 ? res(429) : res(200);
    }, instant);

    expect(response.status).toBe(200);
    expect(calls).toBe(3);
  });

  test('retries a 503 and returns the eventual success', async () => {
    let calls = 0;
    const response = await withRetry(async () => {
      calls++;
      return calls === 1 ? res(503) : res(200);
    }, instant);

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });

  /**
   * The ceiling is the bound that makes full jitter safe. Without it, a
   * permanently-refused key would retry forever.
   */
  test('stops at the attempt ceiling and returns the last failure', async () => {
    let calls = 0;
    const response = await withRetry(async () => {
      calls++;
      return res(429);
    }, instant);

    expect(calls).toBe(MAX_ATTEMPTS);
    expect(response.status).toBe(429);
  });

  test('returns a non-retryable failure on the first attempt, untouched', async () => {
    let calls = 0;
    const response = await withRetry(async () => {
      calls++;
      return res(400);
    }, instant);

    expect(calls).toBe(1);
    expect(response.status).toBe(400);
  });

  /**
   * The double-spend guard, end to end. A 502 is what the direct transport
   * returns after Gemini answered 500; a retry here would re-generate audio
   * the user has already paid for.
   */
  test('does not retry a remapped 502 whose upstream status was a 500', async () => {
    const attempt = mock(async () => res(502));
    const response = await withRetry(attempt, { ...instant, upstreamStatus: () => 500 });

    expect(response.status).toBe(502);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  test('does retry a remapped 502 whose upstream status was a 503', async () => {
    let calls = 0;
    const response = await withRetry(async () => {
      calls++;
      return calls === 1 ? res(502) : res(200);
    }, { ...instant, upstreamStatus: () => 503 });

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });

  test('reports each retry through the observability hook', async () => {
    const delays: number[] = [];
    let calls = 0;
    await withRetry(
      async () => {
        calls++;
        return calls < 3 ? res(429) : res(200);
      },
      { random: () => 1, onRetry: (_n, delay) => delays.push(delay) },
    );

    expect(delays).toEqual([400, 800]);
  });

  /**
   * A cancelled request must not sit through a backoff sleep. The rejection is
   * the DOM-standard `AbortError`, which is exactly what `TtsPanel` and
   * `SttPanel` already check for, so no panel change is needed to make Cancel
   * work during a retry.
   *
   * The catch is explicit rather than `expect(...).rejects`, because the call
   * count has to be asserted *after* the rejection has been observed —
   * `rejects.toThrow()` returns void, so an `await` on it is a no-op that
   * reads as if it synchronised anything.
   */
  test('stops immediately when the signal aborts between attempts', async () => {
    const controller = new AbortController();
    let calls = 0;
    let rejected = false;

    try {
      await withRetry(
        async () => {
          calls++;
          controller.abort();
          return res(429);
        },
        { ...instant, signal: controller.signal },
      );
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
    expect(calls).toBe(1);
  });

  test('never dispatches when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const attempt = mock(async () => res(200));
    let rejected = false;

    try {
      await withRetry(attempt, { ...instant, signal: controller.signal });
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
    expect(attempt).not.toHaveBeenCalled();
  });

  test('honours a lower attempt ceiling', async () => {
    let calls = 0;
    await withRetry(async () => {
      calls++;
      return res(503);
    }, { ...instant, attempts: 1 });

    expect(calls).toBe(1);
  });
});
