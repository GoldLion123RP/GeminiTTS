import { chunkText, MAX_CHARS } from './chunk';

/**
 * Speaking rate, in characters per second, MEASURED on 2026-09-26 against
 * real `gemini-3.8-flash-lite-tts` output rather than assumed. Each figure
 * is the mean of the samples listed in the Phase 7.5 changelog entry.
 *
 * The rate is script-dependent, which the plan's single placeholder
 * constant could not express. English averaged 15.4 chars/s across three
 * samples but spanned 13.8-17.1 depending on the voice, while Bengali
 * averaged 11.6 with a tight 11.3-12.2 spread. The best single global value
 * (12) is 11.0% off on average and 30% off at worst; these per-script rates
 * land within ~4% on every sample measured.
 *
 * `hi` rests on a single sample and is the least trustworthy figure here —
 * it sits at the measured value rather than pretending to precision it does
 * not have. See the changelog for the cost of that thinness.
 */
export const CHARS_PER_SECOND: Record<string, number> = {
  en: 15.4,
  bn: 11.6,
  hi: 12.0,
};

/**
 * Fallback for `auto` and for text whose script cannot be determined: the
 * mean of the measured per-script rates. Deliberately neutral, since
 * guessing a script would bias the one number shown before money is spent.
 */
export const DEFAULT_CHARS_PER_SECOND = 13.3;

export const AUDIO_TOKENS_PER_SECOND = 25;

export const COST_PER_MILLION_OUTPUT_TOKENS_USD = 6.0;
export const COST_PER_MILLION_INPUT_TOKENS_USD = 0.5;

/**
 * Unicode blocks for the scripts this app synthesises. Built from explicit
 * code-point ranges rather than a regex of literal characters, so a range
 * cannot be mistyped or normalised by an editor the way the Bengali
 * terminator in `chunk.ts` once was.
 */
const SCRIPT_RANGES: ReadonlyArray<{ id: string; from: number; to: number }> = [
  { id: 'bn', from: 0x0980, to: 0x09ff }, // Bengali
  { id: 'hi', from: 0x0900, to: 0x097f }, // Devanagari
];

/** Basic Latin letters, the default script for anything unrecognised. */
const LATIN_RANGE = { from: 0x0041, to: 0x005a } as const;
const LATIN_RANGE_LOWER = { from: 0x0061, to: 0x007a } as const;

/**
 * Classifies text by its dominant script, counting letters only so that
 * punctuation, digits, and whitespace cannot sway the result. Latin is
 * counted as a candidate rather than being an automatic fallback, so an
 * English paragraph with one Bengali word in it is still priced as English —
 * which a "any Indic letter present" rule would get wrong, and would then
 * over-quote a mostly-English document by a third.
 */
export function detectScript(text: string): 'en' | 'bn' | 'hi' {
  const counts = new Map<string, number>([['en', 0]]);

  const add = (id: string): void => {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  };

  for (const character of text) {
    const code = character.codePointAt(0);
    if (code === undefined) continue;

    if (
      (code >= LATIN_RANGE.from && code <= LATIN_RANGE.to) ||
      (code >= LATIN_RANGE_LOWER.from && code <= LATIN_RANGE_LOWER.to)
    ) {
      add('en');
      continue;
    }

    for (const range of SCRIPT_RANGES) {
      if (code >= range.from && code <= range.to) {
        add(range.id);
        break;
      }
    }
  }

  let best = 'en';
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best as 'en' | 'bn' | 'hi';
}

export function charsPerSecondFor(text: string): number {
  return CHARS_PER_SECOND[detectScript(text)] ?? DEFAULT_CHARS_PER_SECOND;
}

export interface Estimate {
  characters: number;
  seconds: number;
  chunks: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  /** The speaking rate actually applied, so the UI can state its basis. */
  charsPerSecond: number;
  /** The script the rate was chosen for. */
  script: string;
  calibrated: boolean;
}

export function estimateDurationSeconds(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.length / charsPerSecondFor(trimmed);
}

export function estimateText(text: string): Estimate {
  const characters = text.trim().length;
  const script = detectScript(text);
  const charsPerSecond = charsPerSecondFor(text);
  const seconds = characters === 0 ? 0 : characters / charsPerSecond;
  const chunks = chunkText(text);
  const outputTokens = Math.ceil(seconds * AUDIO_TOKENS_PER_SECOND);
  const inputTokens = Math.ceil(characters / 4);

  const estimatedCostUsd =
    (inputTokens * COST_PER_MILLION_INPUT_TOKENS_USD +
      outputTokens * COST_PER_MILLION_OUTPUT_TOKENS_USD) /
    1_000_000;

  return {
    characters,
    seconds,
    chunks: chunks.length,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    charsPerSecond,
    script,
    calibrated: true,
  };
}

export { MAX_CHARS };
