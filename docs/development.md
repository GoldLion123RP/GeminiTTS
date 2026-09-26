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
| `bun run smoke` | Start the built server and check the page, both tools on their own routes, and key visibility |
| `bun run preview` | Serve the production build locally |
| `bun run check` | Type check — `astro check`, must report zero errors |
| `bunx astro --help` | Astro CLI reference |
| `bun run docs:sync` | Regenerate `docs/README.md` and `docs/archive/README.md` |
| `bun run check:contrast` | Recompute the WCAG contrast of every text token on every surface, both themes |
| `bun run check:secrets` | Scan `dist/` and the client source for key material; run after `bun run build` |

`bun run build` and `bun run check` are the two gates. Run both before opening a
pull request. There is no CI enforcing them yet.

`bun run start` exists because `node dist/server/entry.mjs` **does not load
`.env`** — see [The standalone server does not load `.env`](#the-standalone-server-does-not-load-env).

## A stale server on 4321 will lie to you

Both `bun run dev` and `bun run start` bind `4321`, and a standalone server
holds the **old bundle in memory** for its whole lifetime. So a `dist/` built
ten minutes ago keeps serving pre-build HTML, and a page that no longer exists
in the source still renders.

This is nastier than a normal stale cache because every gate stays green.
`build`, `check`, `test` and `smoke` all pass *and* the browser shows the
previous build — the gates certify the artifact, while the browser is talking
to a process that loaded the artifact before your last edit. A rebuild does not
reach it.

**Check what you are actually talking to before trusting any browser result:**

```powershell
Get-NetTCPConnection -LocalPort 4321 -State Listen |
  ForEach-Object { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)").CommandLine }
```

`astro dev` in that output means a live dev server. `dist/server/entry.mjs`
means a standalone server, and its output predates your most recent build —
stop it (`Stop-Process -Id <pid> -Force`) and restart rather than debugging
the wrong code.

The same trap applies to `bun run smoke`: it defaults to `PORT=4321`, so with a
server already listening it will attach to *that* process instead of the
`dist/server/entry.mjs` it just spawned, and report a pass for code it never
launched. When anything else holds the port, pass a free one:

```powershell
$env:PORT=4322; bun run smoke
```

A green result from a harness that did not run the code is worse than no
result, because it is trusted.

## Theming and contrast

Both themes are one token set re-pointed at different values. Colour utilities
compile to `var(--color-x)`, so `[data-theme='dark']` in `global.css` re-binds
the whole palette and no component carries a dark-mode style. `data-theme` is
written on `<html>` by the inline synchronous script in `Layout.astro`, before
first paint — it is `is:inline` precisely because a hoisted module script is
`defer`red and would restore the theme *after* the page had already painted.

**Contrast is computed, not eyeballed.** A perceptual ramp cannot be validated
by looking at it, and the light theme's original `mute` / `faint` / `link`
values all failed WCAG AA while looking fine. Re-run after any colour token
change:

```
bun run check:contrast
```

Both themes must report zero failures. Every text token is held to 4.5:1
because all body copy is 12–16px and nothing qualifies as WCAG "large text".

### Verifying a theme actually applied

```powershell
$r = Invoke-WebRequest http://localhost:4321/ -UseBasicParsing
# the bootstrap must be a plain <script> inside <head>, never type="module"
($r.Content.IndexOf('geminitts-theme') -lt $r.Content.IndexOf('</head>'))
```

A `dark:` class in the served HTML means the no-flash script failed and the
page will flash light before correcting itself.

## Bring-your-own key (BYOK)

A user can paste their own Gemini key, which then travels from the browser
straight to Google. Three rules keep that honest, and all three are enforced in
code rather than in copy:

| Rule | Where it lives | Enforced by |
| :--- | :--- | :--- |
| Session-only by default; `localStorage` is opt-in | `src/lib/client/keystore.ts` | `src/lib/client/provider.test.ts` |
| The key is only ever sent to `generativelanguage.googleapis.com` | `src/lib/client/gemini-direct.ts` | `bun run check:secrets` + routing tests |
| Live transcription and document extraction never see it | `ROUTES` in `src/lib/client/provider.ts` | routing tests |

The routing table, not a boolean, is what makes the third rule survive. A
`'server' | 'byok'` union would have pushed `live-token` and `extract` down the
browser path under BYOK — and `live-token` authenticates only through a query
parameter (measured in the plan's Phase 0.2), so that "simplification" would
have put the key in browser history.

### `bun run check:secrets`

```
bun run build
bun run check:secrets
```

It scans `dist/` for a key *shape* (`AIza…`), then asserts in the source that
only `gemini-direct.ts` attaches `x-goog-api-key`, that its host is Google, and
that the key is never interpolated into a URL. Matches are reported as
`file:line`, never as content, so the gate cannot leak the thing it is looking
for.

**It carries a positive control, and that is the point.** This repo has already
produced a false pass twice from `Select-String -Path "dist\**"` matching 1 of
45 files. A scan that reads nothing looks exactly like a clean bill of health,
so the script prints how many files it read, fails on a zero-file scan, and
first plants a synthetic key in a temp file that the detector *must* find. If
the control is missed, the run fails no matter what `dist/` contains.

Comments and UI copy are stripped before the source checks. The first version
failed on two false positives — `ByokSettings.astro` renders `x-goog-api-key`
inside a `<code>` element as part of the user's security statement, and
`gemini-direct.ts` names `?key=` in the comment explaining why it never does
that. A gate that cries wolf on its own documentation gets ignored.

What it cannot prove: what a browser does at runtime. The "never reaches our
origin" claim rests on the routing tests, which capture the actual `fetch` URLs.

## Project structure

```text
.
├── public/                     # static assets served as-is
├── src/
│   ├── assets/                 # images imported by components
│   ├── components/             # reusable .astro components
│   ├── layouts/                # page shells — Layout.astro imports global.css
│   ├── pages/                  # file-based routing; api/*.ts are server-only
│   ├── lib/client/             # browser-only: provider seam, keystore, BYOK transport
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

Server output exists for one reason: **our** `GEMINI_API_KEY` must never run in
the browser. Anything touching that key stays server-side; API endpoints live at
`src/pages/api/*.ts` and are server-only.

Phase 4 added a deliberate exception, and the distinction matters: a Gemini call
*does* now run in the browser when the user supplies their own key, and it
carries their credential, not ours. The server key is untouched by that path —
which is the whole point of the mode, and why `src/lib/client/` is split out
from the rest of `src/lib/`.

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

**Updated in Phase 4:** the old verification here — "`generativelanguage` should
not appear anywhere under `dist/client/`" — is no longer true, and the check was
removed rather than left to fail. BYOK puts a browser-side Gemini transport in
the client bundle, so that string now appears by design in
`src/lib/client/gemini-direct.ts`'s compiled output. A grep that is known to
fail teaches people to ignore greps.

What still holds, and what `bun run check:secrets` now enforces:

- no `AIza…`-shaped literal anywhere in `dist/`;
- `x-goog-api-key` is attached in exactly one module, and its host is Google;
- the key is never interpolated into a URL, which is the one thing the Live
  socket needs and the one thing a `fetch` call must never do.

The Live socket stays server-issued for the same reason: a browser cannot send a
request header on a WebSocket, so a browser-authenticated Live connection would
have to put the key in the query string.

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
reports the page, both tools on the route that owns each, and whether the server
can see a key. It prints
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

- **Input borders are below WCAG 1.4.11.** `hairline` sits at 1.14:1 on canvas
  and 1.19–1.22:1 in cards, where 3:1 is the reference for a boundary that
  identifies a control. Card borders and dividers are exempt (decorative), but
  an input's border is arguably not. `bun run check:contrast` reports this pair
  as `warn` rather than failing it. Lifting `hairline` to 3:1 would contradict
  DESIGN.md's "define cards and inputs with a 1px hairline before any shadow"
  and turn every card into a heavy grey rule, so it was left as a recorded gap
  rather than silently "fixed" — the inputs do carry a label and a 4.70:1
  focus ring as other affordances.
- **No fonts installed.** `DESIGN.md` specifies Geist Sans and Geist Mono, but
  `src/assets/` holds only SVGs and `public/` only favicons. The documented
  `Arial` / `ui-monospace` fallbacks are what actually render.
- **No CI.** The build and type-check gates are manual.
- **`CHARS_PER_SECOND` is uncalibrated.** `src/lib/audio/estimate.ts` uses
  `14` as a placeholder for speech rate, so every duration and cost figure the
  UI shows is provisional. `estimateText` returns `calibrated: false` to force
  the "estimated" label until it is measured against a real generation.
- **Letter-free input is not rejected.** `chunkText` measures characters, so
  emoji-only text yields one chunk instead of none. The "no speakable text"
  check belongs in the estimate endpoint, not the chunker.

Both code gaps must be closed before real UI work starts.
