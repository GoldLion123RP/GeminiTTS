import type { APIRoute } from 'astro';
import { BadRequest, failure, json, readJson, requireString } from '../../lib/api-response';
import { ExtractionError, extractText, MAX_EXTRACT_BYTES } from '../../lib/extract/text';

export const prerender = false;

const BASE64_PREFIX = /^data:[^;,]*;base64,/;

/**
 * Phase 5.1 — file upload.
 *
 * The plan assumed the browser could read an uploaded `.pdf`/`.docx` and post
 * the text. It cannot: `unpdf` and `mammoth` are server-only by design, and
 * Phase 2.6's note is explicit that they "stay server-side so they never enter
 * the browser bundle". Reading the file in the client would have pulled both
 * parsers into `dist/client/` — the one place a leaked key could reach.
 *
 * So the browser posts the raw bytes as base64 and gets text back. This is a
 * fifth endpoint, added in Phase 5 rather than Phase 3, and flagged in the
 * changelog.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await readJson(request);
    const name = requireString(body, 'name', { maxLength: 260 });
    const data = requireString(body, 'data', { maxLength: MAX_BASE64_CHARS }).replace(
      BASE64_PREFIX,
      '',
    );
    if (data.length === 0) throw new BadRequest('"data" contained no file content.');

    // Rebuild the File from base64. `atob` yields a binary string, so the
    // bytes are walked in one pass rather than via String.fromCharCode(...map),
    // which would blow the argument limit on a multi-megabyte document.
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const text = await extractText(new File([bytes], name));

    return json({
      text,
      characters: text.length,
      // Surfaced verbatim in the UI. §5.7 requires a .pdf that is really an
      // image to produce a typed extraction error, not a generic failure.
      fileName: name,
    });
  } catch (error) {
    // An unreadable document is the user's input being wrong, not ours being
    // broken: 400 with the parser's own wording, which the panel renders
    // as-is. Routed here rather than through `failure()` so ExtractionError
    // keeps its message instead of collapsing to "The request could not be
    // completed."
    if (error instanceof ExtractionError) {
      return json({ error: error.message, fileName: error.fileName }, 400);
    }
    return failure(error);
  }
};

/** Base64 inflates by 4/3, so this bounds the decoded payload before we decode it. */
const MAX_BASE64_CHARS = Math.ceil((MAX_EXTRACT_BYTES * 4) / 3) + 1024;
