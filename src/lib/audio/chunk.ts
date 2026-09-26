export const CHUNK_TOKEN_BUDGET = 6_000;
export const CHARS_PER_TOKEN = 4;
export const MAX_CHARS = CHUNK_TOKEN_BUDGET * CHARS_PER_TOKEN;

const PARAGRAPH_SPLIT = /\n[ \t]*\n+/u;

// ASCII terminators plus the Indic terminators, assembled from explicit code
// points so they cannot be mistyped or silently normalised by an editor:
//   U+002E FULL STOP, U+0021 EXCLAMATION MARK, U+003F QUESTION MARK
//   U+0964 DEVANAGARI DANDA, U+0965 DEVANAGARI DOUBLE DANDA  (Hindi, and Bengali)
//   U+09F3 BENGALI QUESTION SIGN, U+09F7 BENGALI QUARTER NOTE
// U+09CE BENGALI LETTER KHANDA TA is deliberately absent: it is a letter, so
// splitting on it would cut mid-word.
export const SENTENCE_TERMINATORS = String.fromCodePoint(
  0x2e, 0x21, 0x3f, 0x964, 0x965, 0x9f3, 0x9f7,
);

const SENTENCE_SPLIT = new RegExp(`(?<=[${escapeForClass(SENTENCE_TERMINATORS)}])[ \\t]+`, 'u');
const CLAUSE_SPLIT = /(?<=[,;:—–])[ \t]+/u;
const WORD_SPLIT = /[ \t]+/u;

function escapeForClass(chars: string): string {
  return chars.replace(/[\\\]^-]/g, (ch) => `\\${ch}`);
}

const SPLITTERS = [PARAGRAPH_SPLIT, SENTENCE_SPLIT, CLAUSE_SPLIT, WORD_SPLIT];

function hardBreak(text: string, limit: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += limit) out.push(text.slice(i, i + limit));
  return out;
}

function splitWithin(text: string, limit: number, depth: number): string[] {
  if (text.length <= limit) return [text];
  if (depth >= SPLITTERS.length) return hardBreak(text, limit);

  const parts = text.split(SPLITTERS[depth]!).filter((part) => part.length > 0);
  if (parts.length <= 1) return splitWithin(text, limit, depth + 1);

  return parts.flatMap((part) => splitWithin(part, limit, depth + 1));
}

export function chunkText(text: string): string[] {
  if (text.trim().length === 0) return [];

  const pieces = splitWithin(text, MAX_CHARS, 0)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);

  const chunks: string[] = [];
  let current = '';

  for (const piece of pieces) {
    if (current.length === 0) {
      current = piece;
    } else if (current.length + 1 + piece.length <= MAX_CHARS) {
      current = `${current} ${piece}`;
    } else {
      chunks.push(current);
      current = piece;
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
