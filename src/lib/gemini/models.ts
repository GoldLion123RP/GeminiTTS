/**
 * Model identifiers, isolated from the modules that *call* them.
 *
 * This file has zero imports on purpose. `synthesize.ts` and `transcribe.ts`
 * both reach `astro:env/server` through `client.ts`, so a browser-direct
 * transport (Phase 4 BYOK) cannot import them for their constants — that would
 * pull `@google/genai` and the server env module into `dist/client/`, breaking
 * the invariant that the server-only surface never ships to the browser.
 *
 * Duplicating the three strings into the client transport instead would be a
 * second source of truth that could drift silently, and a drifted model ID fails
 * at request time with an opaque 404 rather than at build time. One shared
 * leaf module is the cheaper failure.
 */
export const TTS_MODEL = 'gemini-3.8-flash-lite-tts';

export const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';

export const STRUCTURE_MODEL = 'gemini-3.8-flash';
