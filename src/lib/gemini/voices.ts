export interface Voice {
  readonly name: string;
  /** Google's own character descriptor, used as the `<optgroup>` label. */
  readonly character: string;
}

export interface VoiceGroup {
  readonly character: string;
  readonly voices: readonly Voice[];
}

/**
 * All 30 prebuilt Gemini TTS voices, grouped by Google's character descriptors.
 * Order of both the groups and the voices within them is presentation only.
 *
 * Gender is deliberately absent: it is not part of Google's table, so any value
 * here would be an unverified claim.
 */
const ROSTER: readonly { character: string; names: readonly string[] }[] = [
  { character: 'Bright', names: ['Zephyr', 'Autonoe'] },
  { character: 'Firm', names: ['Kore', 'Orus', 'Alnilam'] },
  { character: 'Warm', names: ['Sulafat'] },
  { character: 'Knowledgeable', names: ['Sadaltager'] },
  { character: 'Informative', names: ['Charon', 'Rasalgethi'] },
  { character: 'Gentle', names: ['Vindemiatrix'] },
  { character: 'Breezy', names: ['Aoede'] },
  { character: 'Upbeat', names: ['Puck', 'Laomedeia'] },
  { character: 'Clear', names: ['Iapetus', 'Erinome'] },
  { character: 'Even', names: ['Schedar'] },
  { character: 'Friendly', names: ['Achird'] },
  { character: 'Lively', names: ['Sadachbia'] },
  { character: 'Excitable', names: ['Fenrir'] },
  { character: 'Breathy', names: ['Enceladus'] },
  { character: 'Smooth', names: ['Algieba', 'Despina'] },
  { character: 'Gravelly', names: ['Algenib'] },
  { character: 'Soft', names: ['Achernar'] },
  { character: 'Mature', names: ['Gacrux'] },
  { character: 'Casual', names: ['Zubenelgenubi'] },
  { character: 'Youthful', names: ['Leda'] },
  { character: 'Easy-going', names: ['Umbriel', 'Callirrhoe'] },
  { character: 'Forward', names: ['Pulcherrima'] },
];

export const VOICE_GROUPS: readonly VoiceGroup[] = ROSTER.map((group) => ({
  character: group.character,
  voices: group.names.map((name) => ({ name, character: group.character })),
}));

export const VOICES: readonly Voice[] = VOICE_GROUPS.flatMap((group) => group.voices);

const BY_NAME = new Map<string, Voice>(VOICES.map((voice) => [voice.name, voice]));

/** Firm, and applied uniformly across languages — Gemini voices are not language-scoped. */
export const DEFAULT_VOICE = 'Kore';

export function isVoiceName(value: unknown): value is string {
  return typeof value === 'string' && BY_NAME.has(value);
}

export function voice(name: string): Voice {
  const found = BY_NAME.get(name);
  if (!found) throw new RangeError(`Unknown Gemini voice: ${name}`);
  return found;
}

/** Resolves a name to itself, or to the default. Used to sanitise route input. */
export function resolveVoiceName(value: unknown): string {
  return isVoiceName(value) ? value : DEFAULT_VOICE;
}
