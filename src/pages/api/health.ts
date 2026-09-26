import type { APIRoute } from 'astro';
import { json } from '../../lib/api-response';
import { probeHealth } from '../../lib/gemini/health';

export const prerender = false;

/**
 * `GET /api/health` — Phase 5.1.
 *
 * WHY EVERY STATE IS 200
 *
 * The endpoint answers "what state is the key in", not "is the process
 * alive". A 429 means the service is up and correctly reporting that the
 * project is out of budget; a 503 for `missing` means the same about the
 * environment. Returning non-200 for either would make a monitoring check
 * page a human for a condition no human action fixes, and it would make the
 * caller branch on HTTP status to read a state the body states outright. So
 * the status is always 200 and `state` is the contract.
 *
 * `no-store` is not optional. A cached `configured` from before a key was
 * rotated out is worse than no endpoint at all, and every intermediate is
 * entitled to cache a GET by default.
 */
export const GET: APIRoute = async ({ request }) => {
  const report = await probeHealth({ signal: request.signal });
  return json(report, 200, { 'cache-control': 'no-store' });
};
