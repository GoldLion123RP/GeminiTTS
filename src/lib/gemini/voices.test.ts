import { describe, expect, test } from 'bun:test';
import { DEFAULT_VOICE, isVoiceName, resolveVoiceName, VOICES, VOICE_GROUPS, voice } from './voices';

// Hard-coded on purpose: asserting against an imported count would let a
// silently dropped voice redefine the expectation and pass anyway.
const EXPECTED_VOICES = [
  'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe',
  'Callirrhoe', 'Charon', 'Despina', 'Enceladus', 'Erinome', 'Fenrir',
  'Gacrux', 'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Puck',
  'Pulcherrima', 'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat',
  'Umbriel', 'Vindemiatrix', 'Zephyr', 'Zubenelgenubi',
];

const EXPECTED_GROUPS = [
  'Bright', 'Firm', 'Warm', 'Knowledgeable', 'Informative', 'Gentle', 'Breezy',
  'Upbeat', 'Clear', 'Even', 'Friendly', 'Lively', 'Excitable', 'Breathy',
  'Smooth', 'Gravelly', 'Soft', 'Mature', 'Casual', 'Youthful', 'Easy-going',
  'Forward',
];

describe('voice roster', () => {
  test('offers exactly the 30 prebuilt Gemini voices', () => {
    expect(VOICES.length).toBe(30);
    expect(VOICES.map((entry) => entry.name).sort()).toEqual(EXPECTED_VOICES);
  });

  test('groups by the 22 documented character descriptors', () => {
    expect(VOICE_GROUPS.map((group) => group.character)).toEqual(EXPECTED_GROUPS);
  });

  test('every voice appears in exactly one group, and the group matches its descriptor', () => {
    const seen = new Set<string>();
    for (const group of VOICE_GROUPS) {
      for (const entry of group.voices) {
        expect(seen.has(entry.name)).toBe(false);
        seen.add(entry.name);
        expect(entry.character).toBe(group.character);
        expect(voice(entry.name).character).toBe(group.character);
      }
    }
    expect(seen.size).toBe(30);
    expect(VOICES.length).toBe(seen.size);
  });

  test('flattens the groups in presentation order', () => {
    expect(VOICES).toEqual(VOICE_GROUPS.flatMap((group) => group.voices));
  });
});

describe('default voice', () => {
  test('is Kore, described as Firm', () => {
    expect(DEFAULT_VOICE).toBe('Kore');
    expect(voice('Kore').character).toBe('Firm');
    expect(voice('Kore')).toEqual(VOICE_GROUPS[1]?.voices[0]);
  });
});

describe('isVoiceName', () => {
  test('accepts only roster names, case-sensitively', () => {
    expect(isVoiceName('Kore')).toBe(true);
    expect(isVoiceName('kore')).toBe(false);
    expect(isVoiceName('Nova')).toBe(false);
    expect(isVoiceName(undefined)).toBe(false);
  });
});

describe('resolveVoiceName', () => {
  test('passes a known name through and falls back to the default otherwise', () => {
    expect(resolveVoiceName('Puck')).toBe('Puck');
    expect(resolveVoiceName('Nova')).toBe('Kore');
    expect(resolveVoiceName(null)).toBe('Kore');
  });
});
