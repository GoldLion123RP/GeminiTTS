import { describe, expect, mock, test } from 'bun:test';

/**
 * `live-token.ts` transitively imports `astro:env/server` (via `client.ts`)
 * and `@google/genai`. Neither resolves outside the Astro build, so both are
 * mocked at the top level — before the module under test is imported — because
 * a `beforeAll` hook runs after the module graph has already loaded.
 *
 * Only the two names actually reached by this import path need to exist. A
 * partial mock that omits an export the real module graph expects fails with
 * a link-time `SyntaxError` rather than a test failure, which is a confusing
 * way to learn that a mock is incomplete.
 */
mock.module('astro:env/server', () => ({ getSecret: () => 'test-key-never-real' }));
mock.module('@google/genai', () => ({
  GoogleGenAI: class {
    authTokens = { create: async () => ({ name: 'tok' }) };
  },
  Modality: { TEXT: 'TEXT' },
}));

const { liveSocketUrl, LIVE_WEBSOCKET_ORIGIN } = await import('./live-token');

describe('liveSocketUrl', () => {
  /**
   * The URL is the one piece of this app that carries a credential to the
   * browser, so its exact shape is pinned here rather than only in a comment.
   * Google documents the ephemeral-token endpoint as the v1beta path with
   * `access_token` as the sole query parameter, and its own reference client
   * builds the same URL. Verified 2026-09-26.
   */
  test('builds the documented v1beta constrained-endpoint URL', () => {
    expect(liveSocketUrl('tok-123')).toBe(
      `${LIVE_WEBSOCKET_ORIGIN}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=tok-123`,
    );
  });

  test('is a secure WebSocket URL', () => {
    expect(LIVE_WEBSOCKET_ORIGIN).toStartWith('wss://');
  });

  /**
   * Regression guard for a real defect. An earlier revision appended
   * `&model=models/gemini-3.5-transcribe-live` on the theory that the
   * endpoint needed to be told which model to use. It does not: the *constrained*
   * endpoint binds the model through `liveConnectConstraints.model` on the
   * ephemeral token itself, and neither the docs nor Google's reference client
   * pass a model on the wire. Two copies of the model is one more place for
   * them to disagree silently.
   */
  test('does not put the model on the wire', () => {
    expect(liveSocketUrl('tok-123')).not.toContain('model=');
  });

  /**
   * The API key must never reach a browser, and the only credential on this
   * connection is the short-lived token. A `key=` parameter here would be a
   * full compromise, so it is asserted absent rather than left to review.
   */
  test('carries no API key and no key parameter', () => {
    const url = liveSocketUrl('tok-123');
    expect(url).not.toContain('key=');
    expect(url).not.toContain('AIza');
  });

  test('percent-encodes the token rather than interpolating it raw', () => {
    // A token is normally URL-safe base64, but it is interpolated into a URL
    // the browser parses, so encoding is the only defensible default. An
    // unencoded '&' would silently truncate the credential and the connection
    // would fail with a 400 that looks like a bad token.
    expect(liveSocketUrl('a b&c=d')).toContain('access_token=a%20b%26c%3Dd');
  });
});
