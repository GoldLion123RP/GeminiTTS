import type { APIRoute } from 'astro';
import { BadRequest, failure, json, readJson } from '../../lib/api-response';
import { isLanguageId } from '../../lib/gemini/languages';
import { mintLiveToken } from '../../lib/gemini/live-token';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await readJson(request);
    const language = body.language ?? 'auto';
    if (!isLanguageId(language)) {
      throw new BadRequest('"language" must be one of: auto, en, bn, hi.');
    }

    const minted = await mintLiveToken(language);
    return json({ token: minted.token, model: minted.model });
  } catch (error) {
    return failure(error);
  }
};
