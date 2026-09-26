import type { APIRoute } from 'astro';
import { BadRequest, failure, json, readJson, requireString } from '../../lib/api-response';
import { isLanguageId } from '../../lib/gemini/languages';
import { MAX_INLINE_AUDIO_BYTES, transcribe } from '../../lib/gemini/transcribe';

export const prerender = false;

const BASE64_PREFIX = /^data:[^;,]+;base64,/;

/** Base64 inflates by 4/3, so this bounds the decoded payload before we decode it. */
const MAX_BASE64_CHARS = Math.ceil((MAX_INLINE_AUDIO_BYTES * 4) / 3) + 1024;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await readJson(request);

    let audio = requireString(body, 'audio', { maxLength: MAX_BASE64_CHARS }).replace(BASE64_PREFIX, '');
    if (audio.length === 0) throw new BadRequest('"audio" contained no data.');

    const rawMime =
      typeof body.mimeType === 'string' && body.mimeType.length > 0
        ? body.mimeType
        : 'audio/webm';
    const mimeType = rawMime.split(';')[0].trim();

    const language = body.language ?? 'auto';
    if (!isLanguageId(language)) throw new BadRequest('"language" must be one of: auto, en, bn, hi.');

    const structure = body.structure !== false;

    const result = await transcribe({ audioBase64: audio, mimeType, language, structure });

    // No `speechDetected` field: `transcribeClean` throws on an empty
    // transcript, so silence reaches the UI as an error whose `detail` names
    // it, never as a successful empty string. A `false` here would be
    // unreachable, and unreachable fields are worse than none.
    return json({ ...result, language });
  } catch (error) {
    return failure(error);
  }
};
