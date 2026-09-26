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
| `bun run preview` | Serve the production build locally |
| `bun run check` | Type check — `astro check`, must report zero errors |
| `bunx astro --help` | Astro CLI reference |
| `bun run docs:sync` | Regenerate `docs/README.md` and `docs/archive/README.md` |

`bun run build` and `bun run check` are the two gates. Run both before opening a
pull request. There is no CI enforcing them yet.

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
