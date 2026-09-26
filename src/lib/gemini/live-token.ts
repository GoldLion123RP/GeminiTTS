import { Modality } from '@google/genai';
import { asGeminiError, GeminiError, gemini } from './client';
import { languageCodes, type LanguageId } from './languages';

export const LIVE_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-live';

/** The token may open exactly one Live session, then it is spent. */
export const LIVE_TOKEN_USES = 1;

/** Defaults documented by Google: 30 minutes of messaging, 60s to start a session. */
export const LIVE_TOKEN_TTL_MINUTES = 30;
export const LIVE_NEW_SESSION_TTL_MINUTES = 1;

export const LIVE_WEBSOCKET_ORIGIN = 'wss://generativelanguage.googleapis.com';

export interface LiveToken {
  /** The short-lived token. The real API key is never included. */
  readonly token: string;
  readonly model: string;
}

function isoInMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * Mints a short-lived, single-use, model-scoped token so the browser can open a
 * Live WebSocket without ever seeing the real API key.
 *
 * Request shape verified against the Gemini Live API ephemeral-tokens docs
 * (fetched 2026-09-26) and against the `CreateAuthTokenConfig` /
 * `LiveConnectConstraints` types in the installed `@google/genai@2.24.0`.
 */
export async function mintLiveToken(language: LanguageId = 'auto'): Promise<LiveToken> {
  const codes = languageCodes(language);

  let minted;
  try {
    minted = await gemini().authTokens.create({
      config: {
        uses: LIVE_TOKEN_USES,
        expireTime: isoInMinutes(LIVE_TOKEN_TTL_MINUTES),
        newSessionExpireTime: isoInMinutes(LIVE_NEW_SESSION_TTL_MINUTES),
        liveConnectConstraints: {
          model: LIVE_TRANSCRIBE_MODEL,
          config: {
            responseModalities: [Modality.TEXT],
            inputAudioTranscription: codes.length > 0 ? { languageCodes: codes } : {},
            sessionResumption: {},
          },
        },
      },
    });
  } catch (cause) {
    throw asGeminiError(cause);
  }

  if (!minted.name) {
    throw new GeminiError('Gemini returned an ephemeral token with no value.', {
      detail: 'authTokens.create() succeeded but the response had no `name` field.',
    });
  }

  return { token: minted.name, model: LIVE_TRANSCRIBE_MODEL };
}

/**
 * The URL the browser dials. Google accepts the token either as an
 * `access_token` query parameter or as an `Authorization: Token <value>` header;
 * browsers cannot set headers on a WebSocket, so the query parameter is the only
 * option here — which is safe precisely because this is the short-lived token.
 */
export function liveSocketUrl(token: string, model: string = LIVE_TRANSCRIBE_MODEL): string {
  return `${LIVE_WEBSOCKET_ORIGIN}/v1beta/ws/google.ai.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}&model=${encodeURIComponent(`models/${model}`)}`;
}
