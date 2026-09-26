export type LanguageId = 'auto' | 'en' | 'bn' | 'hi';

export interface Language {
  readonly id: LanguageId;
  readonly label: string;
  /** BCP-47 hint for Transcribe. `null` for Auto, which omits `language_codes`. */
  readonly bcp47: string | null;
}

export const LANGUAGES: readonly Language[] = [
  { id: 'auto', label: 'Auto-detect', bcp47: null },
  { id: 'en', label: 'English', bcp47: 'en-US' },
  { id: 'bn', label: 'বাংলা', bcp47: 'bn-BD' },
  { id: 'hi', label: 'हिन्दी', bcp47: 'hi-IN' },
];

export const DEFAULT_LANGUAGE: LanguageId = 'auto';

const BY_ID = new Map<LanguageId, Language>(LANGUAGES.map((language) => [language.id, language]));

export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === 'string' && BY_ID.has(value as LanguageId);
}

export function language(id: LanguageId): Language {
  const found = BY_ID.get(id);
  if (!found) throw new RangeError(`Unknown language: ${String(id)}`);
  return found;
}

/**
 * `language_codes` for the Transcribe config. An empty array is the documented
 * spelling of "auto-detect" — the field is omitted rather than sent empty, so
 * the model applies its own detection.
 */
export function languageCodes(id: LanguageId): string[] {
  const { bcp47 } = language(id);
  return bcp47 === null ? [] : [bcp47];
}
