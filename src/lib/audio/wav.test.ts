import { describe, expect, test } from 'bun:test';
import { pcmToWav, wavDurationSeconds, HEADER_BYTES, SAMPLE_RATE, BYTE_RATE, BLOCK_ALIGN } from './wav';

function pcm(bytes: number): Uint8Array {
  return new Uint8Array(bytes);
}

function marker(wav: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(wav[at + i]!);
  return out;
}

describe('pcmToWav', () => {
  test('writes the four canonical markers', () => {
    const wav = pcmToWav(pcm(200));
    expect(marker(wav, 0, 4)).toBe('RIFF');
    expect(marker(wav, 8, 4)).toBe('WAVE');
    expect(marker(wav, 12, 4)).toBe('fmt ');
    expect(marker(wav, 36, 4)).toBe('data');
  });

  test('prepends exactly 44 bytes', () => {
    for (const size of [0, 2, 400, 24_000]) {
      expect(pcmToWav(pcm(size)).byteLength).toBe(HEADER_BYTES + size);
    }
  });

  test('declares 24 kHz mono 16-bit PCM', () => {
    const view = new DataView(pcmToWav(pcm(200)).buffer);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint32(28, true)).toBe(BYTE_RATE);
    expect(view.getUint16(32, true)).toBe(BLOCK_ALIGN);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(16, true)).toBe(16);
  });

  test('sizes the RIFF and data fields from the payload', () => {
    for (const size of [0, 2, 400, 24_000]) {
      const view = new DataView(pcmToWav(pcm(size)).buffer);
      expect(view.getUint32(40, true)).toBe(size);
      expect(view.getUint32(4, true)).toBe(36 + size);
    }
  });

  test('copies payload bytes through unchanged', () => {
    const source = Uint8Array.from({ length: 8 }, (_, i) => (i + 1) * 17);
    const wav = pcmToWav(source);
    expect(Array.from(wav.slice(HEADER_BYTES))).toEqual(Array.from(source));
  });

  test('does not mutate the caller buffer', () => {
    const source = pcm(64);
    const before = Array.from(source);
    pcmToWav(source);
    expect(Array.from(source)).toEqual(before);
  });

  test('rejects a partial sample frame', () => {
    expect(() => pcmToWav(pcm(3))).toThrow(RangeError);
  });
});

describe('wavDurationSeconds', () => {
  test('derives seconds from the declared byte rate', () => {
    const oneSecond = pcmToWav(pcm(BYTE_RATE));
    expect(wavDurationSeconds(oneSecond)).toBeCloseTo(1, 6);
  });

  test('is zero for an empty payload', () => {
    expect(wavDurationSeconds(pcmToWav(pcm(0)))).toBe(0);
  });

  test('rejects a truncated file', () => {
    expect(() => wavDurationSeconds(pcm(10))).toThrow(RangeError);
  });
});
