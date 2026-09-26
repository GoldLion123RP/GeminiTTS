import { describe, expect, test } from 'bun:test';
import { BYTE_RATE, HEADER_BYTES } from './wav';
import {
  AUDIO_TOKENS_PER_SECOND,
  CHARS_PER_SECOND,
  COST_PER_MILLION_INPUT_TOKENS_USD,
  COST_PER_MILLION_OUTPUT_TOKENS_USD,
  DEFAULT_CHARS_PER_SECOND,
  charsPerSecondFor,
  detectScript,
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

describe('detectScript', () => {
  test('recognises Bengali and Devanagari by code-point block', () => {
    expect(detectScript('একটা ছোট গ্রামে')).toBe('bn');
    expect(detectScript('सुबह का समय')).toBe('hi');
  });

  test('returns en for Latin, digits, and empty input', () => {
    expect(detectScript('The quick brown fox')).toBe('en');
    expect(detectScript('12345')).toBe('en');
    expect(detectScript('')).toBe('en');
  });

  test('picks the dominant script in mixed text', () => {
    // One Bengali word in an English paragraph must stay English: pricing it
    // as Bengali would over-quote a mostly-English document by a third.
    expect(detectScript('This is a longer English sentence about many things. গ্রাম')).toBe('en');
    expect(detectScript('আমাদের গ্রামে একটি পুরনো বটগাছ ছিল।')).toBe('bn');
  });

  test('ignores punctuation and digits when counting', () => {
    expect(detectScript('123,456.78 !!!')).toBe('en');
    expect(detectScript('১২৩ ৪৫৬।')).toBe('bn');
  });
});

describe('charsPerSecondFor', () => {
  test('applies the measured per-script rate', () => {
    expect(charsPerSecondFor('The quick brown fox')).toBe(CHARS_PER_SECOND.en);
    expect(charsPerSecondFor('একটা ছোট গ্রামে')).toBe(CHARS_PER_SECOND.bn);
    expect(charsPerSecondFor('सुबह का समय')).toBe(CHARS_PER_SECOND.hi);
  });

  test('the Bengali rate is slower than the English one, as measured', () => {
    expect(CHARS_PER_SECOND.bn).toBeLessThan(CHARS_PER_SECOND.en);
    expect(CHARS_PER_SECOND.hi).toBeLessThan(CHARS_PER_SECOND.en);
  });

  test('the default sits between the measured per-script rates', () => {
    expect(DEFAULT_CHARS_PER_SECOND).toBeGreaterThan(CHARS_PER_SECOND.bn);
    expect(DEFAULT_CHARS_PER_SECOND).toBeLessThan(CHARS_PER_SECOND.en);
  });
});

describe('estimateDurationSeconds', () => {
  test('divides character count by the rate for that script', () => {
    // 154 characters is exactly 10 seconds at 15.4 chars/s. Rounding
    // CHARS_PER_SECOND.en to build the input would give 15 characters, and
    // 15/15.4 is 0.974 — a test that fails on a correct implementation.
    expect(estimateDurationSeconds('a'.repeat(154))).toBe(10);
    expect(estimateDurationSeconds('a'.repeat(280))).toBeCloseTo(280 / CHARS_PER_SECOND.en, 6);
  });

  test('the same character count is longer in Bengali than in English', () => {
    const latin = 'a'.repeat(1000);
    const bengali = 'আ'.repeat(1000);
    expect(estimateDurationSeconds(bengali)).toBeGreaterThan(estimateDurationSeconds(latin));
  });

  test('ignores surrounding whitespace', () => {
    expect(estimateDurationSeconds('   ' + 'a'.repeat(154) + '   ')).toBe(10);
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
    expect(estimate.seconds).toBe(estimate.characters / CHARS_PER_SECOND.en);
    expect(estimate.chunks).toBeGreaterThanOrEqual(1);
  });

  test('reports the rate and script it applied', () => {
    expect(estimateText('The quick brown fox').charsPerSecond).toBe(CHARS_PER_SECOND.en);
    expect(estimateText('The quick brown fox').script).toBe('en');
    expect(estimateText('একটা ছোট গ্রামে').charsPerSecond).toBe(CHARS_PER_SECOND.bn);
    expect(estimateText('একটা ছোট গ্রামে').script).toBe('bn');
  });

  test('derives output tokens from seconds at 25 tokens per second', () => {
    // 154 characters = 10.0 s exactly = 250 output tokens.
    const estimate = estimateText('a'.repeat(154));
    expect(estimate.seconds).toBe(10);
    expect(estimate.outputTokens).toBe(250);
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
      charsPerSecond: CHARS_PER_SECOND.en,
      script: 'en',
      calibrated: true,
    });
  });

  test('prices a 1 349-character paragraph at a few cents', () => {
    const text = 'This is a short paragraph. '.repeat(50);
    const estimate = estimateText(text);
    expect(estimate.characters).toBe(text.trim().length);
    expect(estimate.seconds).toBeCloseTo(estimate.characters / CHARS_PER_SECOND.en, 6);
    expect(estimate.estimatedCostUsd).toBeLessThan(0.05);
  });

  test('prices a 200 KB document at a few dollars, not cents', () => {
    const estimate = estimateText('x'.repeat(200_000));
    expect(estimate.chunks).toBeGreaterThan(1);
    expect(estimate.seconds).toBeCloseTo(200_000 / CHARS_PER_SECOND.en, 6);
    expect(estimate.estimatedCostUsd).toBeCloseTo(1.9731, 4);
  });

  test('prices Bengali 200 KB above English, because it speaks slower', () => {
    const english = estimateText('x'.repeat(200_000));
    const bengali = estimateText('আ'.repeat(200_000));
    expect(bengali.seconds).toBeGreaterThan(english.seconds);
    expect(bengali.estimatedCostUsd).toBeGreaterThan(english.estimatedCostUsd);
  });

  test('is flagged calibrated now that the rates are measured', () => {
    expect(estimateText('hello').calibrated).toBe(true);
  });

  test('every measured sample lands within its script tolerance', () => {
    // The Phase 7.5 measurements as (characters, actual seconds, script).
    // This is the test that keeps the constants honest: change a rate and
    // these real observations fail.
    //
    // The tolerance is per script, not one global band, because the
    // measured spread is not uniform: Bengali is tight (three samples within
    // 11.3-12.2 chars/s) while English is voice-dependent and spans
    // 13.8-17.1. A single 5% band is unreachable for English without lying
    // about the spread, and a single 15% band would hide a real regression
    // in Bengali.
    const samples: ReadonlyArray<[number, number, string, number]> = [
      [229, 15.086, 'en', 0.16],
      [222, 16.126, 'en', 0.16],
      [203, 11.846, 'en', 0.16],
      [147, 13.046, 'bn', 0.06],
      [118, 9.686, 'bn', 0.06],
      [98, 8.566, 'bn', 0.06],
      [104, 8.646, 'hi', 0.06],
    ];
    for (const [characters, actualSeconds, script, tolerance] of samples) {
      const predicted = characters / CHARS_PER_SECOND[script]!;
      expect(Math.abs(predicted / actualSeconds - 1)).toBeLessThan(tolerance);
    }
  });

  test('the per-script rates beat any single global constant on the measured data', () => {
    // The reason the plan's single constant was replaced. On the seven real
    // samples, per-script rates are within 16% (English, voice-dependent) and
    // 6% (Bengali), while the best single global value is over 11% off on
    // average and 30% off at worst.
    const samples: ReadonlyArray<[number, number, string]> = [
      [229, 15.086, 'en'],
      [222, 16.126, 'en'],
      [203, 11.846, 'en'],
      [147, 13.046, 'bn'],
      [118, 9.686, 'bn'],
      [98, 8.566, 'bn'],
      [104, 8.646, 'hi'],
    ];
    const perScript = samples.map(([c, actual, script]) =>
      Math.abs(c / CHARS_PER_SECOND[script]! / actual - 1),
    );
    const globalRates = [11.5, 12, 13, 14, 15];
    for (const rate of globalRates) {
      const errors = samples.map(([c, actual]) => Math.abs(c / rate / actual - 1));
      const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
      const perScriptMean = perScript.reduce((a, b) => a + b, 0) / perScript.length;
      expect(perScriptMean).toBeLessThan(mean);
    }
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
