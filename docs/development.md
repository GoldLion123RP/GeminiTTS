# Development

<!-- desc: Commands, project structure, dependency versions, and the bun-on-E: lockfile workaround. -->

Detail behind [`AGENTS.md`](../AGENTS.md). Read on demand.

## Commands

| Command | Action |
| :--- | :--- |
| `bun install` | Install dependencies from `bun.lock` |
| `bun test` | Run unit tests (no separate test framework) |
| `bun run dev` | Dev server with HMR at `http://localhost:4321` |
| `bun run build` | Production build into `./dist/` |
| `bun run start` | Run the built server, loading `.env` via Node's `--env-file-if-exists` |
| `bun run smoke` | Start the built server and check the page, both panels, and key visibility |
| `bun run preview` | Serve the production build locally |
| `bun run check` | Type check — `astro check`, must report zero errors |
| `bunx astro --help` | Astro CLI reference |
| `bun run docs:sync` | Regenerate `docs/README.md` and `docs/archive/README.md` |

`bun run build` and `bun run check` are the two gates. Run both before opening a
pull request. There is no CI enforcing them yet.

`bun run start` exists because `node dist/server/entry.mjs` **does not load
`.env`** — see [The standalone server does not load `.env`](#the-standalone-server-does-not-load-env).

## Project structure

```text
.
├── public/                     # static assets served as-is
├── src/
│   ├── assets/                 # images imported by components
│   ├── components/             # reusable .astro components
│   ├── layouts/                # page shells — Layout.astro imports global.css
│   ├── pages/                  # file-based routing; api/*.ts are server-only
│   ├── styles/global.css       # Tailwind entry — @import 'tailwindcss'
│   └── env.d.ts                # typed GEMINI_API_KEY declaration
├── docs/                       # documentation (see docs/README.md)
├── scripts/                    # repo tooling
├── .agents/
│   ├── rules/                  # research + planning rules, auto-loaded
│   └── skills/                 # agent skills, auto-discovered
├── .env.example                # template — copy to .env, never commit .env
├── AGENTS.md                   # project memory
├── DESIGN.md                   # design system source of truth
└── opencode.jsonc              # MCP + rules wiring
```

## Routing and rendering

Output mode is `server` on `@astrojs/node` (`mode: 'standalone'`), so routes
render on demand unless a page opts out with `prerender = true`. Build output
splits into `dist/client/` and `dist/server/`.

Server output exists for one reason: the Gemini calls must never run in the
browser, so `GEMINI_API_KEY` can stay a server-only secret. Anything touching
the key stays server-side. API endpoints live at `src/pages/api/*.ts` and are
server-only.

### The Live socket URL is served, not built client-side

The browser opens a WebSocket straight to Gemini, so a client bundle does
reference `wss://generativelanguage.googleapis.com`. That is not a leak, and it
is worth understanding why it is safe and why the URL arrives from the server.

`src/lib/gemini/live-token.ts` cannot be imported from an Astro `<script>`: it
transitively imports `astro:env/server` (via `client.ts`) and `@google/genai`,
so importing it would pull the secret reader and the whole SDK into
`dist/client/`. `POST /api/live-token` therefore returns a finished `url`
alongside the token, and the panel dials that string.

**The invariant to preserve:** the URL on the wire carries an ephemeral,
single-use, model-scoped token and nothing else. It must never gain a `key=`
parameter, and the real `GEMINI_API_KEY` must never appear in a response body
or in anything under `dist/client/`. Both are asserted by
`src/lib/gemini/live-token.test.ts` and `src/pages/api/endpoints.test.ts`.

Verify after any change here — the `generativelanguage` string should **not**
appear anywhere under `dist/client/`:

```powershell
Select-String -Path "dist\client\**" -Pattern "generativelanguage" -SimpleMatch -List
```

## The standalone server does not load `.env` ⚠️

**`node dist/server/entry.mjs` cannot see `.env`.** Astro populates
`process.env` in `astro dev` and `astro build` — and nowhere else. The
standalone bundle ships no dotenv loader, and `getSecret()` compiles down to
exactly this:

```js
// dist/server/chunks/runtime_*.mjs
var _getEnv = (key) => process.env[key];
```

So a `.env` sitting next to `dist/` is simply not read.

### Why this is worth a whole section

The failure is **indistinguishable from a missing or malformed key**. The server
answers `500` with *"GEMINI_API_KEY is not set. Copy .env.example to .env and
fill in your key…"* — which is true, and points straight at the one thing that
is not broken. The natural next step is to go inspect the key. Phase 6 burned
time exactly this way, and the message is doing its job too well: it is a
correct error message about a condition it cannot see the cause of.

### Use the right command

| Command | Loads `.env`? | Use for |
| :--- | :--- | :--- |
| `bun run dev` | yes | Day-to-day development. **The default choice.** |
| `bun run start` | yes (`--env-file-if-exists=.env`) | Running the built output. |
| `node dist/server/entry.mjs` | **no** | Only when the variables are already in the shell. |

`--env-file-if-exists` is a **built-in Node flag** (Node ≥ 20.6), so `start`
needs no dotenv dependency. The `-if-exists` variant is deliberate: a machine
with no `.env` still starts and fails at request time, rather than refusing to
boot.

### Check before you debug

```powershell
bun run build
bun run smoke
```

`scripts/smoke.mjs` starts the built server with the env file loaded, then
reports the page, both panels, and whether the server can see a key. It prints
**no key material** — only booleans and the server's own error text.

## Environment quirk: `bun install` fails on `E:`

```
EINVAL: Invalid argument: Failed to replace old lockfile with new lockfile on
disk (NtSetInformationFile)
```

bun's atomic lockfile replace fails on this drive. It works on `C:`, so this is
a filesystem issue, not a project one. `bunx astro add ...` also crashes at the
end with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` after writing
its files — check what actually landed before trusting it.

### Workaround

```powershell
bun install --no-save                       # populate node_modules
$t = "$env:TEMP\geminitts-bunlock"          # generate the lockfile on C:
Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $t | Out-Null
Copy-Item .\package.json "$t\package.json"
Push-Location $t; bun install; Pop-Location
Copy-Item "$t\bun.lock" .\bun.lock -Force
```

## Dependencies

| Package | Version | Why |
| :--- | :--- | :--- |
| `astro` | `^7.3.5` | Framework |
| `@astrojs/node` | `^11.1.6` | Standalone Node adapter for `output: 'server'` |
| `@google/genai` | `^2.24.0` | Gemini SDK — held on the 2.x line; 3.0.0 raises the Node floor to 22+ |
| `unpdf` | `^1.8.1` | PDF text extraction |
| `mammoth` | `^1.12.3` | DOCX text extraction |
| `tailwindcss` | `^4.3.3` | Styling |
| `@tailwindcss/vite` | `^4.3.3` | Tailwind v4 Vite plugin |
| `@astrojs/check` | `^0.9.10` | Type check (dev) |
| `typescript` | `^6.0.3` | Type check (dev) — peer range is `^5 \|\| ^6`; TS 7 is not supported by `@astrojs/check` |
| `@types/bun` | `^1.4.2` | Ambient types for `bun:test` (dev) — types only, no runtime, not a test framework |

Fonts (Geist, Geist Mono) resolve at build time through the Astro Fonts API and
are self-hosted — no runtime font CDN. See the README for the known gap: nothing
references the CSS variables yet, so no `@font-face` is emitted.

## Tests

`bun test` is built into bun, so there is no test framework dependency.
`bun-types` (via `@types/bun`) is the one addition: `bun:test` ships no type
declarations, so `bun run check` fails on every `import { test } from 'bun:test'`
without it.

```powershell
bun test              # unit tests for the pure modules in src/lib
bun test src/lib/audio    # one directory
```

Tests live beside the module they cover as `*.test.ts`. They are pure
TypeScript with no DOM, no network, and no server, so they need neither mocks
nor a running Astro instance.

## Environment variables

| Variable | Scope | Required | Purpose |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | Server secret | Yes, at runtime | Authenticates every Gemini call, read via `getSecret('GEMINI_API_KEY')` from `astro:env/server` |

Copy `.env.example` to `.env` and fill in a key from
[Google AI Studio](https://aistudio.google.com/apikey). `.env` is gitignored.
The variable is typed optional in `src/env.d.ts` so `bun run build` does not fail
on a machine without `.env` — a missing key is a runtime error, not a build
error.

## Known gaps

- **No fonts installed.** `DESIGN.md` specifies Geist Sans and Geist Mono, but
  `src/assets/` holds only SVGs and `public/` only favicons. The documented
  `Arial` / `ui-monospace` fallbacks are what actually render.
- **No `@theme` block.** `src/styles/global.css` is bare
  `@import 'tailwindcss'`, so no `DESIGN.md` token is mapped to a Tailwind
  utility yet.
- **No CI.** The build and type-check gates are manual.
- **`CHARS_PER_SECOND` is uncalibrated.** `src/lib/audio/estimate.ts` uses
  `14` as a placeholder for speech rate, so every duration and cost figure the
  UI shows is provisional. `estimateText` returns `calibrated: false` to force
  the "estimated" label until it is measured against a real generation.
- **Letter-free input is not rejected.** `chunkText` measures characters, so
  emoji-only text yields one chunk instead of none. The "no speakable text"
  check belongs in the estimate endpoint, not the chunker.

Both code gaps must be closed before real UI work starts.
