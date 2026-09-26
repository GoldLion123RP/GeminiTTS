import { describe, expect, test } from 'bun:test';
import {
  chunkText,
  MAX_CHARS,
  CHUNK_TOKEN_BUDGET,
  CHARS_PER_TOKEN,
  SENTENCE_TERMINATORS,
} from './chunk';

const normalise = (s: string) => s.replace(/\s+/gu, ' ').trim();

function repeatToLength(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

function repeatWords(word: string, approxLength: number): string {
  return `${word} `.repeat(Math.ceil(approxLength / (word.length + 1))).trimEnd();
}

// Hard-coded on purpose. Asserting against the imported MAX_CHARS would let a
// changed constant silently redefine the expectation and pass anyway.
const BUDGET = 24_000;

describe('chunkText budget', () => {
  test('exposes the 6000-token budget as 24 000 characters', () => {
    expect(CHUNK_TOKEN_BUDGET).toBe(6_000);
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(MAX_CHARS).toBe(24_000);
  });

  test('honours a hard 24 000-character ceiling for every script', () => {
    const units = {
      latin: 'alpha bravo charlie delta. ',
      bengali: 'আমি বাংলায় কথা বলছি। ',
      devanagari: 'मैं हिंदी में बोल रहा हूँ। ',
    };
    for (const [script, unit] of Object.entries(units)) {
      const chunks = chunkText(repeatToLength(unit, 60_000));
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        if (chunk.length > BUDGET) throw new Error(`${script} chunk of ${chunk.length} exceeds ${BUDGET}`);
      }
    }
  });
});

describe('chunkText boundaries', () => {
  test('splits Latin text on sentence terminators', () => {
    const text = `${repeatToLength('alpha bravo charlie delta. ', 60_000)}Echo.`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_CHARS);
  });

  test('splits Bengali text on the danda', () => {
    const text = `${repeatToLength('আমি বাংলায় কথা বলছি। ', 60_000)}শেষ বাক্য।`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.endsWith('।')).toBe(true);
  });

  test('splits Devanagari text on the danda', () => {
    const text = `${repeatToLength('मैं हिंदी में बोल रहा हूँ। ', 60_000)}अंतिम वाक्य।`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.endsWith('।')).toBe(true);
  });

  test('splits on the Bengali quarter note', () => {
    const terminator = String.fromCodePoint(0x9f7);
    const text = `${repeatToLength(`একটি বাক্য${terminator} `, 60_000)}শেষ।`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.endsWith(terminator)).toBe(true);
  });

  test('splits on the Bengali question sign', () => {
    const terminator = String.fromCodePoint(0x9f3);
    const text = `${repeatToLength(`কী হয়েছে${terminator} `, 60_000)}শেষ।`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.endsWith(terminator)).toBe(true);
  });

  test('the terminator set is exactly the seven intended code points', () => {
    const codes = [...SENTENCE_TERMINATORS].map((ch) => ch.codePointAt(0));
    expect(codes).toEqual([0x2e, 0x21, 0x3f, 0x964, 0x965, 0x9f3, 0x9f7]);
    // U+09CE BENGALI LETTER KHANDA TA is a letter. Splitting on it would cut
    // mid-word, so it must never enter the terminator class.
    expect(SENTENCE_TERMINATORS).not.toContain(String.fromCodePoint(0x9ce));
  });

  test('never splits mid-word for a word ending in the Bengali letter khanda ta', () => {
    const khandaTa = String.fromCodePoint(0x9ce);
    const word = `কথা${khandaTa}`;
    const chunks = chunkText(repeatToLength(`${word} `, 60_000));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.split(' ').every((w) => w === word)).toBe(true);
    }
  });

  test('falls through to clause splitting when one sentence exceeds the budget', () => {
    const text = `${repeatToLength('alpha beta, gamma delta, ', 30_000)}end.`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Clause split yields whole clauses, so every chunk ends on a clause
      // end: "delta," or "end.". A word-level split would instead be able to
      // end on "alpha", "beta," or "gamma".
      expect(/(\bdelta,|end\.|delta\.)$/.test(chunk)).toBe(true);
    }
  });

  test('falls through to word splitting when there are no clause marks', () => {
    // A 7-character word including its space: 24 000 is not a multiple of 7,
    // so a hard character-count break cannot land on a word boundary by
    // accident. This is what distinguishes word splitting from hardBreak.
    const word = 'alphabet';
    const chunks = chunkText(repeatWords(word, 30_000));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.split(' ').every((w) => w === word)).toBe(true);
    }
  });

  test('falls through to word splitting for one oversized sentence', () => {
    const text = repeatToLength('lorem ipsum dolor ', 50_000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(normalise(chunks.join(' '))).toBe(normalise(text));
  });

  test('hard-breaks a single token longer than the budget', () => {
    const chunks = chunkText('a'.repeat(MAX_CHARS + 500));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.length).toBe(MAX_CHARS);
    expect(chunks[1]!.length).toBe(500);
  });

  test('respects paragraph breaks as the highest-priority split', () => {
    const paragraphs = Array.from({ length: 40 }, () => repeatToLength('sentence one. sentence two. ', 1_200));
    const chunks = chunkText(paragraphs.join('\n\n'));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_CHARS);
  });
});

describe('chunkText invariants', () => {
  const samples = [
    'One sentence, no terminator',
    'First. Second! Third?',
    'এক। দুই। তিন।',
    'एक। दो। तीन।',
    'Mixed বাংলা and English, mixed together. Then a second one.',
    'Ends without whitespace',
    '   leading and trailing   ',
  ];

  for (const sample of samples) {
    test(`preserves every character: ${JSON.stringify(sample.slice(0, 32))}`, () => {
      const chunks = chunkText(sample);
      expect(normalise(chunks.join(' '))).toBe(normalise(sample));
      expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
    });
  }

  test('never splits mid-word: every word stays intact inside one chunk', () => {
    const words = Array.from({ length: 4_000 }, (_, i) => `w${i}${'x'.repeat(20)}`);
    const chunks = chunkText(words.join(' '));

    const seen = new Set<string>();
    for (const chunk of chunks) {
      for (const token of chunk.split(' ')) {
        if (!token.startsWith('w')) continue;
        if (seen.has(token)) throw new Error(`word split across chunks: ${token}`);
        seen.add(token);
      }
    }
    expect(seen.size).toBe(words.length);
  });

  test('never splits mid-word for a Bengali or Devanagari word', () => {
    const words = Array.from({ length: 4_000 }, (_, i) => `শব্দ${i}ल`);
    const chunks = chunkText(words.join(' '));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const token of chunk.split(' ')) expect(token).toMatch(/^[\p{L}\p{M}\d]+$/u);
    }
  });

  test('returns a single chunk for short input', () => {
    expect(chunkText('Hello world.')).toEqual(['Hello world.']);
  });

  test('returns no chunks for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\t  \n ')).toEqual([]);
  });
});
