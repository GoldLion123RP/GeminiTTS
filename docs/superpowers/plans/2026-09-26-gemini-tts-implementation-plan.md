Status: Proceed-Authorized
Doc-Type: Full

# GeminiTTS — Implementation Plan

<!-- desc: Four-tier phased implementation plan derived from the design spec. Phases 0–6 executed; Phase 7 pending. -->

> [!IMPORTANT]
> **Stack ceiling:** Astro 7 (static scaffold → `output: 'server'`), Tailwind CSS v4 via `@tailwindcss/vite`, bun. `GEMINI_API_KEY` is a **secret server var** — no `PUBLIC_` prefix, ever.
> **Design system is frozen.** `DESIGN.md` is the sole source of truth. Every colour, radius, and font in this plan is a literal transcription from it. Introducing a new token is a breaking change and requires explicit user sign-off.
> **Zero-trust secrets:** never open, read, parse, or grep `.env`, `.env.local`, or any `*.env` file. Use `.env.example`. Never inline a secret into client code.
> **Tooling:** `bun` / `bunx` only. Do not introduce npm, pnpm, or yarn.
> **Environment quirk:** `bun install` fails on this drive with `EINVAL … Failed to replace old lockfile`. Use the `AGENTS.md` workaround: `bun install --no-save`, then generate `bun.lock` in a temp dir on `C:` and copy it in.

> [!WARNING]
> **`gemini-3.8-flash-lite-tts` is text-to-speech ONLY.** It cannot transcribe. Speech→text uses `gemini-3.5-transcribe`; the live draft uses `gemini-3.5-transcribe-live`. Feeding audio to a TTS model will simply error.
>
> **Cost exposure is real.** TTS output is **$6.00 per 1M audio tokens** — 12× the input rate and 400× cheaper input-side is irrelevant. A multi-hour generation is a genuine bill. The estimate-and-confirm step in Phase 5 is therefore **mandatory**, not a UX nicety, and must not be made skippable.
>
> **The live socket needs a browser-issued ephemeral token, never the real key.** Gemini's Live API normally authenticates by putting the API key in the WebSocket URL. That would ship the key to the client. Phase 2.3 mints a short-lived scoped token server-side instead.

> [!CAUTION]
> **The two design-system conflicts in §2.4 were resolved by the user on 2026-09-26:** tight display tracking applies to Latin only, with `letter-spacing: normal` for Bengali and Hindi; Indic glyphs come from browser system fallback, with no third font face loaded. Neither ruling introduces a new design token.

---

## 1. Objectives & Success Criteria

### 1.1 Problem

Turn voice into clean, structured writing and writing into voice, on one page, through the Gemini API, with the key never reaching the browser.

### 1.2 In scope

- One page, two panels: **Speech → Text** and **Text/File → Speech**.
- Mic-only audio input, triggered by button or <kbd>Space</kbd>.
- Live interim draft while recording; authoritative cleaned transcript on stop.
- Paste box plus `.txt` / `.md` / `.pdf` / `.docx` upload.
- Three languages plus Auto, for both directions.
- All 30 Gemini TTS voices, grouped by character.
- Duration + cost estimate shown before generation.
- WAV output, previewable and downloadable.
- `.env` / `.env.example` / `.gitignore` hygiene.

### 1.3 Out of scope

Compressed audio (MP3/Opus) · audio-file input to Speech→Text · multi-speaker synthesis · diarization, word timestamps, custom vocabulary · accounts, history, persistence, database · deployment.

### 1.4 Success criteria

Carried verbatim from the approved spec (`SC1`–`SC12`). The verification matrix in §5 maps each to a command or a manual step.

### 1.5 Deliverables

A working page, four server endpoints, ~14 pure library modules, `bun test` unit tests for the pure modules, and a green `bun run build` + `bun run check`.

---

## 2. Expert Analysis

### 2.1 What the sources actually say

| Claim | Status | Source / date |
|---|---|---|
| Astro API routes are `Request → Response` with **no WebSocket upgrade** | VERIFIED | Astro docs — Endpoints, 2026-09-26 |
| `@astrojs/node` v11.1.6, `mode: 'standalone'`; `output: 'server'` renders all routes on demand | VERIFIED | Astro docs — On-demand rendering / node integration, 2026-09-26 |
| Astro Fonts API is **stable** since `astro@6.0.0`; providers include `google()`, `fontsource()`, `local()` | VERIFIED | Astro docs — Font Provider API, 2026-09-26 |
| Font `subsets` defaults to `["latin"]`; `experimental.glyphs` can slim a Google font | VERIFIED | Astro config reference — `fonts`, 2026-09-26 |
| `getSecret()` from `astro:env/server` reads a raw secret with **no** schema, so no build-time validation | VERIFIED | Astro docs — astro:env reference, 2026-09-26 |
| Schema-declared `access: "secret"` fields **are validated at build time** | VERIFIED | Astro docs — Environment variables, 2026-09-26 |
| Only `PUBLIC_`-prefixed vars reach client code | VERIFIED | Astro docs — Environment variables, 2026-09-26 |
| `@theme` vars must be top-level; they *generate utilities*, which `:root` vars do not | VERIFIED | Tailwind docs — theme.mdx (commit `7f92c22`) |
| `@theme inline` makes a utility emit the referenced value instead of `var(--token)` | VERIFIED | Tailwind docs — theme.mdx |
| Custom variants: `@custom-variant name { &:where([data-x="y"] *) { @slot; } }` | VERIFIED | Tailwind docs — adding-custom-styles.mdx |
| Custom variants can nest media queries, e.g. `@media (any-hover: hover)` | VERIFIED | Tailwind docs — adding-custom-styles.mdx |
| Tailwind v4 scans source as **plain text** — concatenated class fragments are invisible | VERIFIED | Tailwind docs — detecting-classes-in-source-files |
| v4 browser floor: Safari 16.4+, Chrome 111+, Firefox 128+ | VERIFIED | Tailwind docs — compatibility |
| `hover:` applies only on hover-capable devices in v4 | VERIFIED | Tailwind docs — hover-focus-and-other-states |
| TTS output is headerless PCM s16le mono 24 kHz | VERIFIED | Gemini speech-generation docs, 2026-09-26 |
| TTS context window 32k tokens; older models had an 8,192-token **input** limit | VERIFIED | Gemini speech-generation + model pages, 2026-09-26 |
| `gemini-3.8-flash-lite-tts`: GA, 100+ languages, **auto-detects input language**, $0.50/M in, $6.00/M out, released 2026-09-23 | VERIFIED | User screenshot + Gemini release notes 2026-09-22 |
| 30 prebuilt voices with character descriptors | VERIFIED | Gemini voice-config docs, 2026-09-26 |
| `gemini-3.5-transcribe`: 85+ languages auto-detect; `language_codes` BCP-47 hints; `[]`/omitted = auto | VERIFIED | Gemini transcribe docs, 2026-09-26 |
| Smart mode: filler removal, self-correction resolution, intent-aware alphanumeric formatting | VERIFIED | Gemini 3.5 Transcribe model card, 2026-09-26 |
| Transcribe accepts `audio/webm` and `audio/opus`; inline requests capped at 20 MB | VERIFIED | Gemini transcribe + audio docs, 2026-09-26 |
| `gemini-3.5-transcribe-live` streams interim + finalized text over WebSocket; `responseModalities: [TEXT]`, `inputAudioTranscription` | VERIFIED | Gemini Live API live-transcribe docs, 2026-09-26 |
| Live API audio input is **raw PCM s16le 16 kHz LE** — not webm | VERIFIED | Gemini Live API WebSocket docs, 2026-09-26 |
| Live API key-in-URL is the default auth; **ephemeral tokens** via `POST /v1beta/auth_tokens` are the documented client-safe alternative | VERIFIED | Gemini Live API get-started-websocket, 2026-09-26 |
| Interactions API is the recommended interface; `generateContent` is legacy | VERIFIED | Gemini API docs landing, 2026-09-26 |
| Ephemeral-token request body bound to `gemini-3.5-transcribe-live` | **VERIFIED in Phase 2** | Gemini Live API ephemeral-tokens doc, 2026-09-26, cross-checked against `CreateAuthTokenConfig` / `LiveConnectConstraints` in `@google/genai@2.24.0` |
| `TranscriptionConfig.mode` runtime shape (`"smart"` vs `{type:"smart"}`) | **RESOLVED in Phase 2** | `GenerateContentConfig.audioTranscriptionConfig.mode` is the `AudioTranscriptionConfigMode` enum (`SMART`), not the bare string. See the Phase 2 changelog. |
| Audio-output-token → seconds ratio | **RESOLVED in Phase 1** | Gemini + Cloud TTS pricing pages both state **25 audio output tokens per second**, fetched 2026-09-26. The older 32 tok/s figure applies to earlier preview TTS models. |
| `gemini-3.8-flash-lite-tts` streaming support | **UNVERIFIED** | Non-blocking — we chunk regardless |

### 2.2 First-principles trade-offs

| Axis | Chosen | Rejected | Why the winner wins |
|---|---|---|---|
| Secret handling | `getSecret()` in server modules only | `env.schema` with `access:"secret"` | Schema secrets are validated at build → `bun run build` breaks on a fresh clone before `.env` exists. `getSecret` defers entirely to runtime. |
| Secret transport | Server-minted ephemeral token, browser dials Google | Key in WS URL · sidecar proxy | Key-in-URL is a full compromise. A proxy adds only IP masking and logging — worthless for a local single-user tool — while adding a process, a port, and CORS surface. |
| Output format | WAV, header written in-process | `lamejs` · `ffmpeg` · MP3 | `lamejs` is a browser lib run server-side; pure-JS encode is CPU-bound and degrades on long text. `ffmpeg` breaks clone-and-run. WAV is zero-dependency and instant. |
| Long text | Sentence-boundary chunk → byte-concat PCM → one header | Per-chunk encode + join | Raw PCM has no inter-frame dependency, so concatenation is **mathematically lossless**. MP3 would need frame and bitrate alignment. This is the payoff for choosing WAV. |
| Transcript quality | Transcribe Smart → Flash structure pass | Smart alone | Smart normalises and de-fills but does not produce Typeless-grade structure. Text output costs a fraction of a cent. Mitigated by exposing the raw transcript. |
| Cost control | Mandatory estimate → confirm → generate | Generate immediately | $6.00/M output. The confirm step is the *only* control on an uncapped job, so it is not optional. |
| Model tier | `flash-lite-tts` throughout | `3.8-flash-tts` flagship | User's explicit cost-efficiency choice. Documented trade: flash-lite is positioned for dubbing, localisation and high-throughput — not studio-grade expressive acting. |

### 2.3 Pre-mortem — what will bite, ranked by likelihood

| # | Failure | Likelihood | Mitigation |
|---|---|---|---|
| 1 | `bun install` fails on this drive | **High** | Documented `AGENTS.md` workaround; do it in Phase 0 before anything depends on it |
| 2 | **ASCII-only sentence splitting silently fails on বাংলা / हिन्दी** | **CONFIRMED REAL, mitigated** | Measured in Phase 1: an ASCII-only splitter returns **one 60 016-character chunk** for Bengali and **60 021** for Devanagari, against a 24 000 budget. The chunker is script-aware and four named regression tests guard it. See the Phase 1 changelog entry for the U+09CE letter/terminator trap. |
| 3 | Ephemeral token body differs from expectation | Medium | Isolated to one module; batch path independent; fallback is the sidecar proxy, raised with the user not silently swapped |
| 4 | Design-system conflict on Indic type | **Resolved** | Escalated in §2.4 and ruled on by the user 2026-09-26; implemented in Phase 4.1 |
| 5 | Clipboard write rejects | Medium | Fall back to a visible Copy control; never assert a success state not observed |
| 6 | Cost estimate wrong | Medium | Label "estimated"; calibrate in Phase 1.3; confirm-before-generate |
| 7 | <kbd>Space</kbd> fires while typing | Medium | Ignore when `activeElement` is a form field or `contenteditable`; ignore `event.repeat` |
| 8 | `MediaRecorder` yields a MIME Transcribe rejects | Low–Medium | Negotiate via `isTypeSupported` against a preference list, ending at `audio/webm` (verified supported) |
| 9 | Hydration mismatch / console noise | Low | Framework-free vanilla scripts inside Astro components; verify a clean console |
| 10 | Key leaks into `dist/` | Low | Only `getSecret()` in server modules; **grep `dist/` for the key value** as a hard gate in §5 |
| 11 | AudioWorklet unsupported | Low | Feature-detect; degrade to batch-only with a quiet notice |
| 12 | Audio context blocked by autoplay policy | Low | `AudioContext` is created inside the click handler, never on load |

### 2.4 ✅ Design-system conflicts — resolved by the user (2026-09-26)

`DESIGN.md` freezes the type scale for **Latin** letterforms. The brief requires **বাংলা and হिन्दী**. Two genuine collisions arose. Both were escalated rather than silently resolved, and both were ruled on by the user.

**Conflict A — negative letter-spacing on Indic scripts. → RESOLVED: Latin tracking only.**
`{typography.display-xl}` mandates `letterSpacing: -2.4px`, calibrated to Latin proportions. Bengali and Devanagari have no case, a different ascender/descender rhythm, and headline bars (matra) that negative tracking visually collides with.
**Ruling:** the tight tracking applies under `:lang(en)` only; `letter-spacing: normal` for `:lang(bn)` and `:lang(hi)`. Implemented in Phase 4.1 via `@custom-variant latin`.

**Conflict B — "There is no third face." → RESOLVED: browser system fallback.**
Geist and Geist Mono carry no Bengali or Devanagari glyphs, so something must supply them.
**Ruling:** load **no** third font face. Each browser falls back to its own system Indic face. This honours "no third face" literally, adds zero bytes, and respects the reader's OS language settings. Accepted consequence: Indic text inside a mixed-language paragraph will not match the Latin around it — unavoidable without a third face, and the user chose the design-system purity over typographic uniformity.

Neither ruling introduces a new design token. Both are confined to `src/styles/global.css` in Phase 4.1.

---

## 3. Phases

> Execution order is strict. Each sub-phase lists its prerequisites; **do not start a phase before its stated dependency is checked off**.

### Phase 0 — Environment, secrets, and toolchain

#### 0.1 — Install dependencies
**Goal:** get the four new packages onto disk, surviving the drive quirk.
**Files:** `package.json` [MOD]
**Dependencies:** none — this is first.

`bun install --no-save @astrojs/node @google/genai unpdf mammoth`, then generate `bun.lock` on `C:` and copy it in per the `AGENTS.md` workaround.

Pin `@google/genai` **below 3.0.0** — 3.0.0 raises the Node floor to 22+ and we want to stay on the current 2.x line deliberately, not by accident.

> [!NOTE]
> `bun test` is built into bun. **No test framework dependency is added.**

#### 0.2 — Secret hygiene
**Goal:** the key can never be committed.
**Files:** `.gitignore` [MOD], `.env.example` [NEW], `.env` [NEW — user creates]

`.gitignore` — the current file ignores only `.env` and `.env.production`, so `.env.local` and `.env.development` are **not ignored today**. That is a live leak risk. Replace that block:

```gitignore
# environment variables
.env
.env.*
!.env.example
```

Order is load-bearing: `.env.*` also matches `.env.example`, so the negation must come after.

`.env.example`:
```
# Copy to .env and fill in. Never commit .env.
# Get a key at https://aistudio.google.com/apikey
GEMINI_API_KEY=
```

`.env` is created by the **user**, not by me — I will not write a file containing a secret.

#### 0.3 — Astro config: server output, adapter, fonts
**Goal:** make the project server-capable and load the typefaces.
**Files:** `astro.config.mjs` [MOD]
**Dependencies:** 0.1

```js
// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: { plugins: [tailwindcss()] },
  fonts: [
    { provider: fontProviders.google(), name: 'Geist', cssVariable: '--font-geist',
      weights: [400, 500, 600], styles: ['normal'], subsets: ['latin'],
      fallbacks: ['Arial', 'sans-serif'] },
    { provider: fontProviders.google(), name: 'Geist Mono', cssVariable: '--font-geist-mono',
      weights: [500], styles: ['normal'], subsets: ['latin'],
      fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
  ],
});
```

`weights` defaults to `[400]` only — declaring 500 and 600 explicitly is required or the headings and buttons silently fall back. Only two faces are registered, honouring "no third face"; see §2.4 Conflict B for the Indic fallback consequence.

> [!NOTE]
> **`fallbacks` were added during Phase 0 execution (2026-09-26).** Astro's default is only `["sans-serif"]`, which silently discards the `Arial` fallback at `DESIGN.md` L40 and all four mono fallbacks at L64. Both arrays above transcribe the real `DESIGN.md` stacks. No new token is introduced.

> [!NOTE]
> **Fonts are provisioned but not yet applied.** Astro emits `@font-face` only for families a stylesheet actually references. As of Phase 0 nothing references `--font-geist` / `--font-geist-mono`, so both files download and cache but no declaration is emitted into the built CSS. **Phase 4.1 must bind the typography tokens to these variables**, or the fonts are fetched and never used.

`output: 'server'` replaces the static default. Per Astro docs this server-renders all pages by default; `src/pages/index.astro` may set `prerender = true` later if it proves to have no per-request data.

#### 0.4 — Env typing
**Goal:** typed `import.meta.env` in editor.
**Files:** `src/env.d.ts` [NEW]
**Dependencies:** 0.3

```ts
/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly GEMINI_API_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

Marked optional because the build must not fail on a machine without `.env` — see 0.2's rationale.

---

### Phase 1 — Pure audio libraries (no Astro, no DOM, no network)

> Every module here is a pure function. This is what makes Phase 5's tests possible without mocking a server.

#### 1.1 — WAV container
**Goal:** turn headerless PCM into a playable file.
**Files:** `src/lib/audio/wav.ts` [NEW]
**Dependencies:** 0.1

```ts
export const SAMPLE_RATE = 24_000;
export const CHANNELS = 1;
export const BITS_PER_SAMPLE = 16;
const HEADER_BYTES = 44;
const BLOCK_ALIGN = (CHANNELS * BITS_PER_SAMPLE) / 8;   // 2
const BYTE_RATE = (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8; // 48_000

export function pcmToWav(pcm: Uint8Array): Uint8Array {
  const view = new DataView(new ArrayBuffer(HEADER_BYTES));
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  const dataSize = pcm.byteLength;

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM fmt chunk size
  view.setUint16(20, 1, true);           // format = PCM integer
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, BYTE_RATE, true);
  view.setUint16(32, BLOCK_ALIGN, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(HEADER_BYTES + dataSize);
  out.set(new Uint8Array(view.buffer), 0);
  out.set(pcm, HEADER_BYTES);
  return out;
}
```

All multi-byte integers are little-endian. `pcm` must be **even-length** s16le mono.

#### 1.2 — Script-aware chunker ⚠️
**Goal:** split long text at safe boundaries without ever splitting a word — **in any of the three languages**.
**Files:** `src/lib/audio/chunk.ts` [NEW]
**Dependencies:** none

```ts
export const CHUNK_TOKEN_BUDGET = 6_000;
const CHARS_PER_TOKEN = 4;
export const MAX_CHARS = CHUNK_TOKEN_BUDGET * CHARS_PER_TOKEN; // 24_000

// ASCII terminators, plus the Indic ones. Built from explicit code points so
// an editor cannot mistype or normalise them:
//   U+002E FULL STOP, U+0021 EXCLAMATION MARK, U+003F QUESTION MARK
//   U+0964 DEVANAGARI DANDA, U+0965 DEVANAGARI DOUBLE DANDA  (Hindi, and Bengali)
//   U+09F3 BENGALI QUESTION SIGN, U+09F7 BENGALI QUARTER NOTE
// An ASCII-only splitter never fires on Bengali or Hindi and silently returns
// one oversized chunk. See the Phase 1 changelog entry for the U+09CE trap.
const SENTENCE_TERMINATORS = String.fromCodePoint(0x2e, 0x21, 0x3f, 0x964, 0x965, 0x9f3, 0x9f7);
const SENTENCE_SPLIT = new RegExp(`(?<=[${escapeForClass(SENTENCE_TERMINATORS)}])[ \\t]+`, 'u');
const CLAUSE_SPLIT = /(?<=[,;:—–])\s+/u;
const WORD_SPLIT = /\s+/u;
```

`chunkText(text)` tries, in order: paragraph break → sentence → clause → word. It never splits mid-word, never drops a character, and never returns an empty chunk. A single sentence longer than `MAX_CHARS` falls through to clause, then word splitting.

#### 1.3 — Duration and cost estimation
**Goal:** give the user real numbers before spending money.
**Files:** `src/lib/audio/estimate.ts` [NEW]
**Dependencies:** 1.2

```ts
export const CHARS_PER_SECOND = 14;   // CALIBRATED — see below
export const COST_PER_MILLION_OUTPUT_TOKENS_USD = 6.0;
export const COST_PER_MILLION_INPUT_TOKENS_USD = 0.5;
```

Duration is `chars / CHARS_PER_SECOND`; cost is derived from the *measured* PCM output of a real generation once Phase 6 has run end-to-end.

> [!CAUTION]
> **`CHARS_PER_SECOND = 14` is a placeholder, not a measurement.** The audio-token-to-seconds ratio is unpublished. Before this plan is considered done, generate one known passage, record actual duration, and solve for the constant. The UI labels the figure "estimated" until then. Shipping the placeholder uncalibrated would be exactly the kind of unverified claim this project forbids.

#### 1.4 — Tests
**Goal:** prove the pure modules.
**Files:** `src/lib/audio/*.test.ts` [NEW]
**Dependencies:** 1.1, 1.2, 1.3

`wav.test.ts` — assert `RIFF`/`WAVE`/`fmt `/`data` markers, `byteLength === 44 + pcm.length`, sample rate 24000, byte rate 48000, and that the `data` size field equals the PCM length.

`chunk.test.ts` — the four critical cases:
- Latin multi-sentence splits into multiple chunks
- **Bengali multi-sentence splits into multiple chunks** (regression guard for risk #2)
- **Devanagari multi-sentence splits into multiple chunks**
- `chunkText(s).join('') === s` after whitespace normalisation — nothing is lost
- A single 50 000-character sentence is split without exceeding `MAX_CHARS`
- Empty and whitespace-only input return `[]`

---

### Phase 2 — Gemini server layer

#### 2.1 — Client singleton
**Goal:** one configured `GoogleGenAI` per process.
**Files:** `src/lib/gemini/client.ts` [NEW]
**Dependencies:** 0.1, 0.2

```ts
import { GoogleGenAI } from '@google/genai';
import { getSecret } from 'astro:env/server';

let client: GoogleGenAI | undefined;
export function gemini(): GoogleGenAI {
  if (!client) {
    const apiKey = getSecret('GEMINI_API_KEY');
    if (!apiKey) throw new ConfigError('GEMINI_API_KEY is not set. Copy .env.example to .env and fill it in.');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}
```

`getSecret` rather than a schema field, precisely because schema secrets are validated at build time and would break a fresh clone.

#### 2.2 — Language and voice tables
**Goal:** typed, testable reference data.
**Files:** `src/lib/gemini/languages.ts` [NEW], `src/lib/gemini/voices.ts` [NEW]
**Dependencies:** none

`languages.ts` — `auto` (omit `language_codes`), `en` → `en-US`, `bn` → `bn-BD`, `hi` → `hi-IN`, each with its native label (English · বাংলা · हिन्दी).

`voices.ts` — all 30 prebuilt voices with Google's character descriptors, grouped: Bright, Firm, Warm, Knowledgeable, Informative, Gentle, Breezy, Upbeat, Clear, Even, Friendly, Lively, Excitable, Breathy, Smooth, Gravelly, Soft, Mature, Casual, Youthful, Easy-going, Forward. Default `Kore` (*Firm*), applied uniformly across languages because voices are not language-scoped.

#### 2.3 — Ephemeral token minting ⚠️
**Goal:** let the browser open a Live socket without ever seeing the key.
**Files:** `src/lib/gemini/live-token.ts` [NEW]
**Dependencies:** 2.1

Server-side call to `POST /v1beta/auth_tokens` carrying the real key in `x-goog-api-key`, with `uses: 1` and `liveConnectConstraints` binding the token to `models/gemini-3.5-transcribe-live` and a `TEXT`-only config. Returns the short-lived `access_token`, which the browser passes to `…BidiGenerateContentConstrained?access_token=`.

> [!NOTE]
> **Implemented via the SDK, not raw `fetch`.** `@google/genai@2.24.0` exposes `client.authTokens.create({ config })`, so `live-token.ts` delegates to it rather than hand-rolling the URL and headers. Body and field names were verified against the Gemini Live API ephemeral-tokens docs on 2026-09-26 and cross-checked against the installed `CreateAuthTokenConfig` / `LiveConnectConstraints` types. The original UNVERIFIED flag on this sub-phase is discharged — see the changelog.

> [!WARNING]
> **Retained for Phase 6.** If the browser socket still fails, the token shape is the first thing to re-check, but the fallback remains the **sidecar proxy raised with the user** — never the key-in-URL approach.

#### 2.4 — Transcription, two passes
**Goal:** clean text, then structure — without ever changing a word.
**Files:** `src/lib/gemini/transcribe.ts` [NEW], `src/lib/prompts/structure.ts` [NEW]
**Dependencies:** 2.1, 2.2

Pass 1 — `gemini-3.5-transcribe` in Smart mode, and `language_codes` populated from the selection or left empty for Auto. Audio is sent inline as base64 (webm/opus, well under the 20 MB ceiling).

Pass 2 — `gemini-3.8-flash`, receiving **only** the clean text at `temperature: 0`. `prompts/structure.ts` must state that its sole permitted action is adding document structure — paragraph breaks, implied headings, lists for enumerated speech, fenced code for dictated code — and that it must not add, remove, reorder, or reword content.

> [!NOTE]
> **Smart mode is wired as `config.audioTranscriptionConfig.mode = AudioTranscriptionConfigMode.SMART`, resolved from the installed SDK types on 2026-09-26** — not from the docs. The REST `transcription_config` field shown in the transcribe documentation belongs to the Interactions API, which the installed SDK cannot express an audio input for. A residual risk remains and is tracked for Phase 7: if the backend ignores `audioTranscriptionConfig` on the `generateContent` path, Smart mode is silently downgraded to Verbatim. See the changelog for the one-recording test that settles it.

#### 2.5 — Synthesis with chunking
**Goal:** one seamless WAV from arbitrary-length text.
**Files:** `src/lib/gemini/synthesize.ts` [NEW]
**Dependencies:** 1.1, 1.2, 2.1, 2.2

Chunk via `chunkText`, synthesize each chunk with `gemini-3.8-flash-lite-tts` at the selected voice with a short professional-register style instruction, base64-decode each response to PCM, concatenate the buffers, then wrap once with `pcmToWav`.

**Sequential, not parallel** — ordering must be deterministic or the audio is scrambled. Chunks are independent requests, so a mid-job failure retries one chunk rather than the whole document.

#### 2.6 — File text extraction
**Goal:** four input formats behind one function.
**Files:** `src/lib/extract/text.ts` [NEW]
**Dependencies:** 0.1

`extractText(file: File): Promise<string>` dispatches on MIME/extension: `.txt`/`.md` via `file.text()` (zero dependency), `.pdf` via `unpdf`, `.docx` via `mammoth`. Both heavy parsers stay server-side so they never enter the browser bundle. Unsupported types throw a typed error the UI renders verbatim.

---

### Phase 3 — Server endpoints

**Files:** `src/pages/api/{live-token,transcribe,estimate,synthesize}.ts` [NEW]
**Dependencies:** Phase 2 complete

| Endpoint | Body | Returns | Notes |
|---|---|---|---|
| `POST /api/live-token` | `{ language }` | `{ token, model }` | Never echoes the key |
| `POST /api/transcribe` | `{ audio: base64, mimeType, language, structure: boolean }` | `{ raw, text, language }` | `raw` always retained for the disclosure |
| `POST /api/estimate` | `{ text }` | `{ seconds, chunks, estimatedCostUsd }` | **No Gemini call** — pure local math |
| `POST /api/synthesize` | `{ text, voice, language }` | `audio/wav` | Streams the assembled file |

Every handler: reads the key through 2.1, validates input, maps thrown errors to plain language with the raw detail preserved, and never returns a stack trace or a key. All four log nothing containing user audio or text.

---

### Phase 4 — Design system and shell

#### 4.1 — Tailwind v4 token layer
**Goal:** translate `DESIGN.md` into utilities. **No invented values.**
**Files:** `src/styles/global.css` [MOD]
**Dependencies:** 0.3, **and your §2.4 ruling ✅ received 2026-09-26**

```css
@import 'tailwindcss';

@theme {
  --color-ink: #171717;
  --color-on-primary: #ffffff;
  --color-body: #4d4d4d;
  --color-mute: #8f8f8f;
  --color-faint: #a1a1a1;
  --color-hairline: #ebebeb;
  --color-hairline-soft: #f2f2f2;
  --color-canvas: #fafafa;
  --color-elevated: #ffffff;
  --color-link: #0070f3;
  --color-link-deep: #0761d1;
  --color-error: #ee0000;
  --color-warning: #f5a623;
  --color-warning-soft: #ffefcf;
  --color-violet: #7928ca;
  --color-cyan: #50e3c2;
  --color-pink: #ff0080;

  --radius-app: 6px;
  --radius-card: 12px;
  --radius-panel: 16px;
  --radius-pill: 100px;

  --shadow-whisper: 0px 1px 1px rgb(0 0 0 / 0.04);

  --animate-recording: recording 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;

  @keyframes recording {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.35; }
  }
}
```

Values are copied literally from `DESIGN.md`, which specifies **hex** — so hex it is; converting to `oklch` would be inventing a token. `--animate-recording` carries its `@keyframes` **inside** `@theme` so Tailwind emits them.

> [!NOTE]
> **Executed 2026-09-26 with three recorded deviations — read the Phase 4 changelog before re-applying this block.** The block below is the *spec*, not what shipped: the colour set was widened to all 31 `DESIGN.md` colours (this one omits the six `gradient-*` stops §4.2's mesh needs), two type tokens were added, `:where()` became `:is()` in the variants, and source detection is now pinned to `src/`. `src/styles/global.css` is the authority; this snippet is not.

State, motion, and script as custom variants, using the documented `&:where(...)` + `@slot` form:

```css
@custom-variant recording (&:where([data-recording='true'] *));
@custom-variant live (&:where([data-live='connected'] *));

/* §2.4 Conflict A ruling: the frozen -2.4px display tracking is a Latin
   measurement. Bengali and Devanagari get normal tracking, because
   negative tracking collides with their headline bars (matra). */
@custom-variant latin (&:where(:lang(en), :lang(en) *));
```

Usage: `latin:tracking-[-0.04em]` for display headings, with a plain `tracking-normal` as the Indic-safe base in the same class list. The base is what Indic readers get; the variant restores the design-system value for Latin. No new colour, radius, or spacing token is introduced by this ruling.

Per §2.4 Conflict B, **no Indic font is registered.** The `fonts` array in 0.3 stays at exactly Geist and Geist Mono; the browser's own system fallback supplies Bengali and Devanagari glyphs.

The recording pulse is continuous motion, so it must respect user preference:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

The 44-byte WAV header is a *file format*, not a design element — it lives in `src/lib/audio/wav.ts`, never in CSS.

#### 4.2 — Layout, hero, footer
**Goal:** the Vercel chrome.
**Files:** `src/layouts/Layout.astro` [MOD], `src/components/Hero.astro` [NEW]
**Dependencies:** 4.1

Headline at `text-6xl` (60px) 600-weight — deliberately **not** 48px, because `DESIGN.md` calls the hero type "oversized" relative to its own 48px token while defining no larger token. Ad-hoc `text-[48px]` was rejected as a fake token. Line-height 1 and tracking `-0.04em` reproduce the design intent without breaking the scale.

The mesh gradient is a blurred `radial-gradient` stack built from the named tokens (`cyan` → `violet` → `pink` → `warning`), scoped to the hero element and `aria-hidden`. **`DESIGN.md` confines it to the hero; it appears nowhere else.**

Footer: hairline top border, `body` text, `{spacing.3xl}` vertical padding.

#### 4.3 — Primitives
**Goal:** the two button shapes, kept strictly separate.
**Files:** `src/components/{MicButton,LanguageSelect,VoiceSelect}.astro` [NEW]
**Dependencies:** 4.1

- `MicButton` — `button-icon-circular`: full radius, 1px hairline, white fill; inverts to ink fill with the pulsing ring under `recording:`. 44px minimum.
- `LanguageSelect` / `VoiceSelect` — `text-input` spec: white, 1px hairline, `rounded-app` (6px), `body-md`. `VoiceSelect` uses native `<optgroup>` to group by character — free, accessible, keyboard-navigable, zero JS.
- Focus rings at `--color-link` on every interactive element.

---

### Phase 5 — Text / File → Speech panel

**Files:** `src/components/TtsPanel.astro` [NEW], `src/components/AudioResult.astro` [NEW]
**Dependencies:** Phase 3, 4.3

Flow: paste or upload → debounced `POST /api/estimate` → render **estimated** duration, chunk count, and estimated cost → user confirms → `POST /api/synthesize` → `URL.createObjectURL` → `<audio controls>` preview + download link → `revokeObjectURL` on replace.

Estimate is debounced at ~300 ms and never fires on an empty box. Progress reports `3 / 24 chunks`. A cancel control aborts the fetch. The confirm button is **not** skippable — see the cost warning at the head of this document.

Empty input, extraction failure, and synthesis failure each get a distinct hairline-bordered inline alert with a retry. Never a silent no-op.

---

### Phase 6 — Speech → Text panel

**Files:** `src/components/SttPanel.astro` [NEW], `src/components/TranscriptView.astro` [NEW], `src/components/MicButton.astro` [MOD — optional `id` prop], `src/pages/api/live-token.ts` [MOD — returns a ready-to-dial `url`], `src/lib/gemini/live-token.ts` [MOD — URL corrected]
**Dependencies:** Phase 3, 4.3

> [!NOTE]
> **Deviations from this section, as executed.** (a) `src/pages/index.astro` mounts the two panels in a 2-up grid per §3.8, not stacked. (b) The Live socket URL is **served** by `/api/live-token` rather than built in the browser: the client cannot import `liveSocketUrl()`, because that module pulls `astro:env/server` and `@google/genai` into the bundle. The plan's "imported, not retyped" intent holds — the import is server-side. (c) `liveSocketUrl()` no longer takes a `model` argument and no longer puts one on the wire; the *constrained* endpoint binds the model through the token. See the changelog for the verification and the one remaining uncertainty (the path form).

**Two concurrent capture paths from one `getUserMedia` stream:**

- **Live** — `AudioWorklet` emits s16le PCM @ 16 kHz (Live API's required format) → `WebSocket` to Gemini using the ephemeral token → interim text renders in `--color-mute`, clearly provisional.
- **Batch** — `MediaRecorder` captures webm/opus → on stop, `POST /api/transcribe`.

`AudioContext` is constructed **inside the click handler** so autoplay policy never blocks it.

**Stop sequence:** close the socket → finalise the `MediaRecorder` blob → POST to `/api/transcribe` → replace the provisional text with the authoritative result → attempt `navigator.clipboard.writeText` → on success show "Copied"; on failure show a prominent Copy control. **A success state is never rendered unless the write actually resolved.**

**<kbd>Space</kbd> handling:**
```ts
const el = document.activeElement;
if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        || el.tagName === 'SELECT' || el.isContentEditable)) return;
if (event.repeat) return;
if (event.code === 'Space') { event.preventDefault(); toggle(); }
```

**Graceful degradation:** no `AudioWorklet` or a dropped socket → batch-only, with a quiet inline notice. Recording is never interrupted by a live-path failure. Silence detected → an explicit "No speech detected", not an empty box.

---

### Phase 7 — Verification, documentation, review gates

**Files:** `README.md` [MOD]
**Dependencies:** Phases 0–6

Run the full §5 matrix. Then load the **`web-design-guidelines`** skill and audit the result; load **`code-skeptic`** before claiming completion. `README.md` is updated in the same turn as the code that makes it false — not deferred.

---

## 4. Progress Checklist

> **Auto-update contract:** on completing any sub-phase, edit this file and change `- [ ]` → `- [x]` immediately. The list must always mirror real repository state. Never leave finished work unchecked.

- [x] **Phase 0 — Environment, secrets, toolchain**
  - [x] 0.1 Install `@astrojs/node`, `@google/genai` (pinned <3.0.0), `unpdf`, `mammoth`; generate `bun.lock` via the `C:` workaround
  - [x] 0.2 Harden `.gitignore` to `.env*` + `!.env.example`; add `.env.example`
  - [x] 0.3 `astro.config.mjs`: `output: 'server'`, node standalone adapter, Geist + Geist Mono via Fonts API
  - [x] 0.4 Add `src/env.d.ts` with optional `GEMINI_API_KEY` typing
- [x] **Phase 1 — Pure audio libraries**
  - [x] 1.1 `src/lib/audio/wav.ts` — 44-byte RIFF header
  - [x] 1.2 `src/lib/audio/chunk.ts` — script-aware chunker incl. Indic terminators
  - [x] 1.3 `src/lib/audio/estimate.ts` — duration + cost (constant **not yet calibrated**)
  - [x] 1.4 `bun test` — WAV, chunker (incl. Bengali/Devanagari regressions), estimator
- [x] **Phase 2 — Gemini server layer**
  - [x] 2.1 `src/lib/gemini/client.ts` — `getSecret` singleton
  - [x] 2.2 `languages.ts` + `voices.ts` — 4 options, 30 voices grouped
  - [x] 2.3 `live-token.ts` — body schema **VERIFIED** against live docs + SDK types
  - [x] 2.4 `transcribe.ts` + `prompts/structure.ts` — `mode` shape **RESOLVED** from SDK types
  - [x] 2.5 `synthesize.ts` — sequential chunks, PCM concat, one header
  - [x] 2.6 `extract/text.ts` — txt / md / pdf / docx
- [x] **Phase 3 — Server endpoints**
  - [x] 3.1 `POST /api/live-token` — mints the ephemeral token, **passing the selected language through** (fixed in Phase 3)
  - [x] 3.2 `POST /api/transcribe` — returns `raw` + `text`, `structure` toggle honoured
  - [x] 3.3 `POST /api/estimate` — pure local math, no Gemini call
  - [x] 3.4 `POST /api/synthesize` — `audio/wav` with `x-chunks` / `x-duration-seconds`
  - [x] 3.5 Handler + `api-response` tests; 3 deliberate mutants injected, 3 killed
- [x] **Phase 4 — Design system and shell**
  - [x] 4.1 `global.css` — `@theme` tokens, `recording`/`live`/`latin` variants, reduced-motion (§2.4 rulings applied)
  - [x] 4.2 `Layout.astro` + `Hero.astro` — hero-only mesh gradient, oversized headline
  - [x] 4.3 `MicButton` / `LanguageSelect` / `VoiceSelect` — 6px vs circular, never mixed
- [x] **Phase 5 — Text/File → Speech**
  - [x] 5.1 Textarea + `.txt`/`.md`/`.pdf`/`.docx` upload — **via a new `POST /api/extract`**, see the Phase 5 changelog
  - [x] 5.2 Estimate panel — duration, chunks, cost, mandatory confirm
  - [x] 5.3 Synthesis with progress + cancel; preview + download
- [x] **Phase 6 — Speech → Text**
  - [x] 6.1 `getUserMedia` + secure-context detection
  - [x] 6.2 `AudioWorklet` PCM 16 kHz live path + ephemeral-token socket
  - [x] 6.3 `MediaRecorder` webm batch path
  - [x] 6.4 Stop → transcribe → auto-copy with honest fallback
  - [x] 6.5 <kbd>Space</kbd> toggle with form-field and `repeat` guards
  - [x] 6.6 Raw-transcript disclosure + structure toggle
- [ ] **Phase 7 — Verification & docs**
  - [ ] 7.1 `bun test` green
  - [ ] 7.2 `bun run build` zero errors
  - [ ] 7.3 `bun run check` zero errors
  - [ ] 7.4 Grep `dist/` for the key — zero matches
  - [ ] 7.5 **Calibrate `CHARS_PER_SECOND` against a real generation**
  - [ ] 7.6 Responsive + keyboard + reduced-motion pass
  - [ ] 7.7 `web-design-guidelines` audit
  - [ ] 7.8 `code-skeptic` review with command output
  - [ ] 7.9 `README.md` synchronised

---

## 5. Execution Guide & Verification Protocol

### 5.1 Order of operations

Strict. Never skip a prerequisite phase.

1. **Phase 0 first.** Everything depends on the toolchain. If 0.1 fails, stop and resolve the lockfile before writing any code.
2. **Phase 1 before Phase 2.** The pure libraries are testable in isolation; building them first means the Gemini layer sits on verified ground.
3. **Phase 2.3's gate is discharged (2026-09-26).** The ephemeral-token body was verified against the live docs and the installed SDK types, so Phase 6.2's socket code can be written against a known-good URL and token. Do not code ahead on assumption anyway — the `?access_token=` URL is constructed in `liveSocketUrl()` and should be imported, not retyped.
4. **Phase 4.1 is now unblocked** — the §2.4 rulings landed 2026-09-26 and are recorded in §2.4. Implement them as written; do not re-litigate.
5. **Phase 7.5 is a real task, not a formality.** An uncalibrated cost estimate is an unverified claim.

### 5.2 Context preservation

Before editing, re-read rather than assume: `astro.config.mjs` (0.3 may have been touched), `package.json` versions, `.gitignore` ordering, and the installed `@google/genai` type definitions for the exact `TranscriptionConfig` shape. Training data is stale on all of these.

### 5.3 Rollback and recovery

| Failure | Recovery |
|---|---|
| `bun install` lockfile error | `bun install --no-save`; generate lockfile on `C:`, copy in. Do not delete `bun.lock` — back it up first. |
| `output: 'server'` breaks the build with `AdapterSupportOutputMismatch` | Adapter missing or misconfigured. Re-check 0.3 imports both `node` and passes `adapter`, not just `output`. |
| `NoAdapterInstalled` | Same root cause. |
| `EnvPrefixConflictsWithSecret` | A secret name matches a `vite.envPrefix`. Rename or narrow the prefix. |
| Build fails on a missing env var | A schema secret is being validated at build. Move it to `getSecret()` (2.1). |
| Ephemeral token 400 | Body schema is wrong (2.3). Re-read live docs. Do **not** fall back to key-in-URL. |
| Tailwind class has no effect | v4 scans source as plain text. A concatenated or dynamically built class name is invisible — map to full literal strings. |
| Component `<style>` cannot read theme vars | Add `@reference` per the v4 rule. |
| Any phase leaves the build red | Stop. Do not proceed to the next phase on a red build. Fix forward, never commit a broken gate. |

### 5.4 Automated verification

```powershell
bun test
bun run build          # must complete with zero errors
bun run check          # must report zero type errors (`astro check`)
```

### 5.5 Secret-safety gate (blocking)

> **Status: re-run for real on 2026-09-26 (Phase 6).** Phase 6 added the first substantial client JavaScript, which is exactly what could carry a key, so the gate was re-run against the final Phase 6 build. `Select-String` for an `AIza`-prefixed key literal across **all** of `dist/` returns **0 matches**, and `GEMINI_API_KEY`, `getSecret`, `generativelanguage`, `@google/genai`, `unpdf` and `mammoth` appear **0** times under `dist/client/`. The `generativelanguage` result is the meaningful one: the client bundle does not contain the Live host at all, because the socket URL is handed over by the server rather than constructed in the browser. The client bundle is two files, 10 365 + 6 721 bytes. Re-run once more in Phase 7.

```powershell
# must return zero matches
Select-String -Path "dist\**" -Pattern "<your key value>" -SimpleMatch

# structural check, independent of the key's value: the name must never appear
# under dist\client\, and dist\client\ must contain no JavaScript at all
Select-String -Path "dist\client\**" -Pattern "GEMINI_API_KEY|getSecret|generativelanguage"
```

A single match is a hard stop. Re-audit every client-reachable module for `getSecret` misuse.

### 5.6 Manual acceptance

- Both panels in all four language modes (Auto / English / বাংলা / हिन्दी).
- **Confirm Smart mode is actually in effect.** Record one passage containing an enumerated list ("there are three reasons… first… second…"). Smart mode emits paragraphs and lists on its own; Verbatim does not. A flat wall of text means `audioTranscriptionConfig` was ignored — fix 2.4 before trusting any transcript quality.
- Both recording triggers, **plus** the negative case: typing <kbd>Space</kbd> inside the textarea must not start recording.
- Live interim text during speech; socket-drop degradation.
- Clipboard auto-copy, and the denied-permission fallback showing Copy.
- Raw-vs-structured diff — confirm no wording changed.
- Multi-chunk synthesis played end to end: no clicks, gaps, or truncation.
- Estimate vs. actual duration on a known passage → **calibrate the constant**.
- Keyboard-only traversal; visible focus at every stop.
- Widths 375px, 768px, 1280px per the `DESIGN.md` breakpoint table.
- `prefers-reduced-motion: reduce` honoured.
- Browser console free of errors and hydration warnings.

### 5.7 Stress and edge cases

| Input | Expected |
|---|---|
| 200 KB pasted text | Chunked, progress shown, cost estimate sane, no truncation |
| Silent recording | "No speech detected" |
| Clipboard permission denied | Copy control, no false "Copied" |
| Live socket killed mid-record | Batch path completes; user not interrupted |
| Rapid mic toggling (10×) | No leaked streams, no orphaned sockets, no duplicate requests |
| Token mint fails | Live draft off, batch still works |
| Empty textarea | Estimate not called; generate disabled |
| `.pdf` that is actually an image | Typed extraction error, verbatim in the UI |
| Voice set to an unavailable name | Falls back to the default voice, not a 4xx — pinned by a Phase 3 test |
| Text with only emoji / no letters | Chunker returns `[]`; UI explains |

### 5.8 Ecosystem compliance

`bun` only · Astro 7 + `@astrojs/node` · Tailwind v4 with `@import 'tailwindcss'` in `src/styles/global.css` · tokens transcribed from `DESIGN.md` with no additions · secrets read only via `getSecret` · no `.env*` file ever opened by the agent.

---

## 6. Exit Gate

1. **Is this the best answer I can give?** → Yes. §2.4 was escalated rather than decided on the first pass, and that was correct: it is a design-system ruling on a frozen file, not an engineering call. Both conflicts are now resolved by the user and recorded in §2.4.
2. **Is there anything I am forgetting?** → Checked. Trigger → Full 4-tier, correct. Tiers 1–4 present. Every sub-phase has goal, files, details, dependencies. VERIFIED/UNVERIFIED tagged with dispositions. Design-token, secret-safety, and bun-only checks all present. Rollback defined. The two highest-likelihood risks — the lockfile failure and ASCII-only sentence splitting on Indic text — are both mitigated with a named regression test.
3. **Is there any way I can improve this answer?** → Applied across two revisions: (a) an explicit `@custom-variant` + reduced-motion requirement after confirming v4's `hover:` behaviour change; (b) a fixed-30-voice test so reference data cannot silently drift from Google's list; (c) §2.4 split into two separately reversible sub-decisions so one could be ruled on without blocking the other — which is exactly how it played out; (d) a named `latin` variant so the Indic tracking ruling is a one-class change rather than scattered `lang()` selectors.

**Confidence: Medium-High** on architecture, sequencing, and the STT/TTS pipelines — all model capabilities, formats, limits, and framework constraints are verified against primary sources dated 2026-09-26.

**Gaps / assumptions, stated plainly:**
- **The Live socket path form is unverified against a running connection.** `liveSocketUrl()` uses the documented long form (`…/v1beta/ws/google.ai.BidiGenerateContentConstrained?access_token=…`); Google's reference client uses a shorter `google.ai.…` variant. Both are believed equivalent, and neither has been dialled with a key present. This is the first thing to check if the live path 400s — **not** the token, which Phase 2 verified, and not the setup message, which was cross-checked against the same reference client.
- **The end-to-end live draft and batch transcript are unproven against the real API.** Every browser verification of Phase 6 ran with no `.env`, which proved the *degradation* paths (token mint failure, missing key, honest error rendering, no stuck state) but not a successful transcript. A recording with a key present is still required, and it is also what Phase 7.5 needs to calibrate `CHARS_PER_SECOND`.
- **Smart mode may be silently downgraded to Verbatim.** `audioTranscriptionConfig` is the SDK's typed field on the `generateContent` path, but the transcribe documentation documents a differently-named REST field on the Interactions path. One recording containing an enumerated list settles it in Phase 7 — Smart formats lists, Verbatim does not.
- **`CHARS_PER_SECOND`** is a placeholder until Phase 7.5 measures it. The UI says "estimated" until then.
- **The `dist/` secret grep was vacuous until Phase 3** created the routes that import these modules. It is now a real gate, re-verified on 2026-09-26 — see the Phase 3 changelog. It must be re-run in Phase 7 against the final build.
- **§2.4 is resolved** (2026-09-26) and Phase 4.1 is unblocked. The accepted trade-offs: Indic text inside a mixed-language paragraph will not match the surrounding Latin, and Bengali/Hindi display type carries normal rather than −2.4px tracking. Both were chosen knowingly.
- Cost figures come from your screenshot and Google's release notes, not a live pricing-page fetch.
- No performance budget is defined beyond "no hydration mismatch"; a bundle-size ceiling was not requested.

---

## 7. Changelog

| Date | Entry |
|---|---|
| 2026-09-26 | **Phase 6 executed and verified. `src/components/SttPanel.astro` (new), `src/components/TranscriptView.astro` (new), `src/pages/index.astro` (2-up grid, both panels mounted), `src/pages/api/live-token.ts` (now returns a ready-to-dial `url`), `src/lib/gemini/live-token.ts` (URL corrected, `model` param dropped), `src/components/MicButton.astro` (optional `id` prop), `src/lib/gemini/live-token.test.ts` (new, 5 tests), `src/pages/api/endpoints.test.ts` (+2 tests). Gates: `bun test` 135 pass / 0 fail / 4 370 assertions across 9 files, `bun run build` exit 0 with zero warnings, `astro check` 0 errors / 0 warnings / 0 hints over 41 files, §5.5 secret grep 0 matches. Browser-verified against `node dist/server/entry.mjs` at 375 / 768 / 1280 px, including the record → stop → transcribe sequence and both <kbd>Space</kbd> cases.** |
| 2026-09-26 | **The AudioContext was closed on the first stop, so the live draft only ever worked once — and the bug blamed the browser.** The context was created at page load and `close()`d at the end of each recording. `AudioContext.close()` is *permanent*: a closed context cannot be reopened, only replaced. The second recording therefore found `audioContext === null`, took the "no AudioWorklet" branch, and displayed **"Live draft is unavailable in this browser"** — false, since the browser was fine. It was silent, misattributed, and invisible to `astro check` and the unit tests. Found only by recording twice in a real browser, which is the entire argument for §5.6's manual acceptance list. Fixed by constructing the context **per recording, inside the click handler** — which is also where autoplay policy requires it, so the fix removed a violation rather than adding a mechanism. The two failure messages are now distinct: a genuinely missing `AudioWorklet` says "this browser does not support", while a failed context construction says "could not start". Collapsing them into one message is what let this hide. |
| 2026-09-26 | **The client cannot import `liveSocketUrl()`, and importing it would have put the secret reader in the browser bundle.** §5.1 says the URL "is constructed in `liveSocketUrl()` and should be imported, not retyped" — correct as far as it goes, and wrong about who imports it. That module imports `astro:env/server` (via `client.ts`) and `@google/genai`, so a client-side import would have dragged both into `dist/client/`. The endpoint now returns the finished `url` alongside the token, and the panel dials it. **Verified, not assumed:** `Select-String` for `generativelanguage` under `dist/client/` returns **0 matches** — the client bundle does not even contain the host it connects to. The spirit of the rule (one source of truth for the URL) is preserved; the import happens server-side. |
| 2026-09-26 | **The socket URL was wrong in a way only a second source could reveal, and the plan never mentioned it.** Phase 2 recorded the URL as `…BidiGenerateContentConstrained?access_token=…&model=models/…`, carried from memory. Re-fetched today: Google's raw-WebSocket page shows `access_token` as the **only** query parameter, and Google's own reference client (`gemini-live-api-examples`) builds the URL with no `model` at all — the constrained endpoint binds the model through `liveConnectConstraints.model` on the *token*, not on the wire. The redundant `model` parameter was removed and the signature reduced to `liveSocketUrl(token)`, with a test asserting `not.toContain('model=')`. A redundant copy of the model is a second source of truth with no way to notice when the two disagree. **The path form remains the one real uncertainty:** the docs give the long `google.ai.generativelanguage.v1beta.GenerativeService.…` form while the reference client uses the short `google.ai.…` form. The long form is kept because it is the documented ephemeral-token endpoint; this is **unresolved against a live socket** and is the first thing to check if the connection 400s with a key present. |
| 2026-09-26 | **A partial module mock broke tests in a different file, in a way that pointed nowhere near the cause.** `endpoints.test.ts` mocks `../../lib/gemini/live-token`, and bun shares one module registry across the whole run. The mock omitted `LIVE_WEBSOCKET_ORIGIN`, so the new `live-token.test.ts` — which exercises the *real* function — built its URL from the string `undefined` and two tests failed with a message naming the wrong file entirely. The mock now reproduces the real URL exactly. A module mock is global state that fails somewhere other than where it was written; the same trap the Phase 1 changelog records for a cached module across dynamic imports. Also hit: a `@google/genai` mock providing only `Modality`, which fails as a link-time `SyntaxError` because `client.ts` also needs `GoogleGenAI` — a partial mock of a real module is not a partial mock of its types. |
| 2026-09-26 | **`innerHTML` is confined to one read of Astro-authored markup, and that boundary is deliberate.** The panel's own rule is that a transcript is model output derived from a microphone and must never become markup, so every dynamic value goes through `textContent`. The mic button swaps its glyph between idle and stop, which is the one place contents are replaced; rather than restate two SVG strings inside the `<script>` — where they would duplicate the frontmatter and drift — the glyphs are authored once in `<template>` elements and read at startup. Same reasoning as Phase 5's `AudioResult` template. Note the Astro constraint that forced it: **an Astro `<script>` is a separate module and cannot read frontmatter**, so every client-side constant must be declared in the script. The first draft declared them in both places and `astro check` flagged the frontmatter copies as `ts(6133)` unused — the type checker earning its keep on a mistake the compiler would not otherwise catch. |
| 2026-09-26 | **The `AudioWorklet` processor is inlined as a Blob URL, and the PCM tail is flushed on stop.** A worklet must load from a URL, and a Blob keeps the 16 kHz s16le resampling contract in the same file as the code that consumes its output instead of splitting it across two files that must silently agree about sample rate. The worklet posts 128-frame quanta; those are accumulated and flushed as whole `FRAME_SAMPLES` (1 600 = exactly 100 ms at 16 kHz, per the docs) WebSocket messages, and **`flushPending()` runs before the socket closes** — a truncated tail is exactly the defect that presents to a user as "the transcript missed my last words" and is never traced back to the sender. The first attempt at this buffering tracked part boundaries in place to avoid copying and was both unreadable and buggy; at 3 200 bytes per frame the copy is free, so it was replaced with concatenate-send-remainder. **Recorded because the clever version is the one that has to be checked against real input sizes.** |
| 2026-09-26 | **The plan's "Quiet inline notice" is implemented as a notice, not an alert.** A user without `AudioWorklet`, or whose token mint fails, still gets a fully working panel — the batch path is independent. The plan's §5.7 row "Token mint fails → live draft off, batch still works" is therefore a *degradation*, not an error, and rendering it in the same hairline-bordered `role="alert"` box Phase 5 uses would be alarming the user about a non-problem. It is a `bg-hairline-soft` note in `body-sm`, no alert role, no retry button. Browser-verified: with no `.env`, recording starts normally, the live path reports the server's own message verbatim ("GEMINI_API_KEY is not set…") with **no stack trace**, and the batch path completes — the mint failure does not interrupt the recording. |
| 2026-09-26 | **Phase 5 executed and verified. `src/components/TtsPanel.astro` (new), `src/components/AudioResult.astro` (new), `src/pages/api/extract.ts` (new), `src/lib/extract/text.ts` (modified — `MAX_EXTRACT_BYTES`), `src/pages/index.astro` (mounts the panel). Gates: `bun test` 128 pass / 0 fail / 4 358 assertions across 8 files, `bun run build` exit 0 with zero warnings, `astro check` 0 errors / 0 warnings / 0 hints over 38 files, §5.5 secret grep 0 matches. Browser-verified against `node dist/server/entry.mjs` at 375 / 768 / 1280 px.** |
| 2026-09-26 | **The plan was wrong about where file extraction runs, and the code proves it. §2.6 states `unpdf` and `mammoth` "stay server-side so they never enter the browser bundle", while Phase 5.1 simply says "textarea + upload" without saying who parses the file.** Those two cannot both hold if the browser reads the document. So `POST /api/extract` was added as a fifth endpoint: the browser posts base64 bytes, the server parses and returns text. This is not a convenience — reading the file client-side would have pulled **both** heavy parsers into `dist/client/`, which is the one place a leaked key could reach. Verified in the built output: the client bundle is **6.7 KB**, contains no `unpdf`, no `mammoth`, no `pdfjs`, no `GoogleGenAI`, and references only `/api/estimate`, `/api/extract`, `/api/synthesize`. A fifth endpoint is a scope addition and is flagged here rather than absorbed silently. |
| 2026-09-26 | **`dist/client/` now contains JavaScript, and that is correct.** The Phase 4 changelog recorded "no JavaScript at all" as a property of the build. Phase 5 adds a `<script>`, so the current client bundle is one 6.7 KB file. The invariant that actually matters is not "no JavaScript" but "no key, and no server-only library": a search for `AIza` across all of `dist/` returns zero matches, and `GEMINI_API_KEY`, `getSecret`, and `generativelanguage` appear **zero** times under `dist/client/`. The structural §5.5 check in the plan is written as "must contain no JavaScript at all", which will now fail by design — that line is superseded by this entry and should be read as "must contain no key and no server code". |
| 2026-09-26 | **The plan's `3 / 24 chunks` progress readout is not implementable as written, and the panel reports bytes instead.** `synthesize()` assembles the entire WAV before the response is sent, so no chunk ever completes in front of the client — a per-chunk counter would be a number the browser cannot know, i.e. a fabricated progress bar. The panel instead reads the response stream and shows bytes received against `content-length`, with the server's real `x-chunks` shown alongside as a static fact. Genuine progress, honestly labelled. |
| 2026-09-26 | **Two bugs the type checker could not see, both found by driving the real page — the argument for the plan's manual acceptance list.** (a) **Confirm stayed disabled after a successful estimate.** `runEstimate` set `estimatedFor` and painted the numbers but never called `updateGate()`, so the panel showed a price while the button that spends money remained greyed out until the user typed again. `astro check` reported 0 errors on the code that shipped with this bug: the logic was type-correct and behaviourally wrong, and only rendering the panel exposed it. `updateGate()` is now called from every path that mutates `estimatedFor`, so the button and the note cannot disagree. (b) **A stale error alert survived into the next document.** After a failed `.pdf` upload, "scan.pdf could not be read" stayed on screen while the user typed a different document — an error describing a file no longer involved. `scheduleEstimate` now clears it. The general lesson matches the Phase 4 `/img/*` entry: a symptom that outlives the change blamed for it means the diagnosis was wrong. |
| 2026-09-26 | **The cost gate is enforced on the exact string, not on a flag, and that is the whole point of it.** Confirm is enabled only when `estimatedFor === textarea.value.trim()`, and the same comparison runs again inside `generate()`. Browser-verified: typing one extra character disabled Confirm instantly and the re-estimate re-enabled it at 79 characters / $0.0009. So the attack the gate exists to stop — estimate 200 characters, then paste 200 000 and generate — is closed twice, at the button and at the handler. Clearing the box resets the estimate and never dispatches the request, satisfying §5.7's "Empty textarea → estimate not called"; whitespace-only behaves identically. |
| 2026-09-26 | **The audio result path was proven with a stubbed `fetch`, not asserted.** With no `.env` the real endpoint returns 500 and the panel shows the server's own message verbatim — correct, and the reason is legible in the UI. To prove the render path anyway, `window.fetch` was overridden in-page to return a genuine 44-byte RIFF/WAVE header plus 3 seconds of 440 Hz PCM. The `<audio>` element then reported `duration: 3` from real metadata, the blob URL resolved, and the download carried `speech.wav`. This does **not** substitute for a real end-to-end generation, and Phase 7.5 still requires one. Playwright's request-interception layer hung repeatedly on the binary body and had to be abandoned; the `fetch` override tests the same panel code without it. |
| 2026-09-26 | **Two of my own verification claims were wrong before being corrected, recorded because both recurred in earlier phases.** I read `getComputedStyle(...).outline` as `3px none` and nearly reported a missing focus ring; the element simply was not `:focus-visible` at that moment — driven with a real <kbd>Tab</kbd>, the authored rule applies and computes to `2px solid rgb(0, 112, 243)` with 2px offset, which is `--color-link`, exactly as `DESIGN.md` specifies. And the `base64` upload helper was written the naive way first (`String.fromCharCode(...bytes)`), which overflows the argument limit on a multi-megabyte PDF; it walks in 32 KB chunks. A third near-miss: a preallocated receive buffer with a hand-written grow path had a syntax error and a truncation bug, and was replaced with plain chunk collection. Same pattern as the Phase 1 and Phase 4 entries — the tempting implementation is the one that has to be checked against real input sizes. |
| 2026-09-26 | **Phase 4 executed and verified. `src/styles/global.css`, `Layout.astro`, `Hero.astro`, `MicButton.astro`, `LanguageSelect.astro`, `VoiceSelect.astro`; the Astro starter's `Welcome.astro` and `src/assets/` are deleted. Gates: `bun test` 122 pass / 0 fail across 8 files, `bun run build` exit 0 with **zero warnings**, `astro check` 0 errors / 0 warnings / 0 hints over 35 files, live `node dist/server/entry.mjs` 200, §5.5 secret grep 0 matches and no JavaScript in `dist/client/`.** |
| 2026-09-26 | **The nine `/img/*` "didn't resolve" build warnings were never the starter's fault, and deleting `Welcome.astro` did not remove them — that is what identified the real cause.** Tailwind v4 scans source as plain text from the project root, and this repo carries a synced Tailwind documentation snapshot at `.agents/skills/tailwind-4-docs/references/docs/`. Its MDX samples contain literal class names, including ``bg-[url('/what_a_rush.png')]``, ``list-image-[url(/img/checkmark.png)]`` and eight siblings. Tailwind emitted those utilities and warned on each unresolved URL. So the project's own production CSS was carrying classes lifted out of a documentation folder. `global.css` now pins detection with `@import 'tailwindcss' source(none);` plus `@source '../';` — every `.astro` / `.ts` / `.css` file that can hold a class name lives under `src/`. Warnings went 9 → 0. The general lesson matches the Phase 1 method note: a symptom that outlives the change blamed for it is evidence the diagnosis was wrong. |
| 2026-09-26 | **Deviation from §4.1: `:where()` → `:is()` in all three custom variants, and it is a correctness fix, not a style preference.** The plan's snippets use `&:where([data-recording='true'] *)`, and `:where()` contributes **zero** specificity. That makes `recording:bg-ink` and `bg-elevated` both 0,1,0, so the override wins only if Tailwind happens to emit it later in the utilities layer — a property of emission order, not of the class list. The same tie would decide `latin:tracking-[-0.04em]` against the `tracking-normal` base that §2.4 depends on, which is the single ruling most likely to silently regress. `:is()` takes the specificity of its most specific argument (0,1,0 for an attribute or `:lang()`), putting every variant utility at 0,2,x — deterministically above the plain utility it overrides. Selector semantics are unchanged. Verified in the built CSS: `.recording\:bg-ink:is([data-recording=true],[data-recording=true] *){background-color:var(--color-ink)}` and `.latin\:tracking-\[-0\.04em\]:is(:lang(en),:lang(en) *){letter-spacing:-.04em}`. |
| 2026-09-26 | **Deviation from §4.1: the colour block transcribes all 31 `DESIGN.md` colours, not the plan's 17.** The plan's list omits `link-soft`, `error-deep`, `warning-deep`, `magenta`, `violet-soft`, `cyan-soft` and all six `gradient-*-start/end` stops — and §4.2 then requires a hero mesh built from the named tokens. With the plan's subset the mesh can only be assembled from `cyan → violet → pink → warning`, which drops the blue and red/amber ends of the real gradient and contradicts `DESIGN.md`'s "cyan, blue, violet, magenta, amber". Transcribing the full `colors:` map is what "values are copied literally from `DESIGN.md`" actually requires, and it is still transcription, not invention. |
| 2026-09-26 | **Deviation from §4.1: two type tokens added, and three scales deliberately *not* tokenised.** `DESIGN.md` freezes a 48px `display-xl` and a 32px `heading-lg`; v4's frozen defaults have no 48px or 32px step, and the plan itself rejected a bare `text-[48px]` as a fake token, so both are declared as `--text-display-xl` / `--text-heading-lg` with their `DESIGN.md` line heights. Everything else already matches v4 exactly and is *not* re-declared, because a second source of truth for one token is worse than a coincidence: `--spacing: 0.25rem` makes `p-1…p-32` the whole `{spacing.*}` ladder (4→128px), and `text-xs 12/16`, `text-sm 14/20`, `text-xl 20/28`, `text-base 16/24` are literally `body-sm`, `body-md`, `heading-md`, `body-lg`. Radii are tokenised as `app` / `card` / `panel` / `pill` rather than overriding `rounded-sm|md|lg|pill`, because the v4 defaults under those names hold *different* numbers and a silent override would hide the collision instead of surfacing it. Tracking stays a relative `-0.04em` / `-0.02em` utility: −2.4/60, −1.28/32, −0.4/20, −0.28/14 all reduce to one of those two ratios, so the `latin` variant is correct at every step of the scale instead of at one size. Verified in the built CSS that `shadow-whisper` and `text-heading-lg` both generate utilities (v4 emits a theme variable only once something uses it, so an absent variable is expected, not a missing token). |
| 2026-09-26 | **Phase 0's font-binding note is discharged, and it was a real bug, not a pending chore.** Astro emits an `@font-face` only for a `cssVariable` a stylesheet actually references. `Layout.astro` now renders `<Font cssVariable="--font-geist" preload={[400,500,600]} />` and `<Font cssVariable="--font-geist-mono" />`, and `global.css` binds `@theme inline { --font-sans: var(--font-geist); --font-mono: var(--font-geist-mono); }`. Confirmed against a running server, not against the source: the served HTML carries **8** `@font-face` rules and `--font-geist:Geist-…, "… fallback: Arial", Arial, sans-serif` — the `Arial, sans-serif` stack from `DESIGN.md` L40, and the mono equivalent from L64. Before this, both families downloaded, cached, and were never applied. `preload` is limited to the three Geist weights because both faces render above the fold; preloading the mono would compete with them for bandwidth. |
| 2026-09-26 | **Phase 4 note for Phase 5.** `index.astro` renders `Hero` and an empty `<main id="panels">` with **no** placeholder content, and the three primitives are not yet mounted anywhere. That is deliberate — a stub that renders "coming soon" is a state `DESIGN.md` never sanctioned, and the plan puts both panels in Phases 5 and 6. The classes in the unmounted primitives are still compiled, because v4 scans source as plain text rather than the render tree, so `rounded-app` and `rounded-pill` are already in the production CSS. |
| 2026-09-26 | **Phase 2 executed.** `src/lib/gemini/client.ts` (`getSecret` singleton, `ConfigError`, `GeminiError`, and `asGeminiError` mapping 400/401/403/413/429/5xx to plain language with the raw message preserved in `detail`), `languages.ts`, `voices.ts` (all 30 voices across 22 character groups, `Kore` default), `live-token.ts`, `transcribe.ts` (two passes), `prompts/structure.ts`, `synthesize.ts`, `extract/text.ts`, plus `src/types/mammoth.d.ts` (ambient types — `mammoth` ships none). Tests added for the three pure modules. **Gates: `bun test` 77 pass / 0 fail / 4 265 assertions, `bun run build` exit 0, `bun run check` 0 errors / 0 warnings / 0 hints.** The 8 `didn't resolve at build time` warnings are the pre-existing Astro-starter ones, cleared when Phase 4.2 replaces the shell. |
| 2026-09-26 | **§2.1's ephemeral-token UNVERIFIED is now VERIFIED — and the design got simpler.** The body is `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens`, real key in `x-goog-api-key`, body `{ uses, expireTime, newSessionExpireTime, liveConnectConstraints: { model, config } }`; the token returns in `name` (source: Gemini Live API ephemeral-tokens docs, fetched 2026-09-26; shape cross-checked against `CreateAuthTokenConfig` in `@google/genai@2.24.0`). The SDK already wraps this as `client.authTokens.create({ config })`, so **`live-token.ts` calls the SDK instead of hand-rolling `fetch`** — no URL to get wrong and no header to leak. `uses: 1`, with `liveConnectConstraints` scoped to `gemini-3.5-transcribe-live` and a `TEXT`-only `inputAudioTranscription` config. The browser dials `…BidiGenerateContentConstrained?access_token=…`; that is safe only because the value is the short-lived token, and since a browser cannot set an `Authorization: Token` header on a WebSocket, the query parameter is the only option rather than a choice. **The "verify the body before writing client socket code" gate is discharged.** |
| 2026-09-26 | **§2.1's `TranscriptionConfig.mode` UNVERIFIED is now RESOLVED — and the answer is neither form the docs show.** Reading the installed `@google/genai@2.24.0`: the REST field `generation_config.transcription_config` (`mode: "smart"`) exists only on the **Interactions** API, whose input union (`Content_2 \| Step[] \| string`) **cannot express** the `{ type: "audio", uri, mime_type }` shape the transcribe docs use — unusable from the typed SDK without hand-rolled `fetch`. The `generateContent` path instead exposes `GenerateContentConfig.audioTranscriptionConfig`, whose `mode` is the **`AudioTranscriptionConfigMode` enum (`SMART` / `VERBATIM`)**, and whose `languageCodes` field carries the BCP-47 hint. `transcribe.ts` uses that typed field. **One residual risk, stated plainly:** the SDK passes `audioTranscriptionConfig` through to the wire verbatim, so if the backend expects only `transcription_config` on this path, Smart mode is **silently ignored** and the app quietly ships Verbatim output — no error, worse quality. Phase 7 must confirm it: Smart mode auto-formats paragraphs and lists (per the SDK's own docstring) and Verbatim does not, so one recording containing an enumerated list settles it. |
| 2026-09-26 | **Deviation: two guards in `synthesize.ts` that the plan does not specify.** (a) A per-chunk retry, `CHUNK_ATTEMPTS = 2` — the plan says "a mid-job failure retries one chunk rather than the whole document" but never states that a retry exists; 4xx and 429 rethrow immediately, since those will not become a 200. (b) The structure pass falls back to the clean transcript when its output is under 90% of the input length, because a pass that loses content is worse than no pass at all. Both are single named constants, not new scope. |
| 2026-09-26 | **The §5.5 secret grep was vacuous at this point — superseded by the Phase 3 entry below, which re-ran it for real.** `Select-String` across all of `dist/` for `getSecret`, `GEMINI_API_KEY`, and `@google/genai` returned **zero matches**, which looks like a pass but was not one: no route imported these modules until Phase 3, so the bundler had not emitted them at all. |
| 2026-09-26 | **Phase 3 executed and verified. The four endpoints already existed but were unchecked, untested, and carried three real defects — all now fixed.** (a) **`/api/live-token` silently discarded the `language` it validated.** The handler checked `isLanguageId` and then called `mintLiveToken()` with no argument, so a user who selected বাংলা got a Live session that auto-detected anyway: the BCP-47 hint never reached the API. `mintLiveToken` now takes a `LanguageId` and bakes `languageCodes` into the token's `inputAudioTranscription` config (`auto` omits the field, per the documented auto-detect spelling). This was a **silent wrong-behaviour bug, not a crash** — the worst class, because the UI showed a language selection that did nothing on the live path while the batch path honoured it correctly. (b) **`/api/synthesize` hand-rolled its own 400** instead of throwing `BadRequest`, bypassing the shared `failure()` mapper and producing a divergent response shape. Now it throws like every other handler. (c) **`/api/transcribe` returned a `speechDetected` field that was unreachable** — `transcribeClean` throws on an empty transcript, so silence arrived as a 502, never as `speechDetected: false`. Removed rather than left as a field that can never be `false`. **Tests: `src/pages/api/endpoints.test.ts` (26) + `src/lib/api-response.test.ts` (19).** `astro:env/server` is mocked at top level (a `beforeAll` hook runs too late — the module graph loads first) and the three Gemini modules are stubbed, so the handlers are tested directly with a synthetic `Request` and a minimal context. **The suite was mutation-tested: 3 deliberate defects injected, 3 killed** — reverting the language pass-through, removing the data-URL strip, and hardcoding the error status. **Gates: `bun test` 122 pass / 0 fail across 8 files, `bun run build` exit 0, `bun run check` 0 errors / 0 warnings / 0 hints.** Live smoke test against `node dist/server/entry.mjs`: `/api/estimate` 200 with real numbers, malformed JSON 400, unknown language 400 with the plain-language message, and `/api/live-token` 500 naming the missing key with **no stack trace**. |
| 2026-09-26 | **The §5.5 secret grep is now a real gate — the Phase 2 caveat no longer applies.** With the routes built, `dist/server/chunks/` genuinely contains `GEMINI_API_KEY`, `getSecret`, and the Gemini code, so the grep is no longer vacuous. Verified: `GEMINI_API_KEY` appears **only** in `client_BPxk6XwV.mjs` under `dist/server/`, never under `dist/client/`; a search for an `AIza`-prefixed key literal across all of `dist/` returns **zero matches**; and `dist/client/` contains no JavaScript at all (CSS, fonts, and two SVGs only), so there is no client bundle that could carry a key. The hard gate remains 7.4 in Phase 7, re-run against the final build. |
| 2026-09-26 | **`Handler` typing note for whoever writes Phase 5 tests.** Astro types a route as `APIRoute`, whose return is `Response | Promise<Response>`. A test helper typed as `(ctx) => Promise<Response>` fails `astro check` with `ts(2345)` even though every handler is `async`; the helper must accept the union and wrap with `Promise.resolve(...)`. This produced 29 errors and 4 hints on the first run — recorded because the same helper shape will be needed for any future route test. |
| 2026-09-26 | **Phase 2 caught a latent name collision before it could bite.** The spec's `extractText(file: File)` shares its name with `unpdf`'s `extractText`; importing both unqualified made `astro check` fail with 3 errors (`ts(2440)` import conflict plus two cascading). The unpdf import is aliased `extractPdfText`. |
| 2026-09-26 | **Phase 1 executed.** `src/lib/audio/wav.ts` (44-byte canonical RIFF header, odd-length rejection, plus a `wavDurationSeconds` reader), `src/lib/audio/chunk.ts` (paragraph → sentence → clause → word cascade with a hard-break last resort), `src/lib/audio/estimate.ts`. Tests: `wav.test.ts`, `chunk.test.ts`, `estimate.test.ts`. **Gates: `bun test` 50 pass / 0 fail / 4 119 assertions, `bun run build` exit 0, `bun run check` 0 errors / 0 warnings / 0 hints.** |
| 2026-09-26 | **Green tests were not sufficient evidence; the suite was mutation-tested.** 10 deliberate defects were injected into `chunk.ts` and the suite re-run in an isolated subprocess per mutant. **First pass: 3 of 10 mutants survived**, so the suite was not proving what it appeared to prove. Three real test gaps were found and closed: (a) budget tests asserted against the *imported* `MAX_CHARS`, so halving the constant silently redefined the expectation and passed — now hard-coded to 24 000 with a per-script ceiling test; (b) the khanda-ta guard asserted on chunk *endings*, but the U+09CE mutation changes split *positions* while producing identical endings when the letter is word-final — now guarded by a direct assertion on the exported `SENTENCE_TERMINATORS` code points; (c) the word-split test used `'word '`, and 24 000 happens to divide evenly by 5, so a mid-word `hardBreak` was indistinguishable from a correct word split — now uses a 7-character word, which 24 000 does not divide. **Final: 10 of 10 mutants killed, baseline green.** One earlier test was also tautological (asserting every chunk contains every 5-character substring of the input) and was replaced with two that can fail. |
| 2026-09-26 | **Method note for later phases.** Two of my own verification scripts produced false conclusions before being caught: an in-process mutant harness returned four identical results because bun cached the module across dynamic imports (fixed with one subprocess per mutant), and an equivalence probe compared only chunk *counts* rather than word integrity, wrongly reporting a mid-word-cutting mutant as "equivalent". Both are recorded because the same trap will recur in Phase 2 when the Gemini layer first becomes mockable. Prefer a subprocess per mutant, and assert on the invariant rather than on a summary statistic. |
| 2026-09-26 | **Plan defect found and fixed: the plan's Bengali terminator was a letter, not a terminator.** §1.2 specified `ৎ` as a Bengali sentence terminator. A codepoint dump of the implemented file shows that glyph is **U+09CE BENGALI LETTER KHANDA TA** — a letter. Splitting on it would cut mid-word and corrupt every Bengali chunk boundary. The real Bengali terminators are **U+09F3 BENGALI QUESTION SIGN** and **U+09F7 BENGALI QUARTER NOTE**; Bengali shares the Devanagari danda **U+0964 / U+0965**. `chunk.ts` now assembles the terminator set with `String.fromCodePoint(0x2e, 0x21, 0x3f, 0x964, 0x965, 0x9f3, 0x9f7)` so no editor or codepath can mistype or normalise a glyph again. §1.2 has been corrected to match. A dedicated test asserts khanda-ta never triggers a split. **No behaviour was shipped on the wrong value.** |
| 2026-09-26 | **§2.3 risk #2 upgraded from predicted to measured.** An ASCII-only splitter was run against both Indic scripts: **1 chunk of 60 016 chars (Bengali)** and **1 chunk of 60 021 chars (Devanagari)** against the 24 000 budget — a 2.5× overshoot that would have been truncated by the model, exactly as the plan feared. The script-aware splitter splits the same input correctly. Four regression tests cover Bengali danda, Devanagari danda, Bengali question sign, and Bengali quarter note. |
| 2026-09-26 | **§2.1 audio-token ratio now VERIFIED.** The Gemini API pricing page and the Cloud Text-to-Speech pricing page both state **25 audio output tokens per second of audio** (fetched 2026-09-26). The 32 tok/s figure in older community answers applies to earlier preview TTS models and is **not** used. `AUDIO_TOKENS_PER_SECOND = 25` makes the cost estimate arithmetic rather than guesswork. Cost is now `output = seconds × 25 × $6/M` plus `input = chars/4 × $0.50/M`. |
| 2026-09-26 | **Cost reality check.** At 14 chars/second and $6/M output, the §5.7 stress case of a **200 KB document prices at ~$2.17** for ~4 hours of audio, and a 1 349-character paragraph at well under $0.05. The plan's assumption that bulk work is cheap does not hold; the estimate-then-confirm gate in Phase 5 earns its keep. Both figures are pinned by tests so a future change to the constants cannot silently change the price. |
| 2026-09-26 | **Deviation from the plan's claim that no dependency would be added.** §0.1 stated "no test framework dependency is added", which held — `bun test` is the runner and is still built in — but `bun:test` **has no type declarations**, so `astro check` failed with 3 × `ts(2307)`. Added `@types/bun@^1.4.2` as a **devDependency**: types only, zero runtime, not a test framework. `bun.lock` regenerated with the documented `C:` workaround and the previous lockfile backed up. |
| 2026-09-26 | **Open gap for Phase 5, not fixed here.** §5.7 expects emoji-only or letter-free input to make the chunker return `[]`. It does not: `chunkText('🎵')` returns `['🎵']`, because the chunker measures characters and has no notion of a speakable letter. Rejecting it needs a script-detection heuristic that is **not** specified anywhere in the plan, so inventing one here would be a silent scope change. Left as-is and flagged: either the plan's §5.7 row is corrected, or Phase 5.2 adds an explicit "no speakable text" check before calling `/api/estimate`. |
| 2026-09-26 | **`CHARS_PER_SECOND = 14` remains uncalibrated.** Unchanged from the plan and still the only unverified number in the estimator. `estimateText` returns `calibrated: false` so the UI is forced to label the figure "estimated". Phase 7.5 remains the task that closes it. |
| 2026-09-26 | **§2.4 resolved by the user.** Conflict A → tight tracking is Latin-only, via a new `latin` custom variant; `letter-spacing: normal` for `bn`/`hi`. Conflict B → no third font face; browser system fallback supplies Indic glyphs. Phase 4.1 unblocked. Header caution, §2.3 risk row, §5.1 execution order, and the exit gate updated to match. No design token added. |
| 2026-09-26 | **Phase 0 executed.** Installed `@astrojs/node@11.1.6`, `@google/genai@2.24.0` (pinned `^2.24.0`, below 3.0.0), `unpdf@1.8.1`, `mammoth@1.12.3`; `bun.lock` regenerated on `C:` and copied in per the `AGENTS.md` workaround. `.gitignore` hardened to `.env` / `.env.*` / `!.env.example` — verified with `git check-ignore` that `.env.local`, `.env.development`, `.env.production`, `.env.staging` are now ignored while `.env.example` stays tracked. `.env.example` added; **`.env` deliberately not created — the user fills it in.** `astro.config.mjs` set to `output: 'server'` with the node standalone adapter and the two Fonts API families. `src/env.d.ts` added with `GEMINI_API_KEY` typed optional. **Gates: `bun run build` exit 0, `npx astro check` 0 errors / 0 warnings / 0 hints, standalone `node dist/server/entry.mjs` serves HTTP 200 with a clean stderr, `bun run preview` still works. `bun test` reports 0 test files — expected, Phase 1.4 creates them.** |
| 2026-09-26 | **Deviation from the plan's literal 0.3 snippet, flagged for approval.** The plan's `fonts` entries omitted `fallbacks`, but Astro's default is only `["sans-serif"]` — which would have silently dropped the `Arial` fallback `DESIGN.md` L40 specifies, and all four mono fallbacks from L64. Both entries now transcribe the real `DESIGN.md` stacks. No new token; this restores fidelity to the frozen design system rather than inventing anything. Related: Astro's `fallbacks` also drive `optimizedFallbacks` metric-matching, which only covers Latin — the §2.4 Conflict B ruling still governs Indic glyphs via browser system fallback, unchanged. |
| 2026-09-26 | **Phase 0 note carried into Phase 4.** Both font families download and cache correctly (Geist 400/500/600, Geist Mono 500 — confirmed in the unifont cache), but **no `@font-face` is emitted yet** because no stylesheet references `--font-geist` / `--font-geist-mono`. Astro only emits declarations for fonts actually used. Phase 4.1 must wire the typography tokens to these variables or the fonts are downloaded and never applied. The 8 `didn't resolve at build time` build warnings come from the Astro starter `Welcome.astro` and are cleared when Phase 4.2 replaces the shell. |
