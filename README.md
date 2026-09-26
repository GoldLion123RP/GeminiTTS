# GeminiTTS

An Astro + Tailwind CSS v4 front end for GeminiTTS, built on the Geist design system.

> **Status: `alpha`.** Both tools are built, each on its own route
> (`/speech-to-text` and `/text-to-speech`), behind a landing page at `/`, and
> served from the Astro node adapter. **Speech → Text** records from the
> microphone over two
> concurrent paths — an `AudioWorklet` streaming 16 kHz PCM to the Gemini Live
> API for a provisional draft, and a `MediaRecorder` webm blob that becomes the
> authoritative cleaned and structured transcript on stop. **Text → Speech**
> takes pasted or uploaded `.txt` / `.md` / `.pdf` / `.docx`, shows a duration
> and cost estimate, and generates a downloadable WAV.
>
> **Speech → Text is not yet verified end to end.** No successful transcript has
> been recorded: the API key stopped authenticating mid-verification (see
> [Known gaps](#known-gaps)). What *is* verified is the degradation behaviour —
> a failed token mint leaves recording untouched, the batch path still runs, and
> failures render as plain language with no stack trace.
>
> **Text → Speech is verified against the real API.** Seven generations were
> produced and used to calibrate the cost estimator.
>
> The approved design spec and the phased build plan, with a live progress
> checklist, are tracked in `docs/superpowers/`.


---

## Stack

| Layer | Choice | Version |
| :--- | :--- | :--- |
| Framework | [Astro](https://astro.build) (`output: 'server'`, on-demand rendering) | `^7.3.5` |
| Adapter | [`@astrojs/node`](https://docs.astro.build/en/guides/integrations-guide/node/) (`mode: 'standalone'`) | `^11.1.6` |
| Styling | [Tailwind CSS](https://tailwindcss.com) via `@tailwindcss/vite` | `^4.3.3` |
| Gemini SDK | [`@google/genai`](https://www.npmjs.com/package/@google/genai) — pinned **below 3.0.0** | `^2.24.0` |
| File extraction | [`unpdf`](https://www.npmjs.com/package/unpdf) (PDF), [`mammoth`](https://www.npmjs.com/package/mammoth) (DOCX) | `^1.8.1` / `^1.12.3` |
| Fonts | Astro Fonts API, `fontProviders.google()` — Geist, Geist Mono | bundled with Astro |
| Type check | `@astrojs/check` + TypeScript | `^0.9.10` / `^6.0.3` |
| Runtime | Node.js | `>=22.12.0` |
| Package manager | [bun](https://bun.sh) | `1.4.2` |

Dependencies are pinned in `bun.lock`. There is no database and no client-side
framework — Astro components only, zero hydration by default.

`@google/genai` is deliberately held on the 2.x line: 3.0.0 raises the Node floor
to 22+, and staying on 2.x should be a decision, not an accident.

## Environment variables

| Variable | Scope | Required | Purpose |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | **Server secret** | Yes, at runtime | Authenticates every Gemini call. Read only via `getSecret('GEMINI_API_KEY')` from `astro:env/server`. |

Setup: copy `.env.example` to `.env` and fill in the key from
[Google AI Studio](https://aistudio.google.com/apikey). `.env` is gitignored and
must never be committed.

The key is **never** prefixed with `PUBLIC_` and **never** reaches the browser.
The variable is typed optional in `src/env.d.ts` specifically so `bun run build`
does not fail on a machine that has not created `.env` yet — a missing key is a
runtime error, not a build error.

> [!WARNING]
> Do not commit `.env`. `.gitignore` covers `.env`, `.env.*`, and re-admits only
> `.env.example`. It was verified with `git check-ignore` that `.env.local`,
> `.env.development`, and `.env.production` are all ignored.


---

## Getting started

```bash
bun install     # install dependencies
bun run dev     # dev server with HMR at http://localhost:4321 — loads .env
```

`.env` must exist before `bun run dev`; without it every Gemini call fails with
a 500 that names the missing key. `bun run smoke` will tell you in one line
whether the built server can see it.

## Commands

| Command | Action |
| :--- | :--- |
| `bun install` | Install dependencies from `bun.lock` |
| `bun run dev` | Start the dev server with HMR on `localhost:4321` |
| `bun run build` | Production build into `./dist/` (`client/` + `server/`) |
| `bun run preview` | Serve the production build locally |
| `bun run check` | Type check — `astro check`, must report zero errors |
| `bun run start` | Run the built server, **loading `.env`** (see the warning below) |
| `bun run smoke` | Start the built server and check the page, both tools on their own routes, and key visibility |
| `bun test` | Unit tests (`bun test` is built in — no test framework dependency) |
| `bun run check:secrets` | Scan `dist/` and the client source for key material (run after `build`) |
| `bunx astro --help` | Astro CLI reference |

`bun run check` and `bun run build` are the two gates. Run both before opening a
pull request; neither is enforced in CI yet because there is no CI.

> [!WARNING]
> **Do not run `node ./dist/server/entry.mjs` directly.** The standalone server
> does **not** load `.env` — `getSecret()` reads `process.env`, and nothing
> populates it in the built output. You will get
> *"GEMINI_API_KEY is not set"* and it will look like your key is broken when it
> is not. Use `bun run start` (adds Node's `--env-file-if-exists=.env`) or
> `bun run dev`. Full explanation in
> [`docs/development.md`](docs/development.md#the-standalone-server-does-not-load-env).

> [!NOTE]
> `bun test` is the third gate. It covers the pure modules in `src/lib` — the
> WAV container, the script-aware chunker, and the cost estimator. `@types/bun`
> is a devDependency because `bun:test` ships no type declarations; it is types
> only, not a test framework.

---

## Project structure

```text
.
├── public/                     # static assets served as-is (favicons)
├── src/
│   ├── assets/                 # images imported by components
│   ├── components/             # reusable .astro components
│   ├── layouts/                # page shells (Layout.astro imports global.css)
│   ├── pages/                  # file-based routing — /, /speech-to-text, /text-to-speech
│   ├── styles/
│   │   └── global.css          # Tailwind entry point — @import 'tailwindcss'
│   └── env.d.ts                # typed GEMINI_API_KEY declaration
├── docs/superpowers/           # design spec + implementation plan
├── .agents/
│   ├── rules/                  # research + planning rules, auto-loaded
│   └── skills/                 # agent skills, auto-discovered
├── .env.example                # template — copy to .env, never commit .env
├── AGENTS.md                   # project memory — stack, commands, conventions
├── DESIGN.md                   # design system source of truth
├── opencode.jsonc              # MCP + rules wiring
├── skills-lock.json            # pinned skill sources
├── astro.config.mjs
└── package.json
```

### Routes and rendering

Routing is file-based under `src/pages/`. There are three pages:

| Route | File | What it is |
| --- | --- | --- |
| `/` | `index.astro` | Landing page — hero, the two tool CTAs, and a feature grid |
| `/speech-to-text` | `speech-to-text.astro` | The STT tool (`SttPanel`) |
| `/text-to-speech` | `text-to-speech.astro` | The TTS tool (`TtsPanel`) |

The route list itself lives in `src/lib/nav.ts` and drives both the header and
the footer, so the two can never drift apart or link a page that does not exist.
Each tool page uses the reduced `Hero` band (`compact`) — the full
`{spacing.section}` band is a marketing measure and would push the tool below
the fold.

Output mode is `server`, so routes are rendered on demand by the Node adapter
unless a page opts out with `prerender = true`. There is no `public/` HTML and no
SPA fallback.

API endpoints will live at `src/pages/api/*.ts` and are server-only — that is the
point of `output: 'server'`, and the reason the Gemini key can stay out of the
browser.

---

## Design system

`DESIGN.md` is the **single source of truth** for visual design. Read it before
writing any markup or class. It defines a complete token set — colors,
typography scale, radii, spacing, component specs, and usage rules.

The system is a **black-and-white duet**: near-black ink (`#171717`) on a
near-white canvas (`#fafafa`), with a single multi-stop mesh gradient (cyan →
blue → violet → magenta → amber) as the only decorative element, confined to the
hero. Depth comes from 1px hairlines (`#ebebeb`), not shadows.

Three rules that are easy to get wrong:

- **Do not invent tokens.** Reuse what `DESIGN.md` defines. Adding a token is a
  breaking change to the design system and must be called out explicitly.
- **Button shape carries meaning.** Marketing CTAs are full pills (100px);
  nav and in-app controls are 6px squares. Never mix shapes within one context.
- **The −2.4px display tracking is a Latin measurement.** It is calibrated to
  Latin proportions and is applied under `:lang(en)` only, via a `latin` custom
  variant. Bengali and Devanagari get `letter-spacing: normal`, because negative
  tracking collides with their headline bars (matra). Neither Bengali (`।` `॥`)
  nor Devanagari (`।` `॥` `ৎ`) terminate sentences with ASCII punctuation, so any
  text splitting must be script-aware.

### Fonts

Geist Sans and Geist Mono are resolved and downloaded at build time through the
Astro Fonts API (`fontProviders.google()`), declared in `astro.config.mjs`. They
are self-hosted — the build emits hashed `.woff2` files into
`dist/client/_astro/fonts/`, so no third-party font CDN is contacted at runtime.
The two stacks are transcribed from `DESIGN.md`:

- `--font-geist` → `Geist, Arial, sans-serif` (weights 400, 500, 600)
- `--font-geist-mono` → `Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace` (weight 500)

Only these two faces are registered. `DESIGN.md` states there is no third face, so
Bengali and Devanagari glyphs come from the reader's own system font fallback.

> [!NOTE]
> The `fallbacks` arrays are explicit because Astro's default is only
> `["sans-serif"]`, which would drop the `Arial` and mono fallbacks `DESIGN.md`
> specifies.

### Cost estimation

The estimate is pure local arithmetic — no Gemini call, so it cannot fail on
quota, latency, or a missing key, and it costs nothing. Cost follows from
duration, which follows from a **measured** speaking rate:

| Script | Rate | Basis |
| :--- | --- | :--- |
| English / Latin | 15.4 chars/s | 3 samples, 13.8–17.1 |
| Bengali | 11.6 chars/s | 3 samples, 11.3–12.2 |
| Hindi / Devanagari | 12.0 chars/s | **1 sample** |

These were measured on 2026-09-26 by generating real audio and reading the
duration from the returned WAV header. The rate is **script-dependent**, which a
single constant cannot express: the best global value is still 11% off on average
and 30% off at worst. `estimate.ts` classifies the dominant script by Unicode
block range and applies the matching rate; the panel prints the rate it used.

Two honest limits: the English spread is **voice-dependent** (Charon read
17.1 chars/s where Kore read 13.8 on comparable prose), so the English estimate
carries roughly ±11% error; and the Hindi figure rests on a single sample. Both
are labelled in the source. Audio tokens bill at 25/second, so duration error
propagates directly into cost.

### Known gaps

- **No successful end-to-end transcript.** The API key returned
  `401 ACCESS_TOKEN_TYPE_UNSUPPORTED` on every endpoint once the free-tier daily
  quota was exhausted, mid-verification. This is an account condition, not a
  code fault — `/api/synthesize` had succeeded minutes earlier with the same
  key. Needs a working key to close.
- **Smart mode is unconfirmed.** `audioTranscriptionConfig` is the SDK's typed
  field on the `generateContent` path, but the transcribe docs document a
  differently-named REST field on the Interactions path. If the backend ignores
  it, Smart mode is *silently* downgraded to Verbatim — no error, worse output.
  One recording containing an enumerated list settles it: Smart formats lists,
  Verbatim does not.
- **The Live socket path form is unverified against a live connection.** The
  documented long form is used; Google's reference client uses a shorter
  variant. Check this first if the live draft 400s.
- **Hindi speaking rate has one sample**, and English carries ±11% from
  voice-dependence.


---

## Documentation

| Document | Covers |
| :--- | :--- |
| [`AGENTS.md`](AGENTS.md) | Project memory — stack, hard rules, verification |
| [`DESIGN.md`](DESIGN.md) | Design system source of truth |
| [`docs/README.md`](docs/README.md) | Documentation index, plans, and archive |
| [`docs/development.md`](docs/development.md) | Commands, structure, dependency versions, environment quirks |
| [`docs/agent-workflow.md`](docs/agent-workflow.md) | Skills, rules, MCP, scratch-file policy |

`docs/README.md` and its subfolder indexes keep themselves current via
`bun run docs:sync`. Superseded documents move to
[`docs/archive/`](docs/archive/README.md) rather than being deleted.

---

## Agent workflow

This repo is configured for [opencode](https://opencode.ai). Agents pick up
their context automatically — nothing to install per-clone.

**`AGENTS.md` is the project memory.** It records the stack, hard rules, and the
verification standard. Where it and anything else disagree, `AGENTS.md` wins.

**Rules** live in `.agents/rules/` and are registered via the `instructions`
field in `opencode.jsonc`, so they load every session: `analysis_and_research.md`
(three-pass research with mandatory evidence tagging) and
`plan_and_documentation.md` (mandatory four-tier plan structure).

**Skills** live in `.agents/skills/` and load on demand by name:
`brainstorming`, `frontend-design`, `tailwind-4-docs`, `web-design-guidelines`,
and `code-skeptic`.

**MCP:** the `astro-docs` remote server is configured in `opencode.jsonc`. Query
it for any Astro API, integration, config option, or CLI flag rather than
relying on memory.

Full detail — including the skill/rule overlap notes, the scratch-file policy,
and the `bun install` workaround — is in
[`docs/agent-workflow.md`](docs/agent-workflow.md) and
[`docs/development.md`](docs/development.md).

---

## Conventions

- **Secrets.** Never read, parse, grep, or commit `.env`, `.env.local`, or any
  `*.env` file. Use `.env.example` if one exists. Never inline secrets into
  client-side code.
- **Verification.** Never state that a build, typecheck, or test passed without
  pasting the actual command output. If a command was not run, say so.
- **Package manager.** bun only. Do not introduce npm, pnpm, or yarn.
- **Docs and comments** are written in English.

---

## License

Unlicensed — all rights reserved.
