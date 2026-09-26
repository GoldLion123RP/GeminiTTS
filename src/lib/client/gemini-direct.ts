/**
 * Browser-direct Gemini transport (Phase 4.3), the alternative selected by the
 * Phase 0 gate.
 *
 * THE ONE DESIGN CONSTRAINT: every function here returns a real `Response` with
 * the same status codes and the same custom headers as the `/api/*` route it
 * stands in for. That is what makes 4.5 a one-line change per call site — the
 * panels already branch on `response.ok`, `response.json()`, and
 * `x-chunks` / `x-duration-seconds`, and none of that logic knows or cares
 * which provider answered. A transport that returned a parsed object instead
 * would have forced every call site to grow a second code path, and the two
 * would drift.
 *
 * The key is carried in the `x-goog-api-key` header, never the query string.
 * That is not a style preference: a header is not written to `history`, not
 * copied into a `Referer`, and not logged by intermediaries the way `?key=` is.
 * It also forces a CORS preflight, which is precisely what Phase 0.1 verified
 * Google's edge answers.
 *
 * `wav.ts`, `chunk.ts` and `estimate.ts` are imported here directly. They were
 * audited Node-free in Phase 0.3, so the audio assembly the server does moves
 * to the client unchanged rather than being reimplemented. `models.ts` exists
 * for the same reason: the model IDs live in a zero-import leaf so this file can
 * read them without dragging `astro:env/server` into the client bundle.
 */

import { chunkText } from '../audio/chunk';
import { pcmToWav, wavDurationSeconds } from '../audio/wav';
import { STRUCTURE_MODEL, TTS_MODEL, TRANSCRIBE_MODEL } from '../gemini/models';
import { languageCodes, type LanguageId } from '../gemini/languages';
import { resolveVoiceName } from '../gemini/voices';
import { STRUCTURE_SYSTEM_INSTRUCTION, structurePrompt } from '../prompts/structure';

/**
 * `v1beta`, matching the server path's SDK default. Phase 0.1 probed `v1beta`
 * and `v1` and both answered the preflight, so this is a consistency choice,
 * not a compatibility constraint.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Mirrors `MAX_INLINE_AUDIO_BYTES` in `gemini/transcribe.ts`. */
const MAX_INLINE_AUDIO_BYTES = 20 * 1024 * 1024;

/** One retry per chunk, matching `CHUNK_ATTEMPTS`. */
const CHUNK_ATTEMPTS = 2;

/**
 * The status a network-level failure is reported as.
 *
 * PHASE 5 FIX. This was `0`, following the `fetch` convention where a thrown
 * `TypeError` means "no response". That is fine as a *value* and illegal as a
 * `Response` status: the WHATWG spec requires 200–599, and
 * `new Response(body, { status: 0 })` throws `RangeError` in every browser.
 * So the network branch never returned a Response at all — it threw past every
 * `try`/`catch` that expected one, and the user saw the vaguest possible
 * failure instead of "check your connection". Caught by
 * `client/retry.test.ts`, which could not even construct the response it was
 * asserting on.
 *
 * 502 is the honest answer: we could not get an answer from Gemini. It is also
 * the status Phase 5.2's retry layer deliberately refuses to retry, because a
 * request that may have been delivered and generated must not be re-sent.
 */
const UNREACHABLE = 502;

/** A `Response` with the same body shape `api-response.failure()` produces. */
function fail(message: string, status: number, detail?: string): Response {
  return new Response(JSON.stringify({ error: message, detail }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Maps an upstream status onto the same plain-language copy `client.ts` uses
 * server-side, so a user reads one set of words regardless of provider.
 *
 * The 401/403 branch deliberately does NOT say "check your .env file" the way
 * the server copy does: under BYOK there is no `.env` on this machine, and
 * telling someone to edit a file that does not exist on their side is a
 * confidently wrong instruction.
 */
function upstreamFailure(status: number, raw: string): Response {
  const response = status === 400
    ? fail('Gemini rejected the request. The audio format, language, or voice may be unsupported.', 502, raw)
    : status === 401 || status === 403
      ? fail('Gemini rejected the API key. Check the key in this page’s settings.', 502, raw)
      : status === 413
        ? fail('The request was too large for Gemini. Record for less time, or split the text.', 413, raw)
        : status === 429
          ? fail('Gemini rate limit reached. Wait a moment and try again.', 429, raw)
          : status >= 500
            ? fail('Gemini is unavailable right now. Try again shortly.', 502, raw)
            : fail('The request could not be completed.', 502, raw);

  /**
   * The retry predicate must see the UPSTREAM status, not this mapped one.
   *
   * This was a real bug, caught in the browser rather than by a test: a 400
   * from Gemini is remapped to 502 for the UI, and a naive `status < 500`
   * check then read 502, decided "transient, retry", and issued a SECOND
   * billable request for a request that could never succeed. Doubling a
   * user's spend on the exact input most likely to be rejected is not an
   * acceptable bug, so the original status rides along out of band.
   *
   * 429 is deliberately passed through unchanged, so it is already correct and
   * needs no marker.
   */
  if (status !== 429) {
    Object.defineProperty(response, UPSTREAM_STATUS, { value: status, enumerable: false });
  }
  return response;
}

/** Non-enumerable property carrying the real upstream status past the remap. */
const UPSTREAM_STATUS = Symbol('upstreamStatus');

/** The status a failed request should be *retried* on, ignoring UI remapping. */
function retryableStatus(response: Response): number {
  return upstreamStatusOf(response) ?? response.status;
}

/**
 * Reads the real upstream status off a failed response, if the transport
 * attached one.
 *
 * Exported (rather than kept private behind `retryableStatus`) so Phase 5.2's
 * retry layer can be handed this reader and make its decision off the
 * upstream number too. Without it, `withRetry` would see a 502 where Gemini
 * said 400 and would re-send a billable request for an input that can never
 * succeed — the exact bug the symbol was introduced to prevent, reintroduced
 * one layer up.
 */
export function upstreamStatusOf(response: Response): number | undefined {
  const carried = (response as unknown as Record<symbol, unknown>)[UPSTREAM_STATUS];
  return typeof carried === 'number' ? carried : undefined;
}

interface GeminiReply {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly Record<string, unknown>[] };
  }[];
}

/**
 * One `generateContent` call. A network-level failure is also mapped to a
 * `Response`, because the panels treat every outcome as a fetch result and a
 * thrown `TypeError` would surface as a different, vaguer message.
 */
async function generateContent(
  key: string,
  model: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    return fail('The request to Gemini could not be completed. Check your connection.', UNREACHABLE, String(cause));
  }

  if (response.ok) return response;
  return upstreamFailure(response.status, await response.text().catch(() => ''));
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface DirectSynthesizeOptions {
  readonly text: string;
  readonly voice: string;
  readonly language: LanguageId;
  readonly signal?: AbortSignal;
}

/**
 * TTS, returning byte-identical semantics to `POST /api/synthesize`: the same
 * chunking, the same one-retry-per-chunk policy, the same WAV assembly, and the
 * same `x-chunks` / `x-duration-seconds` response headers the panel reads to
 * label its progress.
 *
 * The retry predicate is copied deliberately rather than shared: `synthesize.ts`
 * reaches this through the SDK's thrown-error shape, and coupling a browser
 * transport to that would reintroduce the `@google/genai` import this whole
 * module exists to avoid.
 */
export async function directSynthesize(
  key: string,
  options: DirectSynthesizeOptions,
): Promise<Response> {
  const chunks = chunkText(options.text);
  if (chunks.length === 0) return fail('There is no speakable text to synthesize.', 400);

  const voiceName = resolveVoiceName(options.voice);
  const parts: Uint8Array[] = [];

  for (const chunk of chunks) {
    let last = new Response(null, { status: 502 });

    for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt++) {
      options.signal?.throwIfAborted();
      const response = await generateContent(
        key,
        TTS_MODEL,
        {
          contents: [{ role: 'user', parts: [{ text: chunk }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        },
        options.signal,
      );

      if (response.ok) {
        const reply = (await response.json()) as GeminiReply;
        const inline = (reply.candidates?.[0]?.content?.parts ?? []).find(
          (part) => typeof part.inlineData === 'object' && part.inlineData !== null,
        ) as { inlineData?: { data?: string } } | undefined;

        const data = inline?.inlineData?.data;
        if (typeof data !== 'string') {
          return fail('Gemini returned no audio for this chunk.', 502, `Voice "${voiceName}" produced no inline audio data.`);
        }
        parts.push(decodeBase64(data));
        last = new Response(null, { status: 200 });
        break;
      }

      last = response;
      // A 4xx will not become a 200 on a second attempt, and a 429 is a quota
      // answer rather than a blip. Identical policy to the server path, read
      // off the upstream status so the UI remap cannot turn a 400 into a retry.
      const upstream = retryableStatus(response);
      if (upstream < 500 || upstream === 429) return response;
    }

    if (last.status !== 200) return last;
  }

  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const pcm = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    pcm.set(part, offset);
    offset += part.byteLength;
  }

  const wav = pcmToWav(pcm);
  return new Response(new Blob([wav], { type: 'audio/wav' }), {
    status: 200,
    headers: {
      'content-type': 'audio/wav',
      'content-length': String(wav.byteLength),
      'x-chunks': String(chunks.length),
      'x-duration-seconds': wavDurationSeconds(wav).toFixed(3),
    },
  });
}

export interface DirectTranscribeOptions {
  /** Base64-encoded audio, without a data-URL prefix. */
  readonly audioBase64: string;
  readonly mimeType: string;
  readonly language: LanguageId;
  readonly structure: boolean;
}

interface Transcription {
  readonly raw: string;
  readonly text: string;
  readonly structured: boolean;
}

/**
 * STT, mirroring `POST /api/transcribe`: pass 1 in Smart mode, then the same
 * text-only structure pass, with the same fallbacks.
 *
 * `transcription_config` is the REST spelling. The SDK's *object* form is
 * `audioTranscriptionConfig`, and those two are NOT interchangeable on the
 * wire — this was read off `GenerationConfig_2` in the installed
 * `@google/genai@2.24.0` rather than assumed, because a wrong field name does
 * not fail the build, it silently leaves the model in its VERBATIM default.
 * That failure mode is exactly the open question Phase 6.6 exists to settle, so
 * spelling it wrong here would have quietly manufactured the answer.
 */
export async function directTranscribe(
  key: string,
  options: DirectTranscribeOptions,
): Promise<Response> {
  if (options.audioBase64.length === 0) return fail('No audio was supplied to transcribe.', 400);
  if (options.audioBase64.length > Math.ceil((MAX_INLINE_AUDIO_BYTES * 4) / 3) + 1024) {
    return fail('The recording is too large for Gemini. Record for less time.', 413);
  }

  const codes = languageCodes(options.language);
  const attempt = await transcribeClean(key, options, codes);

  // An upstream refusal is returned to the caller verbatim, so the panel's error
  // copy and status handling behave identically on both providers.
  if (!attempt.ok) return attempt.response;

  const clean = attempt.text;
  if (clean.trim().length === 0) {
    return fail('Gemini returned no text for this request.', 502,
      'A response with no text usually means the audio contained no speech, or the request was blocked by a safety filter.');
  }

  let result: Transcription = { raw: clean, text: clean, structured: false };
  if (options.structure) {
    const shaped = await applyStructure(key, clean);
    // A structure pass that fails must not cost the user their words, and one
    // that returns almost nothing is treated as the same failure. Both
    // policies are copied from the server path, not invented here.
    if (shaped !== null) result = { raw: clean, text: shaped, structured: true };
  }

  return new Response(JSON.stringify({ ...result, language: options.language }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Pass 1. Returns a discriminated result rather than throwing or returning a
 * bare string, because "the model replied but the audio held no speech" and
 * "Gemini refused the request" are different outcomes and the caller has to be
 * able to tell them apart to pick the right message.
 */
type CleanAttempt =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly response: Response };

async function transcribeClean(
  key: string,
  options: DirectTranscribeOptions,
  codes: readonly string[],
): Promise<CleanAttempt> {
  let last: Response | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await generateContent(key, TRANSCRIBE_MODEL, {
      contents: [
        { role: 'user', parts: [{ inlineData: { mimeType: options.mimeType, data: options.audioBase64 } }] },
      ],
      generationConfig: {
        transcription_config: {
          mode: 'SMART',
          ...(codes.length > 0 ? { language_codes: [...codes] } : {}),
        },
      },
    });

    if (response.ok) {
      const reply = (await response.json()) as GeminiReply;
      // The transcript arrives in `audioTranscription`, NOT in a text part, so
      // the conventional `text` field is absent. Measured against the live API
      // on 2026-09-26 and recorded in the Phase 2 changelog.
      const pieces: string[] = [];
      for (const part of reply.candidates?.[0]?.content?.parts ?? []) {
        const value = (part.audioTranscription as { text?: string } | undefined)?.text;
        if (value) pieces.push(value);
      }
      if (pieces.length > 0) return { ok: true, text: pieces.join('') };
      return { ok: true, text: '' };
    }

    last = response;
    const upstream = retryableStatus(response);
    if (upstream < 500 || upstream === 429) break;
  }

  if (last && !last.ok) return { ok: false, response: last };
  // Both attempts failed at the network layer, so there is no upstream Response
  // to forward. Synthesised here so the caller still gets a renderable body.
  return { ok: false, response: fail('The request to Gemini could not be completed. Check your connection.', UNREACHABLE) };
}

async function applyStructure(key: string, clean: string): Promise<string | null> {
  const response = await generateContent(key, STRUCTURE_MODEL, {
    contents: [{ role: 'user', parts: [{ text: structurePrompt(clean) }] }],
    systemInstruction: { parts: [{ text: STRUCTURE_SYSTEM_INSTRUCTION }] },
    generationConfig: { temperature: 0 },
  });

  if (!response.ok) return null;

  const reply = (await response.json()) as {
    candidates?: readonly { content?: { parts?: readonly Record<string, unknown>[] } }[];
  };
  const text = (reply.candidates?.[0]?.content?.parts ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  return text.length >= clean.trim().length * 0.9 ? text : null;
}
