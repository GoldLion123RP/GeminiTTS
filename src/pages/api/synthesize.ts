import type { APIRoute } from 'astro';
import { failure, requireString, readJson, BadRequest } from '../../lib/api-response';
import { isLanguageId } from '../../lib/gemini/languages';
import { synthesize } from '../../lib/gemini/synthesize';
import { resolveVoiceName } from '../../lib/gemini/voices';

export const prerender = false;

/** Matches the plan's stress case of a 200 KB document, with headroom. */
const MAX_TEXT_CHARS = 500_000;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await readJson(request);
    const text = requireString(body, 'text', { maxLength: MAX_TEXT_CHARS });
    const language = body.language ?? 'auto';
    if (!isLanguageId(language)) {
      throw new BadRequest('"language" must be one of: auto, en, bn, hi.');
    }

    const result = await synthesize({
      text,
      voice: resolveVoiceName(body.voice),
      language,
      signal: request.signal,
    });

    return new Response(new Blob([result.wav], { type: 'audio/wav' }), {
      status: 200,
      headers: {
        'content-type': 'audio/wav',
        'content-length': String(result.wav.byteLength),
        'content-disposition': 'attachment; filename="speech.wav"',
        'x-chunks': String(result.chunks),
        'x-duration-seconds': result.durationSeconds.toFixed(3),
      },
    });
  } catch (error) {
    return failure(error);
  }
};
