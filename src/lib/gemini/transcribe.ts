import { AudioTranscriptionConfigMode, type Part } from '@google/genai';
import { asGeminiError, GeminiError, gemini } from './client';
import { languageCodes, type LanguageId } from './languages';
import { STRUCTURE_SYSTEM_INSTRUCTION, structurePrompt } from '../prompts/structure';

export const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
export const STRUCTURE_MODEL = 'gemini-3.8-flash';

/** Documented inline ceiling for a `generateContent` request, audio included. */
export const MAX_INLINE_AUDIO_BYTES = 20 * 1024 * 1024;

/** Unary Transcribe handles up to an hour of audio per request. */
export const MAX_AUDIO_SECONDS = 60 * 60;

export interface TranscribeOptions {
  /** Base64-encoded audio, without a data-URL prefix. */
  readonly audioBase64: string;
  readonly mimeType: string;
  readonly language: LanguageId;
  /** Pass 2 is a separate text-only call, so it can be switched off in the UI. */
  readonly structure: boolean;
}

export interface Transcription {
  /** Pass 1 output, always retained so the effect of pass 2 stays auditable. */
  readonly raw: string;
  /** Pass 2 output, or `raw` unchanged when `structure` was false. */
  readonly text: string;
  readonly structured: boolean;
}

export async function transcribe(options: TranscribeOptions): Promise<Transcription> {
  const raw = await transcribeClean(options);
  if (raw.trim().length === 0) return { raw: '', text: '', structured: false };
  if (!options.structure) return { raw, text: raw, structured: false };

  const text = await applyStructure(raw);
  return { raw, text, structured: true };
}

/**
 * Pass 1 — `gemini-3.5-transcribe` in Smart mode: filler removal, self-correction
 * resolution, and intent-aware formatting of numbers, dates, and currency.
 *
 * The mode shape was confirmed against the installed SDK: `GenerateContentConfig`
 * carries `audioTranscriptionConfig`, whose `mode` is the
 * `AudioTranscriptionConfigMode` enum (`SMART`), not the bare string shown on the
 * REST `generation_config.transcription_config` field. See the Phase 2 changelog.
 */
async function transcribeClean(options: TranscribeOptions): Promise<string> {
  if (options.audioBase64.length === 0) {
    throw new GeminiError('No audio was supplied to transcribe.');
  }

  const codes = languageCodes(options.language);
  const smart = { mode: AudioTranscriptionConfigMode.SMART, ...(codes.length > 0 ? { languageCodes: codes } : {}) };

  try {
    const response = await gemini().models.generateContent({
      model: TRANSCRIBE_MODEL,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: options.mimeType, data: options.audioBase64 } }],
        },
      ],
      config: { audioTranscriptionConfig: smart },
    });

    const transcript = readTranscript(response.candidates?.[0]?.content?.parts);
    if (transcript === undefined) throw blockedOrEmpty();
    return transcript.trim();
  } catch (cause) {
    if (cause instanceof GeminiError) throw cause;
    throw asGeminiError(cause);
  }
}

/**
 * `gemini-3.5-transcribe` returns its transcript in `part.audioTranscription`, not
 * in a text part, so the SDK's `response.text` getter returns `undefined`. This
 * was measured against the live API on 2026-09-26, not read from docs.
 */
function readTranscript(parts: readonly Part[] | undefined): string | undefined {
  const pieces: string[] = [];
  for (const part of parts ?? []) {
    if (part.audioTranscription?.text) pieces.push(part.audioTranscription.text);
  }
  return pieces.length > 0 ? pieces.join('') : undefined;
}

/** Pass 2 — a text-only `gemini-3.8-flash` call that may add structure and nothing else. */
async function applyStructure(clean: string): Promise<string> {
  let text: string | undefined;
  try {
    const response = await gemini().models.generateContent({
      model: STRUCTURE_MODEL,
      contents: structurePrompt(clean),
      config: {
        systemInstruction: STRUCTURE_SYSTEM_INSTRUCTION,
        temperature: 0,
      },
    });
    text = response.text;
  } catch (cause) {
    throw asGeminiError(cause);
  }

  if (text === undefined) throw blockedOrEmpty();
  // A structure pass that loses content is worse than no structure pass, so an
  // empty or drastically shorter result falls back to the clean transcript.
  return text.trim().length >= clean.trim().length * 0.9 ? text.trim() : clean;
}

function blockedOrEmpty(): GeminiError {
  return new GeminiError('Gemini returned no text for this request.', {
    detail:
      'A response with no text usually means the audio contained no speech, or the request was blocked by a safety filter.',
  });
}
