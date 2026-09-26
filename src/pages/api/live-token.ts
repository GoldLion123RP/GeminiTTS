import type { APIRoute } from 'astro';
import { BadRequest, failure, json, readJson } from '../../lib/api-response';
import { isLanguageId } from '../../lib/gemini/languages';
import { liveSocketUrl, mintLiveToken } from '../../lib/gemini/live-token';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await readJson(request);
    const language = body.language ?? 'auto';
    if (!isLanguageId(language)) {
      throw new BadRequest('"language" must be one of: auto, en, bn, hi.');
    }

    const minted = await mintLiveToken(language);
    // The ready-to-dial URL is built here rather than in the browser. The
    // client cannot call `liveSocketUrl()` itself: that module imports
    // `astro:env/server` and `@google/genai`, so importing it into a
    // `<script>` would pull the secret reader and the whole SDK into
    // `dist/client/`. The server hands over a finished string instead, and
    // `liveSocketUrl()` stays the single place the URL is constructed — the
    // plan's "imported, not retyped" rule, with the import happening here
    // instead of in the panel.
    return json({ token: minted.token, model: minted.model, url: liveSocketUrl(minted.token) });
  } catch (error) {
    return failure(error);
  }
};
