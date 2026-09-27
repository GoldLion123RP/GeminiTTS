import { GoogleGenAI } from '@google/genai';
import { getSecret } from 'astro:env/server';
import { KEY_REFUSED, keyRejectedMessage, keyWasRefused } from './classify';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class GeminiError extends Error {
  readonly status: number | undefined;
  readonly detail: string | undefined;

  constructor(message: string, options: { status?: number; detail?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'GeminiError';
    this.status = options.status;
    this.detail = options.detail;
  }
}

export const MISSING_KEY_MESSAGE =
  'GEMINI_API_KEY is not set. Copy .env.example to .env and fill in your key from https://aistudio.google.com/apikey.';

let client: GoogleGenAI | undefined;

/**
 * One configured client per process. The key is read through `getSecret`, never a
 * build-time-validated schema field, so a fresh clone without `.env` still builds.
 */
export function gemini(): GoogleGenAI {
  if (!client) {
    const apiKey = getSecret('GEMINI_API_KEY');
    if (!apiKey) throw new ConfigError(MISSING_KEY_MESSAGE);
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * Gemini failures are mapped to plain language here so no route handler has to
 * inspect SDK internals. The raw message is preserved in `detail` for the
 * collapsible technical disclosure, and `status` survives for 4xx/5xx mapping.
 */
export function asGeminiError(cause: unknown): GeminiError {
  if (cause instanceof GeminiError) return cause;
  // A missing key is a server misconfiguration, not an upstream failure, so it
  // keeps a 5xx-of-our-own (500) rather than being reported as a bad gateway.
  if (cause instanceof ConfigError) return new GeminiError(cause.message, { status: 500, cause });

  const status = readNumber(cause, 'status');
  const raw = cause instanceof Error ? cause.message : String(cause);

  return new GeminiError(plainMessage(status, raw), { status, detail: raw, cause });
}

function readNumber(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'number' ? found : undefined;
}

/**
 * The one sentence a human sees, whatever shape the failure arrived in.
 *
 * The key-refusal test runs FIRST, and that ordering is the whole fix. Measured
 * 2026-09-27: Google answers a *rejected key* with `400 API_KEY_INVALID`, not
 * 401. So the generic 400 branch below used to claim every revoked key was an
 * audio-format problem, and the `/API key not valid/i` test that used to sit at
 * the bottom of this function was unreachable — dead code that read as coverage.
 * Same defect, same fix as the browser transport: one predicate from
 * `gemini/classify`, and one sentence from `keyRejectedMessage`, so the server
 * and the page cannot drift into telling the user two different things about the
 * same rejected key.
 *
 * `status ?? 0` covers an error the SDK threw with no numeric status at all; for
 * that case there is no status to weigh, so the body decides on its own. Every
 * other status keeps its existing precedence — in particular a 5xx still reports
 * Gemini as unavailable rather than second-guessing a key from a body text.
 */
function plainMessage(status: number | undefined, raw: string): string {
  if (keyWasRefused(status ?? 0, raw) || (status === undefined && KEY_REFUSED.test(raw))) {
    return keyRejectedMessage('env');
  }
  if (status === 400) return 'Gemini rejected the request. The audio format, language, or voice may be unsupported.';
  if (status === 413) return 'The request was too large for Gemini. Record for less time, or split the text.';
  if (status === 429) return 'Gemini rate limit reached. Wait a moment and try again.';
  if (status !== undefined && status >= 500) return 'Gemini is unavailable right now. Try again shortly.';
  if (/exceeded|quota|billing/i.test(raw)) return 'This request exceeded the quota on the Gemini API key.';
  return 'Gemini could not complete the request.';
}
