Status: Approved (design) — awaiting written-spec review
Doc-Type: Full (architectural design spec; implementation plan to follow)

# GeminiTTS — Design Spec

<!-- desc: Architectural design spec for the single-page Gemini-backed TTS app. Approved 2026-09-26. -->

A single-page Astro application providing two speech capabilities backed by the Gemini API:

1. **Speech → Text** — tap the mic (or press <kbd>Space</kbd>) to record; a live draft transcript streams in while speaking; on stop, a professionally filtered and structured transcript is produced and copied to the clipboard.
2. **Text / File → Speech** — paste text or upload a file, see the estimated audio duration and cost, confirm, and download a single seamless `.wav`.

---

## 1. Objectives & Success Criteria

### 1.1 Purpose

A fast, private, single-surface tool for turning voice into clean writing and writing into voice. It replaces two separate workflows (a dictation tool and a TTS tool) with one page that shares one design language and one API key.

### 1.2 Success criteria

| # | Criterion | How it is verified |
|---|---|---|
| SC1 | Recording starts and stops via mic button **and** <kbd>Space</kbd> | Manual: both paths, plus typing Space inside the text area must not trigger recording |
| SC2 | A live draft transcript appears while speaking | Manual: speak, observe interim text updating |
| SC3 | On stop, a final transcript arrives with fillers removed, self-corrections resolved, numbers/dates/currency normalized | Manual: speak a sentence containing "um", a self-correction, and "twenty six million dollars" |
| SC4 | The final transcript is structured (paragraphs, headings, lists) without altering wording | Manual: read the "Show raw transcript" disclosure and diff |
| SC5 | The final transcript reaches the clipboard automatically | Manual: paste into a text editor immediately after stop |
| SC6 | If clipboard access is refused, a visible Copy control is offered and nothing falsely claims success | Manual: deny clipboard permission, re-test |
| SC7 | Text/file input produces a downloadable `.wav` that plays end-to-end without clicks, gaps, or truncation | Manual: play a 3+ chunk generation in full |
| SC8 | Duration and cost are shown **before** generation begins | Manual: observe estimate panel on paste/upload |
| SC9 | English, বাংলা, and हिन्दी each work in both directions, plus Auto | Manual: record and synthesize in all three |
| SC10 | The Gemini API key never appears in any client-delivered asset | Manual + `grep` the build output for the key value |
| SC11 | `bun run build` completes with zero errors | Command output |
| SC12 | `npx astro check` reports zero type errors | Command output |

### 1.3 Scope

**In scope**

- One page containing both panels.
- Microphone-only audio input for Speech → Text.
- Text paste box and file upload (`.txt`, `.md`, `.pdf`, `.docx`) for Text → Speech.
- Three languages plus Auto, for both directions.
- All 30 prebuilt Gemini TTS voices, grouped by character.
- WAV output with preview and download.
- Duration and cost estimation prior to generation.
- `.env` / `.env.example` / `.gitignore` secret hygiene.

**Out of scope**

- Audio file upload as an input to Speech → Text (mic only, by decision).
- MP3 or any compressed output format (WAV only, by decision).
- Multi-speaker / dialogue synthesis.
- Speaker diarization, word-level timestamps, custom vocabulary.
- User accounts, history, persistence, or any database.
- Deployment to a hosting platform.
- Editing or regenerating audio with a different voice after the fact.

### 1.4 Deliverables

A working page, four API endpoints, a set of pure library modules, unit tests for those modules, and a verified build.

---

## 2. Expert Analysis

### 2.1 Evidence table

| Claim | Status | Source |
|---|---|---|
| `gemini-3.8-flash-lite-tts` exists, is GA, Text-in/Audio-out, $0.50/M input and $6.00/M output, released 2026-09-23, positioned as direct replacement for `gemini-3.1-flash-tts-preview` | VERIFIED | Google AI Studio model picker, user-supplied screenshot; Gemini API release notes 2026-09-22 |
| `gemini-3.8-flash-lite-tts` supports 100+ languages and **auto-detects input language** | VERIFIED | Gemini API speech-generation docs, fetched 2026-09-26 |
| TTS supported languages include English (`en`), Bangla (`bn`), Hindi (`hi`) | VERIFIED | Gemini API speech-generation docs, fetched 2026-09-26 |
| Gemini API TTS output is headerless raw PCM, s16le, mono, 24 000 Hz | VERIFIED | Gemini API speech-generation docs; `ffmpeg -f s16le -ar 24000 -ac 1` documented conversion |
| TTS models accept text only, produce audio only; context window 32k tokens | VERIFIED | Gemini API speech-generation docs, fetched 2026-09-26 |
| Older TTS models (`gemini-2.5-*-tts`) had an 8,192-token input limit | VERIFIED | Gemini API model pages, fetched 2026-09-26 |
| `gemini-3.8-flash` is a current general text model suitable for the low-cost structure pass | VERIFIED | Gemini API models listing, fetched 2026-09-26 |
| Per-request **input** token ceiling for `gemini-3.8-flash-lite-tts` | **UNVERIFIED** | Not published. `CHUNK_TOKEN_BUDGET` is set conservatively to 6,000 — inside both documented limits — rather than against a confirmed figure |
| 30 prebuilt voices with character descriptors (Zephyr/Bright, Kore/Firm, Sulafat/Warm, Sadaltager/Knowledgeable, Charon/Informative, …) | VERIFIED | Gemini Live API voice/voice-config docs, fetched 2026-09-26 |
| `gemini-3.5-transcribe` is the speech-to-text model; auto-detects 85+ languages; `language_codes` accepts BCP-47 hints; omit or `[]` for auto-detect | VERIFIED | Gemini API transcribe docs + model card, fetched 2026-09-26 |
| Transcribe "Smart" mode performs filler-word removal, self-correction resolution, and intent-aware alphanumeric formatting | VERIFIED | Gemini 3.5 Transcribe model card, fetched 2026-09-26 |
| Transcribe accepts `audio/webm` (MediaRecorder's native output) | VERIFIED | Gemini API transcribe docs — supported MIME list includes WebM and Opus |
| Inline audio requests are capped at 20 MB total request size | VERIFIED | Gemini API audio understanding docs, fetched 2026-09-26 |
| Unary Transcribe handles up to 1 hour of audio per request | VERIFIED | Gemini 3.5 Transcribe model card, fetched 2026-09-26 |
| `gemini-3.5-transcribe-live` streams interim and finalized transcription over WebSocket via the Live API (`responseModalities: [TEXT]`, `inputAudioTranscription`) | VERIFIED | Gemini Live API live-transcribe docs, fetched 2026-09-26 |
| Live API audio input format is raw PCM s16le, 16 kHz, little-endian | VERIFIED | Gemini Live API WebSocket docs, fetched 2026-09-26 |
| Live API auth normally places the API key in the WebSocket URL query string; **ephemeral tokens** are the documented alternative for client applications, via `POST /v1beta/auth_tokens` with `liveConnectConstraints`, connecting to `…BidiGenerateContentConstrained?access_token=…` | VERIFIED | Gemini Live API get-started-websocket + live-transcribe docs, fetched 2026-09-26 |
| Astro API routes are `Request → Response` and provide **no** WebSocket upgrade | VERIFIED | Astro docs — Endpoints / On-demand rendering, fetched 2026-09-26 |
| Server endpoints require an adapter; `@astrojs/node` v11.1.6 supports `mode: 'standalone'`; `output: 'server'` server-renders all pages by default | VERIFIED | Astro docs — On-demand rendering, @astrojs/node integration, fetched 2026-09-26 |
| `astro:env` `getSecret()` reads a raw secret without schema validation; schema-declared secrets are validated at build time, which would break a fresh clone | VERIFIED | Astro docs — Environment variables / astro:env reference, fetched 2026-09-26 |
| Only `PUBLIC_`-prefixed env vars reach client code | VERIFIED | Astro docs — Environment variables, fetched 2026-09-26 |
| `@google/genai` is the current Node SDK; v2.x is current, v3.0.0 will require Node 22+ | VERIFIED | npm `@google/genai`, fetched 2026-09-26 |
| The Gemini **Interactions API** is the recommended interface as of June 2026; `generateContent` is legacy | VERIFIED | Gemini API docs landing page, fetched 2026-09-26 |
| Exact request/response body schema for minting an ephemeral token bound to `gemini-3.5-transcribe-live` | **UNVERIFIED** | Endpoint and pattern confirmed; exact body to be validated against docs during implementation |
| Audio-output-token → seconds conversion (needed for cost estimation) | **UNVERIFIED** | Not published. Estimate will be empirically calibrated |
| Exact runtime shape of `TranscriptionConfig.mode` (`"smart"` as a bare enum string vs. `{ type: "smart" }`) | **UNVERIFIED** | Docs show both forms in different contexts; to be confirmed against the SDK types during implementation |
| Whether `gemini-3.8-flash-lite-tts` supports streaming output | **UNVERIFIED** | Docs state streaming began with 3.1; model is newer. Non-blocking — design chunks regardless |

### 2.2 Quantified trade-offs

| Dimension | Chosen | Rejected | Rationale |
|---|---|---|---|
| Secret exposure | Ephemeral token, server-minted | Browser → Gemini WS with real API key | The real key in a client-visible URL is a full compromise. Ephemeral tokens are short-lived and scope-limited. |
| Server topology | Single Astro process; browser dials Google directly | Sidecar WebSocket proxy | A proxy adds IP masking and request logging only — no value for a local single-user tool — while adding a second process, a second port, and CORS surface. |
| Output format | WAV (header prepended in-process) | MP3 via `lamejs`; MP3 via `ffmpeg` | `lamejs` is a browser-oriented library run server-side; pure-JS encoding is CPU-bound and degrades on long text. `ffmpeg` adds a system binary that breaks clone-and-run. WAV needs zero dependencies and is instant. |
| Long-text strategy | Chunk at sentence boundaries, byte-concatenate PCM, write one header | Per-chunk encode then join; stream to client progressively | Raw PCM concatenation is lossless and free. It also makes the 32k context ceiling a non-event rather than a hard failure mode. |
| Transcript quality | Two passes: Transcribe Smart, then a Flash structure pass | Transcribe Smart alone | Smart mode normalizes and de-fills but does not produce Typeless-grade document structure. A text-only Flash pass is a fraction of a cent and supplies headings/lists/paragraphing. Mitigated by exposing the raw transcript for diffing. |
| Cost control | Mandatory estimate-and-confirm before generation | Generate immediately | TTS output is $6.00/M audio tokens — 400× the input rate. A "no ceiling" job is a real bill. The confirm step is the control, so it is mandatory, not optional. |
| Cost concentration | `flash-lite-tts` for all synthesis | `3.8-flash-tts` for quality | The user selected cost efficiency. Documented as a quality trade-off: flash-lite is a dubbing/localization/high-throughput model, not the studio-grade expressive one. |

### 2.3 Pre-mortem

| Failure | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ephemeral token schema differs from expectation | Medium | Live draft feature breaks | Isolated in one module (`src/lib/gemini/live-token.ts`). Batch path is independent and still works. Fallback is the sidecar proxy, which will be surfaced to the user rather than silently substituted. |
| `MediaRecorder` produces a MIME the Transcribe endpoint rejects | Low–Medium | Batch transcription fails after a successful recording | Negotiate the MIME via `MediaRecorder.isTypeSupported` against a known-good list; fall back to `audio/webm`. Verified that WebM/Opus is in the supported set. |
| Long-text chunking splits a sentence mid-clause, producing audible seams | Medium | Audible artifacts at chunk boundaries | Split only at sentence/paragraph terminators; if a single sentence exceeds the chunk budget, fall back to clause boundaries; never split on whitespace mid-word. |
| Cost estimate is badly wrong | Medium | User surprised by bill | Label the figure "estimated" in the UI; calibrate the constant against a real generation during implementation; show the estimate before any API call is made. |
| Clipboard write silently fails | Medium | SC5 appears to pass but does not | Attempt the write, verify it, and fall back to a prominent Copy control. Never display "Copied" unless the write resolved. |
| Space shortcut fires while the user is typing | Medium | Annoying; can destroy a half-written transcript | Ignore the event when the active element is an `input`, `textarea`, or `contenteditable`; ignore `event.repeat`. |
| AudioWorklet unavailable in the user's browser | Low | No live draft | Feature-detect; degrade to batch-only with a quiet notice. |
| Microphone unavailable because the page is served over plain HTTP | Low (localhost) | Nothing records | Detect and surface a clear, specific message. Document the HTTPS requirement for any non-localhost deployment. |
| `bun install` fails on this drive (known environment quirk in `AGENTS.md`) | High | Cannot install `@google/genai` | Use the documented `bun install --no-save` workaround, then generate `bun.lock` on `C:` and copy it in. |
| Secret leaks into the client bundle | Low | Key compromise | Key is read only via `getSecret()` inside server modules. Verify by grepping `dist/` for the key value as part of SC10. |
| Astro's default HTML streaming causes a hydration mismatch | Low | Console warning; possible flicker | Keep interactivity in framework-free vanilla scripts within Astro components; verify a clean console during review. |

---

## 3. Design

### 3.1 Architecture

```
BROWSER                                  ASTRO (Node standalone)              GOOGLE
────────                                 ───────────────────────              ──────
SPEECH → TEXT
 AudioWorklet ──PCM 16k──► wss:// ────────────────────────────────────────────► Live API
 mic            ◄──interim + finalized text────────────────────────────────  gemini-3.5-transcribe-live
                   (ephemeral token)                  ▲
                                                     │
 POST /api/live-token ──────────────────────────────┘   (real key never leaves the server)
       │
 on stop ──POST /api/transcribe──► /api/transcribe ──► gemini-3.5-transcribe  (Smart mode)
 (webm blob)   ◄──── { raw, structured } ────┘         │
                                                  └──► gemini-3.8-flash  (structure pass)
       ◄── final text ──► auto-copy to clipboard

TEXT / FILE → SPEECH
 paste or upload ──POST /api/estimate──► /api/estimate   (local math; no Gemini call)
 confirm ──────────POST /api/synthesize► /api/synthesize ──► gemini-3.8-flash-lite-tts × N
                                             chunk loop → PCM concat → one WAV header
       ◄── audio/wav ──► <audio> preview + download
```

### 3.2 Endpoints

| Method | Path | Purpose | Calls Gemini |
|---|---|---|---|
| `POST` | `/api/live-token` | Mint an ephemeral token scoped to `gemini-3.5-transcribe-live` | Yes (auth only) |
| `POST` | `/api/transcribe` | Batch-transcribe a recorded webm blob, then restructure | Yes (2 calls) |
| `POST` | `/api/estimate` | Estimated duration + cost for a given text | No |
| `POST` | `/api/synthesize` | Chunked synthesis, returns `audio/wav` | Yes (N calls) |

All four are server endpoints under `output: 'server'`. The secret is read only in these handlers and in `src/lib/gemini/*`, always via `getSecret('GEMINI_API_KEY')` from `astro:env/server`. Using `getSecret` rather than a schema-declared `envField.string({ access: 'secret' })` is deliberate: schema-declared secrets are validated at build time, which would fail `bun run build` on a fresh clone before the user has created `.env`.

### 3.3 The two-pass transcription

1. **Clean pass** — `gemini-3.5-transcribe` in Smart mode. Produces filler-free text with self-corrections resolved and numbers, dates, and currency normalized. BCP-47 `language_codes` is populated from the selected language, or left empty for Auto.
2. **Structure pass** — `gemini-3.8-flash`. Receives only the clean text. Its instruction is explicit that it may **only** add document structure — paragraph breaks, headings where the speaker implied them, bullet lists for enumerated speech, code blocks for dictated code — and must not add, remove, or reword any content. Output is Markdown.

The structure pass is toggleable in the UI and defaults to on. The raw Smart-mode output is always retained and exposed behind a "Show raw transcript" disclosure so the effect of the second pass is auditable rather than opaque.

### 3.4 WAV assembly

Gemini returns headerless PCM: signed 16-bit little-endian, mono, 24 000 Hz. `src/lib/audio/wav.ts` prepends a standard 44-byte RIFF/WAVE header to produce a playable file.

For long input the text is split at sentence boundaries by `src/lib/audio/chunk.ts`, each chunk is synthesized separately, and the resulting PCM buffers are concatenated byte-wise before a single header is written. Because raw PCM has no inter-frame dependencies, this is mathematically lossless and produces no audible seam. This is the specific reason WAV was chosen over MP3: with MP3, concatenation requires bitrate- and frame-alignment care and re-encoding.

`CHUNK_TOKEN_BUDGET` is a named constant in `src/lib/audio/chunk.ts`. The documented TTS context window is 32k tokens per session, and the older TTS models carried an 8,192-token input limit; the exact per-request input ceiling for `gemini-3.8-flash-lite-tts` is not published. The budget is therefore set to a deliberately conservative **6,000 tokens** — comfortably inside the smaller of the two documented limits, leaving headroom for the style instruction and the prompt wrapper. It is a single constant, so revising it after measurement is a one-line change.

### 3.5 Client audio capture

Two distinct capture paths, because the two Gemini endpoints accept different formats:

- **Live path** — an `AudioWorklet` emits raw PCM s16le at 16 kHz, which is what the Live API requires. AudioContext resampling handles the conversion. Output is streamed to Google over the Live WebSocket.
- **Batch path** — `MediaRecorder` captures the same session as a compressed webm/opus blob, which the Transcribe endpoint accepts. MIME type is negotiated via `MediaRecorder.isTypeSupported` against a preference list.

Both are fed from the same `getUserMedia` stream and run concurrently for the duration of the recording.

### 3.6 Languages

| Option | Label | BCP-47 sent to Transcribe | TTS behaviour |
|---|---|---|---|
| `auto` | Auto-detect | *(omitted — model auto-detects)* | Model auto-detects input language |
| `en` | English | `en-US` | Auto-detected |
| `bn` | বাংলা | `bn-BD` | Auto-detected |
| `hi` | हिन्दी | `hi-IN` | Auto-detected |

One selector serves both panels. The Gemini TTS models auto-detect input language, so the selection is a hint for transcription accuracy rather than a hard constraint on synthesis.

### 3.7 Voices

All 30 prebuilt voices are offered, grouped in the dropdown by Google's own character descriptors — for example *Bright* (Zephyr, Autonoe, Laomedeia), *Firm* (Kore, Orus, Alnilam), *Warm* (Sulafat), *Knowledgeable* (Sadaltager), *Informative* (Charon), *Gentle* (Vindemiatrix). Grouping by character rather than Latin name makes the list navigable.

The default voice is **Kore** (*Firm*), selected for the professional register the brief calls for and applied uniformly across all languages. Voices are not language-scoped in Gemini TTS — the same 30 are available for every supported language — so the default is deliberately language-independent rather than a per-language mapping. The synthesise request may also carry a short style instruction, which is how the professional register is reinforced in the output itself rather than relied upon from the voice choice alone.

### 3.8 Interface

`DESIGN.md` is the sole source of truth. No new tokens are introduced.

**Surfaces** — canvas `#fafafa`; cards and inputs `#ffffff`; every card, input, and divider defined by a 1px `#ebebeb` hairline before any shadow; depth limited to the Level-1 whisper shadow `0px 1px 1px rgba(0,0,0,0.04)`.

**Text ladder** — ink `#171717` for headings, body `#4d4d4d`, mute `#8f8f8f`, faint `#a1a1a1` for placeholders and disabled labels. Pure black is not used.

**Type** — Geist Sans at weight 600 for headings with the documented negative tracking (−2.4px at the 48px hero, −1.28px at 32px section, −0.4px at 20px). Geist Mono, uppercase, 12px/500, used only for the section eyebrows: `SPEECH → TEXT` and `TEXT → SPEECH`. Weights are binary — 600 headings, 500 labels and buttons, 400 body. No italic anywhere.

**Buttons** — the two shapes are never mixed within a context. The mic control is a circular `button-icon-circular` (full radius, hairline border) that inverts to an ink fill with a pulsing ring while recording. Panel controls are 6px `button-primary-sm` / `button-ghost-sm` squares. The only 100px pill on the page is the hero call-to-action.

**Hero** — the multi-stop mesh gradient (cyan → blue → violet → magenta → amber) appears here and nowhere else. This is the single decorative system in the design language and introducing a second one is explicitly forbidden.

**Semantic** — focus rings and active state in `#0070f3`; errors `#ee0000`; warnings `#f5a623`; warnings may use the `#ffefcf` soft fill.

**Layout** — 2-up card grid, collapsing to a single column at ≤640px per the documented breakpoint table. Touch targets clear 44px.

**States** — each panel defines idle, recording, processing, success, and error. Errors render as an inline hairline-bordered alert with a plain-language message, an optional collapsible technical detail, and a retry control. No silent failures.

**Keyboard** — <kbd>Space</kbd> toggles recording. The handler ignores the event when `document.activeElement` is an `input`, `textarea`, `select`, or `contenteditable`, and ignores `event.repeat`, so holding the key cannot retrigger. `preventDefault` suppresses page scroll on the recording surface only.

### 3.9 Clipboard

On arrival of the final transcript the app attempts `navigator.clipboard.writeText`. The UI reflects the true outcome: on success a "Copied" confirmation appears; on failure or rejection a prominent **Copy** button is shown instead. The app never displays a success state it has not observed.

### 3.10 File layout

```
.env                                          [NEW]   real key — git-ignored
.env.example                                  [NEW]   committed template
.gitignore                                    [MOD]   .env* with !.env.example
astro.config.mjs                              [MOD]   output: 'server' + @astrojs/node standalone
src/env.d.ts                                  [NEW]   ImportMetaEnv typing
src/lib/gemini/languages.ts                   [NEW]   language table + BCP-47 codes
src/lib/gemini/voices.ts                      [NEW]   30 voices grouped by character
src/lib/gemini/live-token.ts                  [NEW]   ephemeral token minting
src/lib/gemini/transcribe.ts                  [NEW]   clean pass + structure pass
src/lib/gemini/synthesize.ts                  [NEW]   chunk loop + PCM concatenation
src/lib/audio/wav.ts                          [NEW]   44-byte RIFF header read/write
src/lib/audio/chunk.ts                        [NEW]   sentence-boundary chunker
src/lib/audio/estimate.ts                     [NEW]   duration + cost estimation
src/lib/extract/text.ts                       [NEW]   txt / md / pdf / docx to plain text
src/lib/prompts/structure.ts                  [NEW]   structure-pass instruction
src/pages/api/live-token.ts                   [NEW]
src/pages/api/transcribe.ts                   [NEW]
src/pages/api/estimate.ts                     [NEW]
src/pages/api/synthesize.ts                   [NEW]
src/components/Hero.astro                     [NEW]
src/components/SttPanel.astro                [NEW]
src/components/TtsPanel.astro                [NEW]
src/components/LanguageSelect.astro           [NEW]
src/components/VoiceSelect.astro             [NEW]
src/components/MicButton.astro                [NEW]
src/components/TranscriptView.astro          [NEW]
src/components/AudioResult.astro             [NEW]
src/pages/index.astro                         [MOD]
src/styles/global.css                         [MOD]   @theme tokens from DESIGN.md
```

Every module under `src/lib/` is a pure function with no dependency on Astro, the DOM, or the network. That constraint is what makes them unit-testable and is the reason the logic is split out of the route handlers rather than inlined.

### 3.11 Dependencies added

| Package | Purpose | Notes |
|---|---|---|
| `@astrojs/node` | Server adapter, `standalone` mode | Required for any server endpoint |
| `@google/genai` | Gemini SDK | Current 2.x. Pin below 3.0.0 — 3.0.0 raises the Node floor to 22+ |
| `unpdf` | Server-side PDF text extraction | Keeps the parser off the client |
| `mammoth` | Server-side `.docx` extraction | Same rationale |

`.txt` and `.md` are read directly by the browser with no dependency. No audio encoder is required. No test framework is required — `bun test` is built in.

### 3.12 Error handling

| Case | Behaviour |
|---|---|
| Microphone permission denied | Inline message naming the cause; the page remains otherwise usable |
| Page served over plain HTTP on a non-localhost origin | Detected up front with a specific message, since microphone access requires a secure context |
| Live socket drops mid-recording | Degrade to batch-only without interrupting the user; recording continues and the final transcript is still produced on stop |
| Ephemeral token mint fails | Live draft disabled with a quiet notice; batch transcription unaffected |
| `MediaRecorder` MIME negotiation fails | Fall back through the preference list to `audio/webm` |
| Clipboard write rejected | Show the Copy control; show no success state |
| Transcript is empty (silence) | Explicit "No speech detected" rather than an empty box |
| Text exceeds the chunk budget | Chunked automatically with a progress indicator and a cancel control |
| Gemini returns 4xx / 429 / 5xx | Mapped to plain language; the raw error is available in a collapsible detail |
| `GEMINI_API_KEY` absent or empty | A single setup panel naming the exact file to create and the variable to set |
| Unknown unhandled failure | Generic hairline-bordered alert; the technical detail is logged and surfaced, never swallowed |

---

## 4. Verification Strategy

### 4.1 Automated

`bun test` — built into bun, so **no test framework dependency is added**. Coverage targets the pure modules only:

- `wav.ts` — header field values and byte layout; round-trip of a known PCM buffer; correct total length for multi-chunk concatenation.
- `chunk.ts` — never splits mid-word; respects the `CHUNK_TOKEN_BUDGET` constant; preserves ordering; handles a single sentence exceeding the budget; handles empty and whitespace-only input.
- `estimate.ts` — duration and cost arithmetic; monotonicity (more text never yields less time).
- `extract/text.ts` — each supported format yields expected plain text.
- `languages.ts` / `voices.ts` — referential integrity of BCP-47 codes and voice groupings.

### 4.2 Build gates

```
bun run build          # must complete with zero errors
npx astro check        # must report zero type errors
```

### 4.3 Secret-safety gate

Grep the build output for the literal API key value and confirm zero matches. This is the mechanical check behind SC10.

### 4.4 Manual acceptance

- Both panels, in all four language modes (Auto / English / বাংলা / हিন्दी).
- Both recording triggers, plus the negative case of typing Space inside the text area.
- Live draft appearing during speech.
- Clipboard auto-copy, and the denied-permission fallback.
- Raw-vs-structured transcript diff, to confirm no wording changed.
- A multi-chunk synthesis played end to end for clicks, gaps, and truncation.
- Duration and cost figures compared against an actual generation, to calibrate the estimate.
- Keyboard-only traversal of the whole page; visible focus at every stop.
- Verified at 375px, 768px, and 1280px widths.
- Browser console free of errors and hydration warnings.

---

## 5. Risks Carried Into Implementation

| Risk | Disposition |
|---|---|
| Ephemeral token body schema unconfirmed | Validate against live docs first. Contained to one module. Sidecar proxy is the fallback and will be raised with the user rather than substituted silently |
| `TranscriptionConfig.mode` runtime shape unconfirmed | Confirm against SDK types; both documented forms are prepared for |
| Audio-token-to-seconds ratio unpublished | Calibrate empirically against a real generation; label all figures "estimated" |
| Duration estimate may be wrong for short inputs | The confirm step exists precisely so the user decides with full information |
| Flash-lite TTS is a dubbing model, not the flagship expressive one | Accepted trade for cost; documented in §2.2. Voice quality is auditionable across all 30 options |
| `bun install` fails on this drive | Documented workaround in `AGENTS.md`: `bun install --no-save`, then generate the lockfile on `C:` and copy it in |
| Per-request input ceiling for `gemini-3.8-flash-lite-tts` is unpublished | `CHUNK_TOKEN_BUDGET` is fixed conservatively at 6,000 tokens — inside the smaller of the two documented limits (8,192 and 32k) — and is a single named constant, so correcting it after measurement is a one-line change |

---

## 6. Out of Scope for Future Consideration

Recorded so they are not re-litigated during implementation:

- Compressed output formats (MP3 / Opus) behind a format toggle.
- Audio file upload as an input to Speech → Text.
- Multi-speaker dialogue synthesis.
- A second-pass duration or cost model driven by actual token counts rather than a calibrated constant.
- Server-side job queue for very long synthesis jobs.
