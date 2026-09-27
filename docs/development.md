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
| `PAGES_TARGET=pages bun run build` | Static Pages build — prerenders the three pages into `dist/client` and sets `base: '/GeminiTTS/'` |
| `bun run start` | Run the built server, loading `.env` via Node's `--env-file-if-exists` |
| `bun run smoke` | Start the built server and check the page, both tools on their own routes, the shared chrome, `/api/health`, and key visibility |
| `bun run preview` | Serve the production build locally |
| `bun run check` | Type check — `astro check`, must report zero errors |
| `bunx astro --help` | Astro CLI reference |
| `bun run docs:sync` | Regenerate `docs/README.md` and `docs/archive/README.md` |
| `bun run check:contrast` | Recompute the WCAG contrast of every text token on every surface, both themes |
| `bun run check:secrets` | Scan `dist/` and the client source for key material; run after `bun run build` |
| `bun run check:routes` | Assert no test file under `src/pages/` is shipped as a live route; run after `bun run build` |
| `bun run check:shell` | Assert the shell contract: the no-flash bootstrap ordering, the skip link, and the 640px nav switch (plan 6.2–6.4, structural half). Proven able to fail; has not yet caught a real defect |
| `bun run check:panel` | Run the **shipped** TtsPanel bundle against a DOM stub and assert the cost gate opens when text is typed and when text is already in the box on load, then run `check:spacing`. **Caught a real defect** — see [The cost gate and the listener that was not there yet](#the-cost-gate-and-the-listener-that-was-not-there-yet) |
| `bun run check:spacing` | Assert every declared stack of sibling panels carries a non-zero vertical gap, read from the **built** HTML. **Caught a real defect** — the unspaced `ByokSettings` panel. Skips the real-page check on a node build (`output: 'server'` renders HTML on demand); `PAGES_TARGET=pages bun run build` puts the pages on disk, and CI asserts them there |
| `bun run verify:stt` | One live STT recording that settles whether Smart mode is honoured or silently downgraded to Verbatim. **Never executed** — see [Verifying STT end to end](#verifying-stt-end-to-end) |

`bun run build` and `bun run check` are the two gates. Run both before opening a
pull request. `.github/workflows/pages.yml` runs them on every push to `main`,
along with `check:panel`, `check:spacing` and an assertion that the three
prerendered pages survived every rebuild — but for the **static** target only.
The node build has no pipeline, so the node gates are on you.

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

It scans `dist/` for a key *shape* (`AIza…` or `AQ.Ab…` — Google issues
auth keys now, and a scanner that only knew the old prefix would pass a real
key), then asserts in the source that
only `gemini-direct.ts` and `health.ts` attach `x-goog-api-key`, that the browser
transport's host is Google, and that the key is never interpolated into a URL.
Matches are reported as `file:line`, never as content, so the gate cannot leak
the thing it is looking for.

Two files are allowed to attach that header, because there are two different
keys in this app and conflating them would be the mistake:

| File | Key | Read from |
| :--- | :--- | :--- |
| `src/lib/client/gemini-direct.ts` | the **user's** key, in the browser | `sessionStorage` / `localStorage` |
| `src/lib/gemini/health.ts` | **our** key, on the server | `process.env.GEMINI_API_KEY` |

The health probe can never leak a stored user key because it never imports
`lib/client/keystore.ts`. Adding a third file to that allowlist is a deliberate
edit with a stated reason, which is the point.

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

**Do not replace the gate with a grep.** `Select-String -Path "dist/client/**" -Pattern
"GEMINI_API_KEY|AIza|AQ\."` does match in the static build — three times, all in
one minified line of `dist/client/_astro/provider.*.js`, and all harmless: the
*name* of the variable appears in one user-facing string ("Check GEMINI_API_KEY
in your .env file."), and `AIza` appears twice inside the redaction pattern in
`gemini/classify.ts`, which ships to the browser so upstream error text can be
scrubbed before it is rendered. What matters is the absence of key *material*,
and that is what `check:secrets` tests: a shaped literal, never a name or a
character class.

What it cannot prove: what a browser does at runtime. The "never reaches our
origin" claim rests on the routing tests, which capture the actual `fetch` URLs.

### `bun run check:routes`

```
bun run build
bun run check:routes
```

Every file under `src/pages/` is a route — that is Astro's contract, and it has
teeth. `src/pages/api/endpoints.test.ts` therefore shipped as a **production
route** at `/api/endpoints.test` whose component was a test file importing
`bun:test`, putting the whole suite into `dist/server/`. It is found by
`check:secrets` reporting a key-shaped literal at
`dist/server/chunks/endpoints_*.mjs`; the literal was fake, so a gate that only
looked for *real* secrets would have passed. The test now lives in `src/tests/`,
and this gate keeps it there. It carries the same positive control as the other
two: a planted file the detector must reject.

**Where tests go.** `src/lib/**` and `src/tests/`, never `src/pages/`. A test
beside the module it covers is fine; a test inside the routing tree is a URL.

### `bun run check:shell`

```
bun run check:shell
```

The structural half of the plan's Phase 6 perceptual checks (6.2 no-flash, 6.3
keyboard, 6.4 responsive). It asserts the preconditions a browser would
otherwise have to discover: the theme bootstrap is `is:inline`, synchronous, and
ordered ahead of the stylesheet; the skip link precedes the nav and targets an id
that exists; no positive `tabindex`; no hard `w-[NNNpx]`; the nav/menu switch is
expressed in `sm:` variants. All four detectors carry a positive control.

It reads the **source** tree, not `dist/`, so a stale build cannot be mistaken
for a verified shell.

**What it cannot prove, and why the no-flash claim lives in `smoke.mjs`.** A
browser cannot prove "there is no flash". A CDP screencast only sees frames the
compositor actually produced, and Phase 6 verified this by injecting a genuine
light-first paint: the screencast did **not** report it, because the document is
parsed and styled before the first frame is produced. Three in-page probes
failed the same way, each reading a transparent or unstyled canvas. So the
screencast result is evidence that no *frame* was light, which is weaker than the
claim, and the claim itself is asserted where it is provable: `smoke.mjs` checks
the byte order of the **served** HTML — the inline bootstrap sits inside `<head>`,
before `<body>` and before the stylesheet — which makes a light first paint
impossible by construction rather than by observation.

### The cost gate and the listener that was not there yet

`bun run check:panel`

The TTS panel enables Generate only once an estimate exists for the exact text in
the box. The estimate is computed **in the browser** — `request('estimate')` is
answered locally by `estimateText`, never by the network — so it cannot fail for
connectivity reasons. It can only fail if the `input` listener was never
attached, or was attached after the text had already arrived.

Three ordinary browser behaviours change a textarea without firing `input`:
form restoration on reload and on back/forward, a paste that lands before the
module executes, and some mobile clipboard and autofill paths. All three end in
the same state — text on screen, `estimatedFor` still `null`, Generate
permanently disabled, and a note telling the user an estimate "must load" with
no way to make it. That shipped: it was reported as "it is not working" from a
phone, with a screenshot showing a full paragraph of text and a dead button.

**Nothing in the suite could see it.** `astro check` reads types, `bun test`
covers pure functions, and `check:shell` reads source — and the source was
correct. The defect was in *when* the module ran relative to the user's paste,
which is a property of the built artifact and only of the built artifact.

`check:panel` therefore imports the shipped chunk from `dist/client/_astro/`
against a small DOM stub and drives it two ways: text typed after load, and text
already present when the module executes. The second is the regression.

Its positive control is a **real build** of the panel with `resyncEstimate()`
and its two listeners removed — the pre-fix source. That build is run, asserted
to fail, and the original file is restored in a `finally`, followed by a rebuild
so `dist/` matches the source again. Verified red before the fix:

```
FAIL  Generate is disabled when the textarea already has text on load. The panel
      never reconciles text that arrived without an `input` event (form restore,
      early paste, autofill). Note reads: An estimate must load before generating
```

It runs in `.github/workflows/pages.yml`, because a browser-only regression that
ships once should not be able to ship twice on a machine nobody is watching.

### The watchdog: a failure that used to be invisible

A panel that fails to load now says so, and `check:panel` proves it does.

Everything in the panel is a `type="module"` script, so it can fail in three
ways that leave no trace: the chunk 404s, the import graph fails to resolve, or
the module throws before it attaches a listener. In every one of those the page
still renders, the CSS still loads, other panels still work, and the cost gate
sits there permanently disabled reading "An estimate must load before
generating" — an error with no error, reported as "it is not working" with
nothing to go on. It is the reason this took three deploys to pin down.

**The cause is mundane, and the symptom is misleading.** GitHub Pages sends
`Cache-Control: max-age=600`, so a browser can hold HTML that references *last*
deployment's hashed chunk. The next deploy removes that file, the module 404s,
and the panel is dead until the HTML is refetched. Meanwhile the page's CSS hash
has not changed, so everything looks fine, and any panel whose chunk did not
change keeps working — which is exactly what was seen: BYOK saving worked, the
TTS gate did not. A build hash cannot prevent that. Only detect it.

So a **classic** inline script — not a module, because a module can be one of the
things that failed — waits 2.5s for the module to set
`document.documentElement.dataset.ttsPanel = 'ready'`, and if it never does, it
replaces the misleading gate note with the real cause and a **Reload** button
that cache-busts the URL. A watchdog that fires on a healthy page would be worse
than none, so `check:panel` asserts both directions: it stays silent when the
panel works, and it fires with an action when the module never loads.

### A green Pages run that published no pages

`check:panel` rebuilds the project twice (once for the control, once to restore),
and it inherits whatever `PAGES_TARGET` its shell can see. The workflow originally
set `PAGES_TARGET` on the build step alone, so those two rebuilds ran as **node**
builds and replaced the artifact: `dist/client` kept the hashed assets and lost
every prerendered page. The upload shipped 14 files and zero `.html`, and the run
reported `success` — a static deploy of a node build is not a build failure.

It was caught by downloading the deployment artifact and listing it, which is
the only step in that pipeline that looks at what was actually published:

```
$ gh run download <run> --name github-pages && tar -tf artifact.tar | grep -c '\.html$'
0
```

Two changes, because either alone leaves the trap in place. `PAGES_TARGET` moved
to the **job-level** `env`, so every step in the job builds the same target; and
an assertion step checks the three `index.html` files still exist immediately
before the upload. Lesson worth keeping: a check that rebuilds the artifact is
itself a writer of the artifact, and a deployment pipeline needs a step that
verifies the *published* thing rather than the steps that were meant to produce
it.

### `bun run verify:stt`

```
bun run verify:stt
```

One live recording that settles the project's largest inherited open item:
whether `audioTranscriptionConfig.mode = SMART` is honoured, or silently
downgraded to Verbatim — a failure that produces worse transcripts with no
error, so it looks like success.

**It has never been run.** No Gemini credential was available in the environment
where it was written, so there is no output from it and no claim that it passes.
Only the credential-absent path (`exit 2`, naming `/api/health`) has been
exercised. Treat the file as a procedure awaiting a key, not as a test suite.

It synthesises a passage containing an enumerated list — "first… second… third…" —
because Smart mode formats spoken structure into paragraphs and lists while
Verbatim returns flat prose, which makes the output's line structure the
discriminator. `--mode verbatim` runs the control that must come back flat.

**Use your own BYOK key.** `STT_VERIFY_KEY` (preferred) or `GEMINI_API_KEY`;
either is read by the local process and goes straight to Google, so the app's
server is never involved — the same trust property the browser-direct mode
exists to provide. A bad key fails authentication before anything is billed, so
a wrong key costs nothing.

**Do not settle this from the transcript in the UI.** The app runs a second,
text-only structure pass after transcription (`src/lib/gemini/transcribe.ts`),
and *that* pass can add paragraphs and lists on its own. A well-structured
transcript in the panel is therefore not evidence that Smart mode was honoured.
This script calls pass 1 only, which is the sole place the question can be
answered.

Costs two requests (one TTS to build the audio, one STT to transcribe) against a
free tier with a daily ceiling.

## Rate limiting and body limits on the API

Every route under `/api/` is unauthenticated — the app has no accounts and this
project does not invent them — so the protection is a per-IP rate limit in
`src/middleware.ts` over `src/lib/server/rate-limit.ts`. Middleware rather than
per-route calls, because this project has already shipped one route nobody meant
to expose: a limit added inside each handler protects exactly the routes that
existed when it was written, and a route added tomorrow is unprotected until
someone remembers.

| Route | Default | Why that number |
| :--- | :--- | :--- |
| `/api/synthesize`, `/api/transcribe` | 30 / min | one POST covers a whole script — chunking is server-side, so this is per *action*, not per chunk |
| `/api/extract`, `/api/live-token` | 12 / min | CPU-bound (`unpdf`/`mammoth` over an attacker-chosen 20 MB file) and credential-minting respectively |
| `/api/health` | 30 / min | cheap, but it is an information leak and is bounded like the rest |
| `/api/estimate` | 120 / min | local computation |

Override per route with `RATE_LIMIT_SYNTHESIZE=60`; **`0` disables** that
route's limit. A non-numeric value is ignored rather than read as zero, so a
typo cannot silently switch protection off.

Three limits the code states about itself, all of them load-bearing:

- **It is per process and in memory.** A restart clears every bucket, and N
  instances behind a load balancer allow N times the limit. Fixing that needs a
  shared store, which would be this project's first piece of persistent state.
- **Behind a reverse proxy the client address is the proxy's**, so every visitor
  shares one bucket. That fails closed — the limit still applies — which is why
  `clientAddress` is read defensively in the middleware and falls back to a
  single `unavailable` bucket. A forwarded header is client-controlled, so
  trusting it would hand every caller a fresh bucket per request.
- **A rejected request is not recorded.** Recording it would extend the window
  for a client already being told to wait, turning a fixed wait into an
  open-ended one for anyone who keeps asking.

The window is **sliding, not fixed**: a fixed window allows the full limit at
0:59 and again at 1:00, twice the ceiling in two seconds — the same
burst-the-herd flaw the retry backoff avoids.

`readJson` caps request bodies at 32 MB **while streaming**, not after
buffering. `request.json()` reads the whole body first, so a check on the parsed
value has already permitted the allocation it exists to prevent; `content-length`
is used only as a cheap early exit, because a client that omits or lies about
that header is exactly the case a limit is for. The cap is derived from
`MAX_EXTRACT_BYTES` (20 MB, inflated 4/3 by base64) so it cannot drift below
the largest legitimate upload — verified live: a 19 MB document still reaches
the extractor, a 40 MB one gets `413`.

## Diagnosing a rejected or missing key

```
bun run build
bun run smoke
```

`bun run smoke` calls `GET /api/health` and prints its `state`, then uses that
state to name the cause. The four states are the point — the previous
behaviour inferred "no `.env`" by pattern-matching the words
`GEMINI_API_KEY is not set` in a 500 body, so any rewording of that message
broke the diagnosis and a key rejected by Google was reported as a key that was
never loaded.

| `state` | Meaning | What to do |
| :--- | :--- | :--- |
| `configured` | Gemini accepted the key | nothing |
| `missing` | no key in the server's environment | use `bun run dev` or `bun run start`; a bare `node dist/server/entry.mjs` loads no `.env` |
| `invalid` | a key is present and Gemini rejected it | the `.env` is being read; the credential is the problem |
| `quota_exhausted` | the key works, the project is out of budget | free-tier limits reset at midnight Pacific |
| `unknown` | the probe could not reach a conclusion | treat as a network problem, not a key problem |

The probe reads `models?pageSize=1`, never a `generateContent` call, so it costs
no quota — a health check that spends the budget manufactures the outage it is
looking for. The route answers `200` for every state, because it reports *what
state the key is in*, not *whether the process is alive*; a 429 for an exhausted
quota would page a human for a condition no human action fixes. `state` is the
contract.

## Retries, and which failures are worth a second attempt

`src/lib/client/retry.ts` wraps every request at the provider seam, with
exponential backoff and **full jitter**, and retries exactly two statuses: `429`
and `503`.

Not `502`, and not a network error. Both are reported as 502 because both mean
"no answer from Gemini" — and in either case the request may already have been
generated and billed upstream, so re-sending re-spends the user's quota. A
`400` remapped to `502` for display is the same trap: the real upstream status
rides out of band and the retry layer reads *that*, never the number the UI
renders.

The asymmetry is deliberate. This app talks to a free tier with a hard daily
ceiling, so over-eager retrying spends money that is already spent, while
under-eager retrying produces a message that says "try again" — which the UI
already offers as an explicit button.

## The request meter is a log, not a limiter

`QuotaMeter.astro` counts the requests *this browser* made today and nothing
else. The copy says so, because the browser cannot know the provider's real
remaining budget: under the server key the counter lives in Google's project,
and under BYOK it lives in the user's.

Days are bucketed in **Pacific time**, because that is when Gemini's free-tier
daily limit resets. Bucketing by the reader's local day would show a reset at
midnight for a user in Kolkata — nine and a half hours early — and would invite
exactly the over-spend the meter exists to prevent.

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
│   ├── tests/                  # tests that must not become routes (see check:routes)
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

### The static Pages demo: `PAGES_TARGET=pages`

One source tree, two targets, switched in `astro.config.mjs`:

| | default | `PAGES_TARGET=pages` |
| :--- | :--- | :--- |
| `output` | `'server'` | `'static'` — the adapter stays, so the `prerender = false` routes still build into `dist/server/` |
| `base` | unset (`/`) | `/GeminiTTS/` |
| uploaded | `dist/server/entry.mjs` | `dist/client/` |

Astro 5 merged `output: 'hybrid'` into `'static'`, which is what makes the
second column possible: pages prerender, opt-out routes are still emitted, and
the build does not error on `prerender = false`. What Pages never gets is
`dist/server/`, because there is nothing there that can execute it.

**Consequences to keep in mind:**

- **`base` is not optional there.** A repository site lives at `/GeminiTTS/`,
  and Astro rewrites `import.meta.env.BASE_URL` but *not* hand-written
  `href="/speech-to-text"` strings. Every internal link therefore goes through
  `withBase()` in `src/lib/base.ts`; `NAV_ITEMS` in `src/lib/nav.ts` stays a
  plain route table and the prefixing happens at render time. A new component
  that hardcodes `href="/"` reintroduces a 404 on Pages.
- **The switch lives in the config, not in the routes.** Astro 5 removed
  dynamic `prerender` exports, so `export const prerender = someEnvVar` is no
  longer available as a seam.
- **Two features are missing by design.** `live-token` and `extract` are
  `always-server` in the provider table — the Live handshake puts the key in a
  query string, and `mammoth`/`unpdf` need Node. Their requests still go to our
  origin on Pages; `explainMissingServer()` in `provider.ts` translates the
  non-JSON 404 into a 501 with a readable message. Gating the *fetch* on a
  build flag instead would have made an `always-server` route conditional, which
  `provider.test.ts` refuses to allow, correctly.
- **No key in CI.** The Pages workflow sets no `GEMINI_API_KEY`, deliberately:
  the static build must not depend on a secret it does not use.

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
`src/lib/gemini/live-token.test.ts` and `src/tests/api-endpoints.test.ts`.

**Updated in Phase 4:** the old verification here — "`generativelanguage` should
not appear anywhere under `dist/client/`" — is no longer true, and the check was
removed rather than left to fail. BYOK puts a browser-side Gemini transport in
the client bundle, so that string now appears by design in
`src/lib/client/gemini-direct.ts`'s compiled output. A grep that is known to
fail teaches people to ignore greps.

What still holds, and what `bun run check:secrets` now enforces:

- no `AIza…`- or `AQ.…`-shaped literal anywhere in `dist/`;
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

## Deployment targets

Three targets, one source tree. What differs between them is not the code —
`astro.config.mjs` reads `PAGES_TARGET` and everything else follows — but
**where a Gemini key is allowed to live**, which is the question this project
could not answer before the static target stated its own constraint.

| Target | Build | Where a key lives | Server routes | "Is my key working here?" |
| :--- | :--- | :--- | :--- | :--- |
| Local dev | `bun run dev` | `.env` on this machine | yes | `GET /api/health` → `state` |
| Node host (default) | `bun run build` + `bun run start` | `.env`, or that host's own secret store | yes | `bun run smoke` → `✓ health 200 — configured` |
| GitHub Pages (static) | `PAGES_TARGET=pages bun run build` | **nowhere — a static host has nothing that can read one** | no | the **Save and test** control in the BYOK panel |

### Why Pages has no key, restated so it is not re-litigated

GitHub Pages' contract is *upload files to a CDN*. `actions/upload-pages-artifact`
takes a path and serves it; there is no process, no environment, and therefore
no request-time reader for a secret. A CI secret store is a **build-time** store
— it injects values into a job so a build can consume them — so "put the key in
GitHub Secrets" cannot answer a runtime read. The only way to make the static
build consume a key is to inline it into a client bundle, at which point it is a
published file and not a secret. `.github/workflows/pages.yml` therefore sets no
`GEMINI_API_KEY`, and the static build is BYOK-only by design rather than by
omission.

### What the build knows, and what the client asks

`serverAvailable()` in `src/lib/client/capability.ts` is the whole mechanism: it
is true when `import.meta.env.BASE_URL` is `/` or `''`, and the only non-root
`base` in `astro.config.mjs` is the Pages target. `readMode()` in
`src/lib/client/keystore.ts` defaults to `'byok'` when it is false, so a static
visitor starts on the one provider that can work there.

Before this, the default was `server` on every target. The build-time fact was
discarded and reconstructed at request time from a 404, so the first thing a
new visitor did was fail and learn about it from an error message about a server
that does not exist. `capability.test.ts` asserts the `base` ↔ target coupling
against `astro.config.mjs` itself: a future base path on a *server* build would
point every page at a host that is not there, and nothing else in the toolchain
would notice.

The server option stays selectable on the static target and still returns an
honest 501 from `explainMissingServer()`. Silently removing a choice is worse
than offering one that explains itself.

### One verification command per target

Run in this session on 2026-09-27, each target built immediately before it was
checked:

```powershell
# Node target — the product
bun run build
bun run smoke
#   ✓ health         200 — configured: Gemini accepted the key.

# Static target — the demo
$env:PAGES_TARGET = "pages"
bun run build
bun run check:spacing
#   Vertical rhythm holds. No two stacked panels touch.
Remove-Item Env:\PAGES_TARGET
```

`bun run smoke` is the node row's whole answer: it starts the built server with
`.env` loaded and prints the state, so it distinguishes *no key*, *bad key* and
*no budget* without you reading a body. `Invoke-RestMethod
http://localhost:4321/api/health` returns the same `state` against a dev server
or a running deployment.

**The static row's verification is a button, and there is deliberately no
command for it.** The check that matters there is the visitor's own key tested
in the visitor's own browser by "Save and test"
(`src/lib/client/key-probe.ts`, `models?pageSize=1`, no quota spent). A
server-side command could only ever test *your* key, which proves nothing about
the target. `bun run verify:stt` is the one existing command that accepts a
BYOK key — from `STT_VERIFY_KEY` or `GEMINI_API_KEY` in the environment rather
than an argument, so it stays out of shell history — but it costs two requests
of the free tier, answers a different question, and **has never been run**.

### A local `check:panel` run replaces a static build with a node build

Measured while writing this section, and it is the same trap CI already fixed:

```powershell
$env:PAGES_TARGET = "pages"
bun run build
bun run check:panel          # check:panel rebuilds the project twice
(Get-ChildItem dist\client -Recurse -Filter index.html).Count   # -> 3

# same, without the variable in the environment
bun run build; bun run check:panel
(Get-ChildItem dist\client -Recurse -Filter index.html).Count   # -> 0
```

`check:panel` inherits whatever `PAGES_TARGET` its shell can see, and its two
rebuilds are writers of the artifact. With the variable set at **process** scope
the pages survive; without it the static output is silently replaced by a node
build whose `dist/client` holds hashed assets and no HTML. In CI this is handled
by `pages.yml`'s job-level `env`, so every step in the job builds the same
target. Locally, export the variable for the whole sequence rather than per
command.

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

- **Dark-theme input borders are still below WCAG 1.4.11.** The light theme is
  fixed: `hairline` moved #ebebeb → **#8c8c8c**, which measures 3.22:1 on canvas
  and 3.36:1 in cards, and `bun run check:contrast` now counts those two pairs as
  failures rather than printing them as `info`/`warn` and exiting 0. The dark
  theme is unchanged at #262626 — 1.22:1 in cards, 1.31:1 on canvas — so the same
  script reports it as a `skip` with the reason attached, and
  `scripts/check-contrast.mjs`'s `BORDER_EXCLUSIONS` names it as a recorded gap
  rather than removing it. A 1px step on a near-black field reads as a visible
  edge where the same ratio on near-white does not, which is a perceptual
  argument and not an accessibility one; changing the dark value is a separate
  decision with its own visual review, and the light-theme fix is not precedent
  for it. `DESIGN.md`'s dark-ramp rules carry the same note.
  The token is duplicated in `check-contrast.mjs` on purpose, and the script now
  parses `src/styles/global.css` and fails on any disagreement, so the two
  cannot drift apart silently.
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
