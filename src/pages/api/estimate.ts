import type { APIRoute } from 'astro';
import { failure, json, readJson, requireString } from '../../lib/api-response';
import { estimateText } from '../../lib/audio/estimate';

export const prerender = false;

/** Matches the plan's stress case of a 200 KB document, with headroom. */
const MAX_TEXT_CHARS = 500_000;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await readJson(request);
    const text = requireString(body, 'text', { maxLength: MAX_TEXT_CHARS });

    // Pure local arithmetic: no Gemini call, so this cannot fail on quota,
    // latency, or a missing key, and it costs nothing.
    return json(estimateText(text));
  } catch (error) {
    return failure(error);
  }
};
