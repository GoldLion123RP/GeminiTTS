import { chunkText, MAX_CHARS } from './chunk';

export const CHARS_PER_SECOND = 14;

export const AUDIO_TOKENS_PER_SECOND = 25;

export const COST_PER_MILLION_OUTPUT_TOKENS_USD = 6.0;
export const COST_PER_MILLION_INPUT_TOKENS_USD = 0.5;

export interface Estimate {
  characters: number;
  seconds: number;
  chunks: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  calibrated: boolean;
}

export function estimateDurationSeconds(text: string): number {
  return text.trim().length / CHARS_PER_SECOND;
}

export function estimateText(text: string): Estimate {
  const characters = text.trim().length;
  const seconds = estimateDurationSeconds(text);
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
    calibrated: false,
  };
}

export { MAX_CHARS };
