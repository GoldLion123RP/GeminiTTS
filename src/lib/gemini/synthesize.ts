import { chunkText } from '../audio/chunk';
import { pcmToWav, SAMPLE_RATE, wavDurationSeconds } from '../audio/wav';
import { asGeminiError, GeminiError, gemini } from './client';
import type { LanguageId } from './languages';
import { TTS_MODEL } from './models';
import { resolveVoiceName } from './voices';

export { TTS_MODEL };

/** Reinforces the professional register in the output, not just via the voice choice. */
export const STYLE_INSTRUCTION =
  'Read the text aloud in a clear, professional register at a natural pace. Do not add, skip, or comment on any part of it.';

/** One retry per chunk: a transient 5xx must not fail a whole document. */
export const CHUNK_ATTEMPTS = 2;

export interface SynthesizeOptions {
  readonly text: string;
  readonly voice: string;
  /** Accepted for symmetry with transcription; TTS auto-detects the input language. */
  readonly language: LanguageId;
  readonly signal?: AbortSignal;
  readonly onProgress?: (completed: number, total: number) => void;
}

export interface Synthesis {
  readonly wav: Uint8Array<ArrayBuffer>;
  readonly chunks: number;
  readonly pcmBytes: number;
  readonly durationSeconds: number;
  readonly sampleRate: number;
}

export async function synthesize(options: SynthesizeOptions): Promise<Synthesis> {
  const chunks = chunkText(options.text);
  if (chunks.length === 0) {
    throw new GeminiError('There is no speakable text to synthesize.');
  }

  const voiceName = resolveVoiceName(options.voice);
  const parts: Uint8Array[] = [];

  for (const [index, chunk] of chunks.entries()) {
    parts.push(await synthesizeChunk(chunk, voiceName, options.signal));

    const completed = index + 1;
    if (completed < chunks.length) options.onProgress?.(completed, chunks.length);
  }
  options.onProgress?.(chunks.length, chunks.length);

  // Raw PCM has no inter-frame dependencies, so byte concatenation is lossless
  // and a single header describes the whole file.
  const pcm = concat(parts);
  const wav = pcmToWav(pcm);

  return {
    wav,
    chunks: chunks.length,
    pcmBytes: pcm.byteLength,
    durationSeconds: wavDurationSeconds(wav),
    sampleRate: SAMPLE_RATE,
  };
}

async function synthesizeChunk(
  text: string,
  voiceName: string,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    try {
      return await requestPcm(text, voiceName, signal);
    } catch (cause) {
      lastError = cause;
      // A 4xx will not become a 200 on a second attempt.
      if (cause instanceof GeminiError && cause.status !== undefined && cause.status < 500) throw cause;
      if (cause instanceof GeminiError && cause.status === 429) throw cause;
    }
  }

  throw asGeminiError(lastError);
}

async function requestPcm(
  text: string,
  voiceName: string,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  let base64: string | undefined;

  try {
    const response = await gemini().models.generateContent({
      model: TTS_MODEL,
      contents: [{ role: 'user', parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
        abortSignal: signal,
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        base64 = part.inlineData.data;
        break;
      }
    }
  } catch (cause) {
    throw asGeminiError(cause);
  }

  if (base64 === undefined) {
    throw new GeminiError('Gemini returned no audio for this chunk.', {
      detail: `Voice "${voiceName}" produced a response with no inline audio data.`,
    });
  }

  return decodeBase64(base64);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
