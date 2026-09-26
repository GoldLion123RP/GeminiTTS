import { describe, expect, test, beforeEach } from 'bun:test';
import {
  checkRateLimit,
  rateLimitKey,
  resetRateLimits,
  trackedKeyCount,
  DEFAULT_POLICIES,
} from '../server/rate-limit';

const T0 = 1_700_000_000_000;

beforeEach(() => {
  resetRateLimits();
  delete process.env.RATE_LIMIT_SYNTHESIZE;
  delete process.env.RATE_LIMIT_EXTRACT;
});

describe('checkRateLimit', () => {
  test('allows requests up to the limit and refuses the next one', () => {
    const limit = DEFAULT_POLICIES.synthesize.limit;
    for (let i = 0; i < limit; i++) {
      expect(checkRateLimit('synthesize', '1.2.3.4', T0).allowed).toBe(true);
    }
    const refused = checkRateLimit('synthesize', '1.2.3.4', T0);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
  });

  test('counts per IP, not globally', () => {
    const limit = DEFAULT_POLICIES.synthesize.limit;
    for (let i = 0; i < limit; i++) checkRateLimit('synthesize', '1.1.1.1', T0);
    expect(checkRateLimit('synthesize', '1.1.1.1', T0).allowed).toBe(false);
    // A different client is unaffected — this is the property that makes the
    // limit a per-caller bound rather than a global outage.
    expect(checkRateLimit('synthesize', '2.2.2.2', T0).allowed).toBe(true);
  });

  test('counts per route, so one noisy route cannot starve another', () => {
    const limit = DEFAULT_POLICIES.synthesize.limit;
    for (let i = 0; i < limit; i++) checkRateLimit('synthesize', '1.1.1.1', T0);
    expect(checkRateLimit('synthesize', '1.1.1.1', T0).allowed).toBe(false);
    expect(checkRateLimit('transcribe', '1.1.1.1', T0).allowed).toBe(true);
  });

  test('is a sliding window, not a fixed one', () => {
    const limit = DEFAULT_POLICIES.synthesize.limit;
    // Two bursts straddling a window boundary must not both be allowed: that
    // is the fixed-window flaw, and it is exactly what a 60s window invites.
    for (let i = 0; i < limit; i++) checkRateLimit('synthesize', '1.1.1.1', T0);
    const refused = checkRateLimit('synthesize', '1.1.1.1', T0 + 30_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    // Once the first request ages out of the window, capacity returns
    // gradually rather than all at once on a boundary.
    expect(checkRateLimit('synthesize', '1.1.1.1', T0 + 60_001).allowed).toBe(true);
  });

  test('reports seconds until the oldest request leaves the window', () => {
    const limit = DEFAULT_POLICIES.synthesize.limit;
    for (let i = 0; i < limit; i++) checkRateLimit('synthesize', '1.1.1.1', T0);
    const refused = checkRateLimit('synthesize', '1.1.1.1', T0 + 45_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(15);
  });

  test('a rejected request does not extend the window', () => {
    const limit = DEFAULT_POLICIES.synthesize.limit;
    for (let i = 0; i < limit; i++) checkRateLimit('synthesize', '1.1.1.1', T0);
    // Keep asking while refused. If refusals were recorded, the wait would
    // grow every time and a client that retries promptly could never recover.
    for (let i = 1; i <= 20; i++) {
      expect(checkRateLimit('synthesize', '1.1.1.1', T0 + i * 1000).allowed).toBe(false);
    }
    expect(checkRateLimit('synthesize', '1.1.1.1', T0 + 60_001).allowed).toBe(true);
  });

  test('remaining counts down', () => {
    const limit = DEFAULT_POLICIES.synthesize.limit;
    expect(checkRateLimit('synthesize', '1.1.1.1', T0).remaining).toBe(limit - 1);
    expect(checkRateLimit('synthesize', '1.1.1.1', T0).remaining).toBe(limit - 2);
  });

  test('an unknown route falls back to a default policy rather than passing', () => {
    // A route added tomorrow with no entry in the table must be limited, not
    // unlimited. An unmapped route returning "allow" would be the one default
    // that silently undoes the whole module.
    const first = checkRateLimit('brand-new-route', '1.1.1.1', T0);
    expect(first.allowed).toBe(true);
    for (let i = 0; i < 40; i++) checkRateLimit('brand-new-route', '1.1.1.1', T0);
    expect(checkRateLimit('brand-new-route', '1.1.1.1', T0).allowed).toBe(false);
  });

  test('RATE_LIMIT_<ROUTE> overrides the default, and 0 disables limiting', () => {
    process.env.RATE_LIMIT_SYNTHESIZE = '2';
    expect(checkRateLimit('synthesize', '1.1.1.1', T0).allowed).toBe(true);
    expect(checkRateLimit('synthesize', '1.1.1.1', T0).allowed).toBe(true);
    expect(checkRateLimit('synthesize', '1.1.1.1', T0).allowed).toBe(false);

    process.env.RATE_LIMIT_SYNTHESIZE = '0';
    for (let i = 0; i < 100; i++) {
      expect(checkRateLimit('synthesize', '1.1.1.1', T0).allowed).toBe(true);
    }
  });

  test('a nonsense override is ignored rather than disabling the limit', () => {
    // `RATE_LIMIT_EXTRACT=off` must not read as zero and switch protection off.
    process.env.RATE_LIMIT_EXTRACT = 'off';
    const limit = DEFAULT_POLICIES.extract.limit;
    for (let i = 0; i < limit; i++) checkRateLimit('extract', '1.1.1.1', T0);
    expect(checkRateLimit('extract', '1.1.1.1', T0).allowed).toBe(false);
  });

  test('tracked keys stay bounded, so a flood cannot grow memory without limit', () => {
    for (let i = 0; i < 10_500; i++) checkRateLimit('synthesize', `10.0.${i}.1`, T0);
    expect(trackedKeyCount()).toBeLessThanOrEqual(10_000);
  });
});

describe('rateLimitKey', () => {
  test('uses the socket address when one is available', () => {
    expect(rateLimitKey('203.0.113.9')).toBe('203.0.113.9');
  });

  test('falls back to one shared bucket when the address is unavailable', () => {
    // Failing closed: an unknown client is limited as if it were any other,
    // rather than being handed a fresh bucket per request.
    expect(rateLimitKey(undefined)).toBe('unavailable');
    expect(rateLimitKey('   ')).toBe('unavailable');
    expect(rateLimitKey(undefined)).toBe(rateLimitKey(''));
  });
});
