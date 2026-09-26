import { describe, expect, test } from 'bun:test';
import { DEFAULT_LANGUAGE, isLanguageId, LANGUAGES, language, languageCodes } from './languages';

describe('language table', () => {
  test('offers exactly Auto, English, বাংলা, and हिन्दी', () => {
    expect(LANGUAGES.map((entry) => entry.id)).toEqual(['auto', 'en', 'bn', 'hi']);
  });

  test('defaults to Auto', () => {
    expect(DEFAULT_LANGUAGE).toBe('auto');
  });

  test('maps every id to its native label', () => {
    const labels = Object.fromEntries(LANGUAGES.map((entry) => [entry.id, entry.label]));
    expect(labels).toEqual({ auto: 'Auto-detect', en: 'English', bn: 'বাংলা', hi: 'हिन्दी' });
  });

  test('binds the native labels to the right scripts', () => {
    // Guard against an editor substituting visually similar glyphs.
    expect([...language('bn').label].map((ch) => ch.codePointAt(0))).toEqual([
      0x09ac, 0x09be, 0x0982, 0x09b2, 0x09be,
    ]);
    expect([...language('hi').label].map((ch) => ch.codePointAt(0))).toEqual([
      0x0939, 0x093f, 0x0928, 0x094d, 0x0926, 0x0940,
    ]);
  });
});

describe('languageCodes', () => {
  test('sends the BCP-47 hint for an explicit selection', () => {
    expect(languageCodes('en')).toEqual(['en-US']);
    expect(languageCodes('bn')).toEqual(['bn-BD']);
    expect(languageCodes('hi')).toEqual(['hi-IN']);
  });

  test('sends nothing for Auto so the model detects the language itself', () => {
    expect(languageCodes('auto')).toEqual([]);
    expect(language('auto').bcp47).toBeNull();
  });

  test('rejects an unknown id rather than defaulting silently', () => {
    expect(() => languageCodes('fr' as never)).toThrow(RangeError);
  });
});

describe('isLanguageId', () => {
  test('accepts only the four table ids', () => {
    for (const entry of LANGUAGES) expect(isLanguageId(entry.id)).toBe(true);
    expect(isLanguageId('fr')).toBe(false);
    expect(isLanguageId(null)).toBe(false);
    expect(isLanguageId(7)).toBe(false);
  });
});
