import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * `astro:env/server` only exists inside the Astro build, so it is mocked before
 * any route is imported. The real key is never used: these tests exercise
 * validation, mapping, and header behaviour, and every Gemini call is stubbed.
 */
mock.module('astro:env/server', () => ({
  getSecret: () => 'test-key-never-real',
}));

const mintLiveToken = mock(async (language: string) => ({
  token: `tok-${language}`,
  model: 'gemini-3.5-transcribe-live',
}));
mock.module('../../lib/gemini/live-token', () => ({
  LIVE_TRANSCRIBE_MODEL: 'gemini-3.5-transcribe-live',
  mintLiveToken,
}));

const transcribe = mock(async () => ({ raw: 'raw text', text: 'structured text', structured: true }));
mock.module('../../lib/gemini/transcribe', () => ({
  MAX_INLINE_AUDIO_BYTES: 20 * 1024 * 1024,
  transcribe,
}));

// Built through the real header writer so the route is tested against genuine
// WAV bytes rather than a placeholder blob.
const { pcmToWav } = await import('../../lib/audio/wav');
const WAV = pcmToWav(new Uint8Array(4800));

const synthesize = mock(async () => ({
  wav: WAV,
  chunks: 3,
  pcmBytes: 4800,
  durationSeconds: 0.1,
  sampleRate: 24_000,
}));
mock.module('../../lib/gemini/synthesize', () => ({ synthesize }));

const { POST: liveToken } = await import('./live-token');
const { POST: transcribeRoute } = await import('./transcribe');
const { POST: estimate } = await import('./estimate');
const { POST: synthesizeRoute } = await import('./synthesize');
const { POST: extractRoute } = await import('./extract');

type Context = Parameters<typeof estimate>[0];
/** `APIRoute` may return a Response or a Promise of one; every handler here is async. */
type Handler = (context: Context) => Response | Promise<Response>;

/** Sends a JSON body to a handler. A string is sent verbatim, to test malformed JSON. */
function call(handler: Handler, body: unknown): Promise<Response> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return Promise.resolve(
    handler({
      request: new Request('http://localhost/api/x', { method: 'POST', body: payload }),
    } as Context),
  );
}

beforeEach(() => {
  mintLiveToken.mockClear();
  transcribe.mockClear();
  synthesize.mockClear();
});

describe('POST /api/live-token', () => {
  test('returns the token and model, never the key', async () => {
    const response = await call(liveToken, { language: 'bn' });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.token).toBe('tok-bn');
    expect(body.model).toBe('gemini-3.5-transcribe-live');
    expect(JSON.stringify(body)).not.toContain('test-key-never-real');
  });

  test('passes the language through to the minter', async () => {
    await call(liveToken, { language: 'hi' });
    expect(mintLiveToken).toHaveBeenCalledWith('hi');
  });

  test('defaults an omitted language to auto', async () => {
    await call(liveToken, {});
    expect(mintLiveToken).toHaveBeenCalledWith('auto');
  });

  test('rejects an unknown language with 400 and does not mint', async () => {
    const response = await call(liveToken, { language: 'fr' });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain('auto, en, bn, hi');
    expect(mintLiveToken).not.toHaveBeenCalled();
  });

  test('malformed JSON is a 400, not a 500', async () => {
    expect((await call(liveToken, '{oops')).status).toBe(400);
  });
});

describe('POST /api/transcribe', () => {
  test('returns raw, text, and the language', async () => {
    const response = await call(transcribeRoute, {
      audio: 'QUJD',
      mimeType: 'audio/webm',
      language: 'en',
      structure: true,
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.raw).toBe('raw text');
    expect(body.text).toBe('structured text');
    expect(body.language).toBe('en');
  });

  test('defaults structure to on and language to auto', async () => {
    await call(transcribeRoute, { audio: 'QUJD' });
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'auto', structure: true }),
    );
  });

  test('honours structure: false', async () => {
    await call(transcribeRoute, { audio: 'QUJD', structure: false });
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ structure: false }));
  });

  test('strips a data-URL prefix before sending the audio', async () => {
    await call(transcribeRoute, { audio: 'data:audio/webm;base64,QUJD' });
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ audioBase64: 'QUJD' }));
  });

  test('defaults the mime type to audio/webm', async () => {
    await call(transcribeRoute, { audio: 'QUJD' });
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'audio/webm' }));
  });

  test('rejects a missing audio field', async () => {
    expect((await call(transcribeRoute, {})).status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  test('rejects an unknown language', async () => {
    const response = await call(transcribeRoute, { audio: 'QUJD', language: 'de' });
    expect(response.status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  test('rejects an oversized base64 payload before decoding it', async () => {
    const oversized = 'A'.repeat(30 * 1024 * 1024);
    expect((await call(transcribeRoute, { audio: oversized })).status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  test('does not claim a speechDetected flag that transcribe can never produce', async () => {
    const body = (await (await call(transcribeRoute, { audio: 'QUJD' })).json()) as Record<string, unknown>;
    expect('speechDetected' in body).toBe(false);
  });
});

describe('POST /api/estimate', () => {
  test('returns duration, chunk count, and cost', async () => {
    const body = (await (await call(estimate, { text: 'One. Two. Three.' })).json()) as Record<string, number>;

    expect(body.seconds).toBeGreaterThan(0);
    expect(body.chunks).toBe(1);
    expect(body.estimatedCostUsd).toBeGreaterThan(0);
  });

  test('reports calibrated: false, forcing the UI to label the figure estimated', async () => {
    const body = (await (await call(estimate, { text: 'Hello.' })).json()) as { calibrated: boolean };
    expect(body.calibrated).toBe(false);
  });

  test('rejects empty text', async () => {
    expect((await call(estimate, { text: '   ' })).status).toBe(400);
  });

  test('rejects a missing text field', async () => {
    expect((await call(estimate, {})).status).toBe(400);
  });
});

describe('POST /api/synthesize', () => {
  test('returns audio/wav with a content-length matching the body', async () => {
    const response = await call(synthesizeRoute, { text: 'Hello world.', voice: 'Kore' });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(Number(response.headers.get('content-length'))).toBe(bytes.byteLength);
  });

  test('the returned bytes are a real RIFF/WAVE container', async () => {
    const response = await call(synthesizeRoute, { text: 'Hello.', voice: 'Kore' });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes.subarray(0, 12));

    expect(text.startsWith('RIFF')).toBe(true);
    expect(text.includes('WAVE')).toBe(true);
  });

  test('reports chunk count and duration as headers for the progress UI', async () => {
    const response = await call(synthesizeRoute, { text: 'Hello.', voice: 'Kore' });
    expect(response.headers.get('x-chunks')).toBe('3');
    expect(Number(response.headers.get('x-duration-seconds'))).toBeCloseTo(0.1, 3);
  });

  test('falls back to the default voice for an unknown name rather than failing', async () => {
    const response = await call(synthesizeRoute, { text: 'Hello.', voice: 'Nonexistent' });
    expect(response.status).toBe(200);
    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({ voice: 'Kore' }));
  });

  test('rejects an unknown language with the shared 400 shape', async () => {
    const response = await call(synthesizeRoute, { text: 'Hello.', language: 'de' });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain('auto, en, bn, hi');
    expect(synthesize).not.toHaveBeenCalled();
  });

  test('rejects empty text', async () => {
    expect((await call(synthesizeRoute, { text: '' })).status).toBe(400);
    expect(synthesize).not.toHaveBeenCalled();
  });

  test('an upstream failure becomes a plain-language error, not a stack trace', async () => {
    const { GeminiError } = await import('../../lib/gemini/client');
    synthesize.mockImplementationOnce(async () => {
      throw new GeminiError('Gemini is unavailable right now.', { status: 503, detail: 'raw' });
    });
    const response = await call(synthesizeRoute, { text: 'Hello.', voice: 'Kore' });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.error).toBe('Gemini is unavailable right now.');
    expect(JSON.stringify(body)).not.toContain('at Object');
  });
});

describe('POST /api/extract', () => {
  test('returns the text and character count for a plain file', async () => {
    const data = btoa('Hello from a text file.');
    const response = await call(extractRoute, { name: 'notes.txt', data });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.text).toBe('Hello from a text file.');
    expect(body.characters).toBe('Hello from a text file.'.length);
    expect(body.fileName).toBe('notes.txt');
  });

  test('strips a data-URL prefix before decoding', async () => {
    const data = `data:text/plain;base64,${btoa('Stripped.')}`;
    const body = (await (await call(extractRoute, { name: 'a.md', data })).json()) as { text: string };
    expect(body.text).toBe('Stripped.');
  });

  test('a .pdf that is not a PDF is a 400 carrying the parser wording, not a crash', async () => {
    const response = await call(extractRoute, { name: 'scan.pdf', data: btoa('not a pdf') });
    const body = (await response.json()) as { error: string; fileName: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/could not be read/i);
    expect(body.fileName).toBe('scan.pdf');
  });

  test('an unsupported extension names the supported set', async () => {
    const response = await call(extractRoute, { name: 'photo.png', data: btoa('x') });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain('.txt, .md, .pdf, or .docx');
  });

  test('rejects a missing name or data field', async () => {
    expect((await call(extractRoute, { data: btoa('x') })).status).toBe(400);
    expect((await call(extractRoute, { name: 'a.txt' })).status).toBe(400);
  });

  test('rejects an oversized upload before decoding it', async () => {
    const oversized = 'A'.repeat(30 * 1024 * 1024);
    expect((await call(extractRoute, { name: 'big.txt', data: oversized })).status).toBe(400);
  });
});

describe('secret safety', () => {
  test('no endpoint echoes the API key in any response', async () => {
    const responses = await Promise.all([
      call(liveToken, { language: 'en' }),
      call(transcribeRoute, { audio: 'QUJD' }),
      call(estimate, { text: 'Hello.' }),
      call(synthesizeRoute, { text: 'Hello.', voice: 'Kore' }),
      call(extractRoute, { name: 'notes.txt', data: btoa('Hello.') }),
    ]);

    for (const response of responses) {
      expect(await response.text()).not.toContain('test-key-never-real');
    }
  });
});
