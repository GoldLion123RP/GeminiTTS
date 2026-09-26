import { describe, expect, test } from 'bun:test';
import { BYTE_RATE, HEADER_BYTES } from './wav';
import {
  AUDIO_TOKENS_PER_SECOND,
  CHARS_PER_SECOND,
  COST_PER_MILLION_INPUT_TOKENS_USD,
  COST_PER_MILLION_OUTPUT_TOKENS_USD,
  estimateDurationSeconds,
  estimateText,
} from './estimate';

describe('estimate constants', () => {
  test('uses the documented 25 audio output tokens per second', () => {
    expect(AUDIO_TOKENS_PER_SECOND).toBe(25);
  });

  test('uses the gemini-3.8-flash-lite-tts prices', () => {
    expect(COST_PER_MILLION_OUTPUT_TOKENS_USD).toBe(6.0);
    expect(COST_PER_MILLION_INPUT_TOKENS_USD).toBe(0.5);
  });
});

describe('estimateDurationSeconds', () => {
  test('divides character count by the calibrated rate', () => {
    expect(estimateDurationSeconds('a'.repeat(CHARS_PER_SECOND))).toBe(1);
    expect(estimateDurationSeconds('a'.repeat(280))).toBe(20);
  });

  test('ignores surrounding whitespace', () => {
    expect(estimateDurationSeconds(`   ${'a'.repeat(CHARS_PER_SECOND)}   `)).toBe(1);
  });

  test('is zero for empty input', () => {
    expect(estimateDurationSeconds('')).toBe(0);
    expect(estimateDurationSeconds('  \n ')).toBe(0);
  });
});

describe('estimateText', () => {
  test('reports characters, seconds, and chunks consistently', () => {
    const text = `${'word '.repeat(4_000)}end.`;
    const estimate = estimateText(text);
    expect(estimate.characters).toBe(text.trim().length);
    expect(estimate.seconds).toBe(estimate.characters / CHARS_PER_SECOND);
    expect(estimate.chunks).toBeGreaterThanOrEqual(1);
  });

  test('derives output tokens from seconds at 25 tokens per second', () => {
    const estimate = estimateText('a'.repeat(CHARS_PER_SECOND * 4));
    expect(estimate.seconds).toBe(4);
    expect(estimate.outputTokens).toBe(100);
  });

  test('derives input tokens at four characters per token', () => {
    expect(estimateText('a'.repeat(400)).inputTokens).toBe(100);
  });

  test('charges output audio 12x the input text rate', () => {
    const estimate = estimateText('a'.repeat(4_000));
    const fromOutput = (estimate.outputTokens * COST_PER_MILLION_OUTPUT_TOKENS_USD) / 1_000_000;
    const fromInput = (estimate.inputTokens * COST_PER_MILLION_INPUT_TOKENS_USD) / 1_000_000;
    expect(fromOutput).toBeGreaterThan(fromInput);
    expect(estimate.estimatedCostUsd).toBeCloseTo(fromOutput + fromInput, 12);
  });

  test('is zero for empty input', () => {
    const estimate = estimateText('   ');
    expect(estimate).toEqual({
      characters: 0,
      seconds: 0,
      chunks: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      calibrated: false,
    });
  });

  test('prices a 1 349-character paragraph at a few cents', () => {
    const text = 'This is a short paragraph. '.repeat(50);
    const estimate = estimateText(text);
    expect(estimate.characters).toBe(text.trim().length);
    expect(estimate.seconds).toBeCloseTo(estimate.characters / CHARS_PER_SECOND, 6);
    expect(estimate.estimatedCostUsd).toBeLessThan(0.05);
  });

  test('prices a 200 KB document at a few dollars, not cents', () => {
    const estimate = estimateText('x'.repeat(200_000));
    expect(estimate.chunks).toBeGreaterThan(1);
    expect(estimate.seconds).toBeCloseTo(200_000 / CHARS_PER_SECOND, 6);
    expect(estimate.estimatedCostUsd).toBeCloseTo(2.167857, 5);
  });

  test('is flagged uncalibrated until Phase 7.5 measures the constant', () => {
    expect(estimateText('hello').calibrated).toBe(false);
  });
});

describe('estimate against a known PCM payload', () => {
  test('one second of 24 kHz mono s16le is 48 000 bytes and 25 tokens', () => {
    const oneSecondBytes = BYTE_RATE;
    const seconds = oneSecondBytes / BYTE_RATE;
    expect(seconds).toBe(1);
    expect(seconds * AUDIO_TOKENS_PER_SECOND).toBe(25);
    expect((25 * COST_PER_MILLION_OUTPUT_TOKENS_USD) / 1_000_000).toBeCloseTo(0.00015, 9);
  });

  test('the WAV header overhead is not billed as audio', () => {
    expect(HEADER_BYTES).toBe(44);
    expect((HEADER_BYTES + BYTE_RATE) / BYTE_RATE).toBeCloseTo(1 + 44 / BYTE_RATE, 9);
  });
});
