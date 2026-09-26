import { defineMiddleware } from 'astro:middleware';
import { json } from './lib/api-response';
import { checkRateLimit, rateLimitKey } from './lib/server/rate-limit';

/**
 * Per-IP rate limiting for the API surface.
 *
 * WHY MIDDLEWARE AND NOT PER-ROUTE
 *
 * A limit added inside each handler protects exactly the routes that existed
 * when it was written. This project has already shipped one route that nobody
 * intended to expose — `src/pages/api/endpoints.test.ts` was built as a live
 * endpoint, and the only reason it was caught is that the secret scanner
 * happened to see a key-shaped literal inside it. A limit that has to be
 * remembered per route is a limit the next route will not have, and the
 * failure is invisible until a bill arrives.
 *
 * Middleware sees every request, so a route added later is limited the day it
 * is written. `/api/*` only: the pages are static HTML and rate-limiting them
 * would break a human on a slow connection for no security gain.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It is not authentication. The app has no accounts and this plan does not
 * invent them, so the API remains open to anyone who can reach it; the limit
 * bounds how fast one caller can spend the operator's quota, and cannot
 * establish who they are. See `src/lib/server/rate-limit.ts` for what the
 * limit is and is not.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (!pathname.startsWith('/api/')) return next();

  // `clientAddress` is the socket peer, and is the only client identity an
  // attacker cannot choose. Some adapters and some proxy configurations cannot
  // supply it, and it throws rather than returning undefined in those cases —
  // so it is read defensively and falls back to a shared bucket, which fails
  // closed. Letting the throw escape would turn a missing address into a 500
  // on every API call, which is a worse outcome than a stricter limit.
  let clientAddress: string | undefined;
  try {
    clientAddress = context.clientAddress;
  } catch {
    clientAddress = undefined;
  }

  const route = pathname.slice('/api/'.length).replace(/\/+$/, '');
  const verdict = checkRateLimit(route, rateLimitKey(clientAddress));

  if (!verdict.allowed) {
    return json(
      {
        error:
          'Too many requests. Wait a moment and try again — this limit protects the shared Gemini quota for everyone using this instance.',
      },
      429,
      {
        // `retry-after` is what a well-behaved client reads to back off on its
        // own, and the app's own retry layer honours 429 by backing off. No
        // `x-ratelimit-limit` is sent: the policy is per-route configuration,
        // and publishing a number the server then enforces differently after
        // an env override would be a header that lies.
        'retry-after': String(verdict.retryAfterSeconds),
        'x-ratelimit-remaining': '0',
        // A 429 must never be cached: a cached refusal outlives the window it
        // was computed for and would keep refusing a client that has served it.
        'cache-control': 'no-store',
      },
    );
  }

  const response = await next();
  // The remaining count is reported so a client (or an operator with curl) can
  // see the budget approaching instead of discovering it as a 429.
  response.headers.set('x-ratelimit-remaining', String(verdict.remaining));
  return response;
});
