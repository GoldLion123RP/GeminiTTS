Status: In Execution (Phase 0 complete) | Doc-Type: Full

# Pages Deployment, BYOK Diagnostics, Light-Theme Borders & Panel Spacing — Implementation Plan

<!-- desc: Four-tier plan for the four defects reported 2026-09-27: the static GitHub Pages deployment cannot serve the .env key, BYOK reports failures under the wrong cause, light-mode borders sit at 1.14:1, and ByokSettings has no top margin. -->

> [!IMPORTANT]
> **Stack:** Astro 7 `output: 'server'` on `@astrojs/node` (`mode: 'standalone'`) + Tailwind v4 via `@tailwindcss/vite`, bun only. Versions per [`AGENTS.md`](../../AGENTS.md) and `bun.lock`.
> **Design:** `hairline` changes value in Phase 2. This is the same class of change already recorded in `DESIGN.md:267-271` for `mute`/`faint`/`link`. The token *name*, *role* and every consumer stay identical; one hex moves, in `global.css` **and** `DESIGN.md`, together. Any plan that adds a *new* token, radius, font or spacing step is out of scope and is a breaking change.
> **Secrets:** never read, parse, grep or commit `.env`, `.env.local` or any `*.env` file. `.env.example` is the only file to touch. `GEMINI_API_KEY` stays server-only. Phase 1 adds **no** key to GitHub and requires no secret of any kind.
> **Risk:** Phase 1 changes the default provider for one deployment target. On the node build nothing changes. On Pages the default becomes BYOK, which is the only provider that can work there — this is a deliberate, user-visible behaviour change and is called out as such.

## Index

1. [Objectives & success criteria](#1-objectives--success-criteria)
2. [Expert analysis](#2-expert-analysis)
3. [Phases](#3-phases)
4. [Progress checklist](#4-progress-checklist)
5. [Execution guide & verification](#5-execution-guide--verification)
6. [Changelog](#6-changelog)

Findings are cited as `D<n>` and resolve to
[plans/data/2026-09-27-defect-evidence.md](data/2026-09-27-defect-evidence.md),
which holds the command output behind each one.

---

## 1. Objectives & success criteria

### 1.1 The problem, in one paragraph

Four reports arrived together from screenshots of the GitHub Pages deployment. They
look unrelated and are not. The site is published as a **static** build
(`D1`), so the process that would read `GEMINI_API_KEY` does not exist there — the
key is fine (`D2`) and the deployment target is the fault. Because the default
provider on that target is the one provider that cannot work (`D3`), the first
thing every visitor does is fail; switching to BYOK is the obvious workaround, and
BYOK then fails while blaming the user's audio format (`D5`), while the button that
promised to verify the key never verifies it (`D6`), behind a format gate that can
reject a live key outright (`D7`). The two visual reports are the same story at a
different layer: light-theme borders measure 1.14:1 (`D9`), so cards read as
unbordered slabs, and one missing margin (`D11`) welds two of them together — a
defect the invisible borders helped hide.

### 1.2 In scope

| # | Change | Findings |
| --- | --- | --- |
| A | Make the static deployment state its own constraint instead of discovering it per request | `D1` `D3` |
| B | Report a rejected API key as a rejected API key, on both providers | `D5` |
| C | Make "Save and test" actually test the key | `D6` `D7` |
| D | Raise light-theme borders to a perceivable, WCAG 1.4.11-compliant value and make the gate enforce it | `D9` `D10` |
| E | Restore the 24px rhythm between stacked panels | `D11` |
| F | Document the three deployment targets and where a secret belongs in each | `D1` `D2` |

### 1.3 Out of scope

- **Choosing or purchasing a hosting provider.** Phase 1 removes the reason the
  question matters and documents the options; it does not provision anything.
- **Rewriting the routing table.** `live-token` and `extract` stay `always-server`.
  They are correct as written, and `provider.test.ts` asserts it.
- **A redesign of the light theme.** One hex changes. Nothing else moves.
- **Touching the Gemini model IDs, the voice roster, or the cost estimate.**
- **Removing the `server` provider.** It remains the default on the node build.

### 1.4 Success criteria

Each is checkable by a command in [§5](#5-execution-guide--verification).

1. `bun run build` and `bun run check` both exit 0, **twice** — once per target
   (`PAGES_TARGET` unset and `PAGES_TARGET=pages`).
2. `bun run check:contrast` exits 0 **and** reports every `border` pair at ≥ 3:1.
3. A bad key entered in the BYOK panel produces copy that names the key, on both
   providers, with no false "audio format" message.
4. The "Save and test" control reports `accepted` / `rejected` / `unreachable`
   without spending quota and without persisting a key that failed.
5. On the static build, a first-time visitor is told the server provider is
   unavailable **before** they interact, and BYOK is the pre-selected option.
6. Every stacked panel on `/` , `/speech-to-text` and `/text-to-speech` has a
   non-zero vertical gap, asserted by a script rather than by eye.
7. `bun run check:secrets` still exits 0, and no `GEMINI_API_KEY` appears anywhere
   in `dist/client/`.

---

## 2. Expert analysis

### 2.1 Industry practice

**Secrets belong to the runtime, not the repository.** A CI provider's secret store
is a *build-time* store: it injects values into a job so that a build can consume
them. GitHub Pages is not a runtime. Its contract is "upload files to a CDN" —
`actions/upload-pages-artifact` accepts a path and serves it. There is no process,
no environment, and therefore nowhere for a secret to be read at request time. The
question "should I paste my key into GitHub?" is the question of someone who has
correctly identified the *symptom* (a key that is not reaching a consumer) and
incorrectly identified the *location* (the one system that provably has no
consumer).

The three real answers, in increasing order of what they cost:

| Target | Where the secret lives | Server routes run? | Cost |
| --- | --- | --- | --- |
| GitHub Pages (today) | **nowhere** — it cannot be used | No | Free |
| Node host (Render / Fly / Railway) | That host's own secret store | Yes | Free tier to ~$5/mo |
| Cloudflare Workers | `wrangler secret put` | Yes, via a different adapter | Free to $5/mo |

Note what is *not* on that list: "GitHub Secrets → Pages". It is not a cheaper
option, because it does not work. The only way to make the Pages build consume a
key is to inline it into a client bundle, which publishes it.

**The correct shape of a multi-target app is target-aware defaults, not target-aware
errors.** The build already knows which target it is producing — `astro.config.mjs`
reads `PAGES_TARGET`, and every page knows `import.meta.env.BASE_URL`. The current
code discards that knowledge at build time and reconstructs it at request time, from
a 404. That is a design choice with a measurable cost: it converts a build-time fact
into a per-request round trip and a user-facing error. The fix is to make the
default provider a function of the target, and to say so once, up front, in the UI
that already exists.

### 2.2 First-principles trade-off

**Fixing the deployment (A) versus fixing the error message (B).** A alone leaves a
user who opens the settings panel still confused. B alone leaves the product
unusable on Pages while producing a nicer message about a server that does not
exist. Both are cheap; neither is sufficient. A is roughly 40 lines across four
files; B is roughly 30 lines in one file plus its test. Doing B first is the
tempting order because it is the smaller diff, and it is wrong: B's new copy is
about a *key*, and on Pages the user's key is not the failing component. Ordering
matters here.

**A regex gate versus a live probe (C).** The regex is free and instant. The probe
costs one non-billable round trip and is subject to CORS. This looks like an easy
trade until you price the regex's failure mode: it rejects *valid* keys, silently,
with copy that says the key is malformed, and its character class is a guess about a
credential format Google changed twice in three months (`D7`). An `AIza` key is
rejected outright from **September 2026** — this month (`D7`, VERIFIED
[ai.google.dev/gemini-api/docs/api-key, fetched 2026-09-27]). The regex's ongoing
maintenance cost against a provider that does not publish a stable key grammar
exceeds the cost of one `models?pageSize=1` call. The repository already made this
exact call at `src/lib/gemini/health.ts:17-25` and documented the reasoning: *"The
probe is not billable… A health check that spends quota is a health check that
manufactures the outage it is looking for."* Phase 1 applies a proven in-repo
decision to the client instead of inventing a second policy.

**Raising the border (D) versus leaving the design system alone.** DESIGN.md freezes
`hairline: #ebebeb` and states the principle it serves: *"Define cards and inputs
with a 1px hairline before any shadow — flat is the default."* Leaving it means a
UI where 1.14:1 is the specified outcome and `check:contrast` prints `warn` on
every run and exits 0. Raising it means overriding a frozen token — which
`DESIGN.md:267-271` already did for three text tokens, recording the substitution in
the document rather than smuggling it. The principle being protected is "flat before
shadow" and "one source of truth per colour"; a *value* change preserves both. A
*token* change would break them. The plan changes only the former.

The alternative worth naming and rejecting: keep `#ebebeb` and add a shadow to every
card. That satisfies visibility without touching the token, and it is worse — it
inverts the system's own stated priority (shadow before hairline), and it is the
exact thing `DESIGN.md:511` says not to do.

### 2.3 Pre-mortem

| Failure | Likelihood | Mitigation |
| --- | --- | --- |
| Changing `hairline` breaks an assumption elsewhere | Low | One hex, one token name. `bun run check:contrast` covers both themes; the gate becomes enforcing, so a regression is caught at build time rather than in a screenshot. |
| BYOK becomes the default on Pages and a visitor is confused by a key field they did not ask for | **Medium** | Mitigated by design, not by hope: the panel is labelled "Optional" today, so a *pre-selected BYOK* is a smaller change than it looks — the key fields are already reachable in one click. The copy is adjusted in the same phase, and `D8`'s scope gap is closed at the same time. |
| The live probe in "Save and test" leaks the key | Low | Same-origin-only concern does not exist: the request is the *same* call `gemini-direct.ts` already makes, with the key in the `x-goog-api-key` header, never a query string. `check:secrets` re-runs over the bundle. |
| Probe is slow on a bad network and the button appears hung | Medium | Explicit `unknown` state with a timeout, not a spinner. Mirrors `health.ts:56` (`unknown` exists precisely so the probe can fail without lying). |
| The `AQ.` regex removal lets garbage into storage | Low | A rejected probe never persists the key. A probe that cannot conclude *does* persist, because the key may be fine and the network may not be — the same reasoning as `unknown` in `health.ts`. |
| The 24px gap assertion is too brittle and blocks future work | Low | Asserts `gap > 0` on a declared list of sibling pairs, not a pixel-perfect 24. A designer changing the rhythm gets a test they can update in one line, which is the point. |
| Fixing all four makes the diff too large to review | **Medium** | Mitigated by phase structure. Phase 0 is additive (a new gate). Phase 1 is provider logic. Phase 2 is two hex values. Phase 3 is one class and one script. Each is independently revertable. |

### 2.4 Ecosystem check

| Constraint | Status |
| --- | --- |
| Astro 7, `output: 'server'` + `@astrojs/node` | Pass — no adapter change. `PAGES_TARGET` switch is read-only. |
| Tailwind v4, `@import 'tailwindcss'`, `@source '../'` | Pass — Phase 2 edits `@theme` values, not utilities. |
| bun only, `bun.lock` untouched | Pass — zero dependency changes in every phase. |
| `DESIGN.md` tokens | **Called out** — `hairline` value changes in `global.css` and `DESIGN.md` together, mirroring the `mute`/`faint`/`link` precedent at `DESIGN.md:267-271`. |
| Zero-trust secrets | Pass — no `.env` read, no new secret, no `PUBLIC_` variable. |
| Existing gates | Pass — `check:contrast`, `check:secrets`, `check:routes`, `check:shell`, `check:panel` all continue to run. Phase 0 *strengthens* one. |

---

## 3. Phases

Run strictly in order. Phase 0 is deliberately first: it adds detection for
`D9` and `D11` before either is fixed, so each fix is proven by a gate that was
already red.

### Phase 0 — Add the gates (additive, no behaviour change)

**Goal.** Make the two visual defects fail in CI before they are fixed, so that
Phase 2 and Phase 3 each close a red test rather than opening a green one.

**Files**

| Path | Action |
| --- | --- |
| `scripts/check-spacing.mjs` | [NEW] |
| `scripts/check-panel.mjs` | [MODIFY] — run the new gate |
| `package.json` | [MODIFY] — add `check:spacing` |
| `.github/workflows/pages.yml` | [MODIFY] — run it in CI |
| `.agents/rules/plan_and_documentation.md` | [MODIFY] — list it as a standing gate |
| `AGENTS.md` | [MODIFY] — list it in the verification paragraph |

**Implementation**

`scripts/check-spacing.mjs` asserts that every declared stack of sibling panels
carries a non-zero vertical gap. It reads the built HTML from `dist/client` (or
`dist/server` for the node target) with a regular expression — no DOM library, no
new dependency — and compares each sibling's closing tag against the next
sibling's opening tag. It must carry a **positive control** in the spirit of the
other gates: it builds a fixture in a temp directory that deliberately omits the
margin, asserts the check *fails* on it, then asserts it *passes* on the real
output. A gate that has never been observed to fail is not a gate.

```js
// Contract, not final code.
// SIBLING_STACKS: parent element id -> ordered child element ids.
const SIBLING_STACKS = [
  { parent: 'main', children: ['tts', 'quota', 'byok'] },          // /text-to-speech
  { parent: 'main', children: ['stt', 'quota', 'byok'] },          // /speech-to-text
];
// For each adjacent pair, assert the child's class list carries a margin utility.
```

`check:contrast` is **not** touched in this phase. It becomes enforcing in
Phase 2, once the token is dark enough to pass — flipping it now would take CI red
for a defect Phase 2 has not fixed yet.

**Dependencies.** None. Must land first.

**Acceptance.** `bun run check:spacing` exits **1** on current `main`, with
`byok` named as the unspaced sibling. This failure is the deliverable.

**Result, 2026-09-27.** Met, and a second defect surfaced on the way.

```
$ $env:PAGES_TARGET = "pages"; bun run build     # BUILD_EXIT=0
$ bun run check:spacing                           # EXIT=1
pass  an unspaced #byok is caught: #byok sits directly below #quota with no top
      margin and no gap on #main. …
FAIL  text-to-speech: #byok sits directly below #quota with no top margin …
FAIL  speech-to-text: #byok sits directly below #quota with no top margin …
2 failure(s). Stacked panels are touching.
```

Two deviations from the plan as written, both deliberate:

1. **The gate asserts a non-zero gap, not `mt-6`.** A stack passes if each
   sibling after the first carries a positive `mt-*`/`my-*` **or** the parent
   carries a positive `space-y-*`/`gap-*`. Both are correct ways to space a
   column; pinning one class name would mean the first deliberate rhythm change
   takes the gate down with a failure that says nothing about spacing. A gate
   that gets edited to accommodate is a gate that stops being run. The second
   positive control exists solely to prove that escape hatch is real.
2. **The real-page check skips on a node build**, printing `skip` and the
   reason. `output: 'server'` renders HTML on demand, so there is no `.html` on
   disk to read. `check:panel` already takes exactly this position for its
   watchdog assertion, and CI builds the static target, so the pages *are*
   asserted — as the red run above proves. A silent skip is the one outcome this
   repo's gates are not allowed to produce.

**D12 — `check:panel`'s own positive control is red on `main`, and it is not
this plan's to fix.** Discovered while wiring the gate in, and it blocks Phase 3's
final acceptance (F.1), so it is recorded here rather than absorbed into Phase 0.

```
$ node <scripts/check-panel.mjs as committed at 0bdc1f8>
pass  typing opens the gate (cost $0.0008)
skip  watchdog not testable on a node build …
pass  a restored textarea opens the gate (cost $0.0008)
=== positive control ===
FAIL  positive control MISSED — the gate opened on a panel with the reconciliation
      removed. This check cannot fail, so it proves nothing.
1 failure(s). The cost gate is not trustworthy.
```

Root cause, measured rather than guessed. The control strips
`resyncEstimate` out of `src/components/TtsPanel.astro` with four `\n`-anchored
regexes (`check-panel.mjs:288-292`). `core.autocrlf` is `true` in this
repository, so the working tree is CRLF:

```
TtsPanel.astro  CRLF=750  bare-LF=0
check-panel.mjs CRLF=367  bare-LF=0
```

`\n\t}\n` cannot match `\n\r\n\t}\r\n`, so three of the four replacements
silently no-op. The only one that survives is the `paste` listener, whose
pattern ends at a bare `\n` inside the line. Net effect: **one line removed out
of the four the control depends on**, `resyncEstimate()` and its on-load call
are still in the build, the gate opens anyway, and the gate reports the honest
and correct verdict — it could not build a control that fails. The
`stripped === original` guard does not catch it precisely *because* one
replacement did match.

The fix is to normalise line endings before stripping (or anchor the patterns
on `\r?\n`) **and** to assert the control removed what it claims to, rather than
only that it changed something. That is a change to `check-panel.mjs`'s control
machinery, which Phase 0 was scoped not to touch, so it is queued as **0.6**
pending approval rather than done here.


---

### Phase 1 — Provider correctness (`D1` `D3` `D5` `D6` `D7` `D8`)

**Goal.** Make the static target state its own constraint, make a rejected key
say so, and make "Save and test" test.

**Files**

| Path | Action |
| --- | --- |
| `src/lib/client/capability.ts` | [NEW] — the build-target fact, in one place |
| `src/lib/client/keystore.ts` | [MODIFY] — target-aware default; drop the regex gate |
| `src/lib/client/gemini-direct.ts` | [MODIFY] — body-aware failure classification |
| `src/lib/client/provider.ts` | [MODIFY] — pass the capability through |
| `src/components/ByokSettings.astro` | [MODIFY] — real test; honest scope copy |
| `src/lib/client/keystore.test.ts` | [NEW] |
| `src/lib/client/gemini-direct.test.ts` | [NEW] |
| `src/lib/client/capability.test.ts` | [NEW] |
| `src/components/FeatureCard.astro` | [MODIFY] — the copy on `/` still says "on the way" |

**1.1 — The capability seam** (`D1` `D3`)

`src/lib/client/capability.ts` is a new zero-import leaf, on the same pattern as
`src/lib/gemini/models.ts`. It exports one question and one answer:

```ts
// True when this bundle was built for a host with no server process.
// Astro rewrites BASE_URL, so a non-empty base means a sub-path deployment —
// which in this project is exactly the Pages target.
export function serverAvailable(): boolean;
```

It must **not** import `astro:env/server` and must be importable from a plain unit
test and from SSR, exactly as `keystore.ts:51-68` guards its storage access.

`keystore.readMode()` then defaults to `'byok'` when `serverAvailable()` is false
and nothing is stored. The `server` option remains selectable everywhere — a
visitor on Pages can still choose it, and gets the honest 501 — because silently
removing a choice is worse than offering one that explains itself.

**1.2 — Honest failure copy** (`D5`)

`gemini-direct.upstreamFailure` currently branches on status alone. It must take
the response body and check it for an authentication reason before falling
through to the generic 400. `health.ts:105-116` is the precedent and the pattern:

```ts
// 400 is overloaded. Google answers a *rejected key* with 400
// API_KEY_INVALID, not 401 — measured 2026-09-27, see evidence D4. So the
// status alone cannot distinguish "your key is wrong" from "your audio is
// wrong", and guessing wrong is what told the user to check their microphone.
// The body is the only thing that can tell them apart.
const KEY_REFUSED = /API[_ ]KEY[_ ]INVALID|API key not valid|PERMISSION_DENIED/i;
```

On a match: *"Gemini rejected this API key. Check the key in this page's
settings."* — and for BYOK only. Under the server provider the existing copy is
already correct, because there the key genuinely is on the server. The branch must
read the mode rather than assume BYOK.

**1.3 — "Save and test" actually tests** (`D6` `D7`)

`looksLikeGeminiKey` (`keystore.ts:48, 75-77`) is **deleted**, along with
`KEY_PATTERN`. Replace the call with a live probe in `ByokSettings.astro`:

- `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1` with
  `x-goog-api-key`. Not `generateContent` — `health.ts:17-25` established that a
  health check which spends quota is a health check that manufactures the outage
  it is looking for, and this app runs on a free tier of ten TTS requests a day.
- Reuse the `classify()` semantics rather than inventing a second mapping. Either
  lift `health.ts:classify` into a shared zero-import module or reimplement the
  three outcomes locally; the plan prefers the lift, because the server path and
  the browser path currently disagree about what a 400 means (`D5`) and that
  disagreement is the bug.
- Three outcomes, all named: `accepted`, `rejected`, `unknown`. `unknown` exists
  so a flaky network reports "could not check" rather than "your key is bad" —
  `health.ts:56` states the same reason for the same state.
- **Persist only on `accepted` or `unknown`.** A rejected key must not enter
  storage: the transport would keep sending it, and the retry predicate cannot
  distinguish a key failure from a content failure, so a bad key would burn the
  user's rate limit on every attempt.

`save` must also gain a `disabled` state while the probe is in flight, and a
`type="button"` it already has. The control's label is already "Save and test";
after this phase it will be true.

**1.4 — Honest scope copy** (`D8`)

`ByokSettings.astro:163-171` currently explains *why* Live is excluded. It must
also state, when `serverAvailable()` is false, that `live-token` and `extract` are
unavailable on this deployment — as a first-class sentence, not a footnote.

`FeatureCard.astro` as used by `index.astro:100-103` says bring-your-own-key is
"on the way". It shipped. That copy is stale and is corrected in the same phase.

**Dependencies.** Phase 0 complete (the gates must exist before anything changes).

**Acceptance.**

- `bun test` green, including three new test files.
- `gemini-direct.test.ts` asserts a 400 with `API_KEY_INVALID` in the body yields
  key-oriented copy under BYOK and `.env`-oriented copy under the server provider.
- `keystore.test.ts` asserts `readMode()` is `'byok'` when `serverAvailable()` is
  false and no preference is stored, and `'server'` otherwise.
- `check:secrets` still exits 0.

**Result, 2026-09-27.** Met, with two additions the plan did not anticipate and
one it did that is worth stating plainly.

**The lift happened, and it found a second copy of the same bug.** `classify`,
`redact` and the key-refusal test moved out of `gemini/health.ts` into a new
zero-import `gemini/classify.ts`, because `health.ts` imports
`astro:env/server` and therefore could not be imported by the browser that had
the bug. Having the predicate in one place immediately exposed that
`gemini/client.ts` — the **server** path — had the identical defect: its
`plainMessage` returned the audio-format sentence for any 400, which made its
own `/API key not valid/i` test on the line below **dead code**. So a revoked
key on the node build was also reported as a microphone fault. The plan's 1.4
assumed only the browser had drifted; both had. Fixed in the same edit, and
`src/lib/gemini/client.test.ts` is new as a result.

**`upstreamFailure` gained a `where: KeyLocation` parameter rather than reading
the mode at runtime.** The browser transport can only run under BYOK, so a
`readMode()` call there would be a branch that cannot be false — untestable
dead code dressed as a decision. Parameterising it instead makes the seam
explicit and lets the test assert both providers' wording, which is what the
phase's acceptance actually asks for. The copy itself now comes from one
`keyRejectedMessage()`, so the two providers cannot drift again.

**The browser path had no `redact` in scope, so upstream text reached the UI
unscrubbed.** A new test caught it: `gemini-direct.test.ts` asserts the failure
`detail` never echoes key material, and it failed. `health.ts` has scrubbed
since Phase 5.1 for the reason recorded in its own header — error bodies do
occasionally echo request headers, and that copy is pasted into bug reports.
Fixed, and it is the same class of drift 1.4 was about.

**D13 — `quota.test.ts` is marginal against bun's 5-second default timeout.**
Discovered while running the phase's own acceptance. The file is **unmodified
by this work** (`git status` on both `quota.ts` and `quota.test.ts` is empty),
and the test passes in isolation with a raised timeout, so it is slow rather
than broken:

```
$ bun test src/lib/client/quota.test.ts
(fail) recordSpend > caps the log so a long-lived tab cannot grow it without bound [5962.29ms]
  ^ this test timed out after 5000ms.
 15 pass  1 fail

$ bun test --timeout 60000 src/lib/client/quota.test.ts
 16 pass  0 fail
Ran 16 tests across 1 file. [3.85s]
```

The cause is arithmetic, not flakiness: 260 sequential `recordSpend` calls, each
re-serialising a log that grows to 200 entries, is quadratic. It passed in the
Phase 0 run on a more heavily loaded machine and fails in a quieter one, which
is the worst way for a test to behave. Fixing it means choosing between a
cheaper fixture and a per-test timeout, and both are changes to a file this
phase was scoped not to touch. Queued as **1.10** pending approval; it blocks
F.2, not this phase's own assertions.


---

### Phase 2 — Light-theme borders (`D9` `D10`)

**Goal.** Move `hairline` from 1.14:1 to ≥ 3:1 against both light surfaces, and
make the gate enforce it.

**Files**

| Path | Action |
| --- | --- |
| `src/styles/global.css` | [MODIFY] — `--color-hairline` light value |
| `DESIGN.md` | [MODIFY] — token table + the Colors section, with the ratio recorded |
| `scripts/check-contrast.mjs` | [MODIFY] — border pairs enter the exit code |

**2.1 — Choose the value by arithmetic, not by eye**

Two constraints bound the answer:

- It must clear **3:1** against `--color-elevated: #ffffff` (the harder surface, so
  this is the binding one).
- It must not fall so far toward `ink` that cards read as outlined boxes and the
  system's "the page reads like documentation" character is lost.

`#8c8c8c` computes to **3.30:1** on white and **3.23:1** on `#fafafa` — comfortably
clearing 1.4.11 with margin, while remaining a hairline rather than a rule. It sits
*below* `--color-faint: #727272` in the grey ladder, so it does not reorder the
ink → body → mute → faint tiering that `DESIGN.md:501-506` depends on.

**The final hex is confirmed by measurement, not by this paragraph.** The phase
does not complete until `bun run check:contrast` prints the new ratio. If the
chosen value does not clear 3:1 on both surfaces, this phase is not done.

`--color-hairline-soft: #f2f2f2` is a **fill**, not a boundary, and stays as it is.
WCAG 1.4.11 does not apply to it and its own docstring
(`check-contrast.mjs:101-105`) already says so. It moves from `info` to
`excluded` in the gate so it stops looking like an unaddressed warning.

**2.2 — Make the gate enforcing**

`BORDER_PAIRS` in `scripts/check-contrast.mjs:101-105` currently prints at `info`
and `warn` and is excluded from `failures`. After the token change:

- `['hairline', 'elevated', 'input border in cards']` → **a failure**.
- `['hairline', 'canvas', 'card border on canvas']` → **a failure**.
- `['hairline-soft', 'elevated', …]` → removed from the table and replaced with a
  comment stating that 1.4.11 does not apply to a fill.

The comment block at `:82-99` is the most important edit in this phase. It is a
rationale for keeping a defect, and a rationale that outlives its defect is
misleading. It gets replaced with the resolution, in the same voice
`DESIGN.md:267-271` uses for the three text tokens.

**2.3 — Record it in DESIGN.md**

`DESIGN.md:13` (`hairline: "#ebebeb"`) and `:285` (the Borders bullet) both change,
and the Colors section gains a note in the form already established at
`DESIGN.md:267-271`. The dark theme is untouched: `--color-hairline: #262626` is
the dark ramp's own value, and it is *perceptually* fine because the perceived step
on a dark field is larger than the ratio suggests (`D9`). Only the light theme is
in scope.

**Dependencies.** Phase 1 complete.

**Acceptance.** `bun run check:contrast` exits 0 with every remaining border pair
at ≥ 3:1; the three previously-`warn`/`info` rows are either passing failures or
deliberate exclusions with a stated reason; `DESIGN.md` and `global.css` agree.

---

### Phase 3 — Panel spacing (`D11`)

**Goal.** Give `ByokSettings` the same 24px top margin its siblings have, and turn
Phase 0's red gate green.

**Files**

| Path | Action |
| --- | --- |
| `src/components/ByokSettings.astro` | [MODIFY] — add `mt-6` to the root `<section>` |
| `scripts/check-spacing.mjs` | [MODIFY] — only if the margin class differs from the declared expectation |

**Implementation.** One class on one element:

```astro
<!--
  `mt-6` is not decoration. `QuotaMeter` is this component's sibling in both
  tool pages, and without a matching margin the two 1px-bordered cards sit
  flush and their borders read as one rule. Phase 2 raised the border to 3:1,
  which is what makes the missing margin visible rather than merely wrong.
-->
<section id="byok" class="mt-6 rounded-card border border-hairline bg-elevated p-6 shadow-whisper" …>
```

`TranscriptView.astro:32` and `AudioResult.astro:22` already carry `mt-6` and are
correct. The gate from Phase 0 exists to prove there is no third instance.

**Dependencies.** Phase 2 complete. Do not do this before Phase 2 — a 24px gap
between two 1.14:1 borders is invisible, and the fix would appear to do nothing.

**Acceptance.** `bun run check:spacing` exits 0 with a **positive control** proven
in the same run. `bun run build` and `bun run check` exit 0 for both targets.

---

### Phase 4 — Documentation sync (`D1` `D2`)

**Goal.** Make the deployment story and the secret story findable, so the next
person does not ask where to put a key.

**Files**

| Path | Action |
| --- | --- |
| `docs/development.md` | [MODIFY] — a "Deployment targets" section |
| `README.md` | [MODIFY] — how to run it; where a secret belongs |
| `AGENTS.md` | [MODIFY] — the new standing gate in the verification list |
| `docs/README.md` | [MODIFY] — run `bun run docs:sync` |

`docs/development.md` gains a table of the three targets — Pages (static, no
server, no key), a node host (`GEMINI_API_KEY` in that host's secret store), local
(`.env`, via `bun run dev` / `bun run start`) — each with the exact command that
proves it is working. The node row cites `/api/health`; the Pages row cites the
BYOK panel's own new probe. That is the point: **one command per target that
answers "is my key working here"**, which is precisely the question that could not
be answered before.

Per `AGENTS.md`, this happens in the same turn as the code changes, not after.

**Dependencies.** Phases 0–3 complete.

**Acceptance.** `bun run docs:sync` exits 0 and the index lists the new plan, this
data folder, and the evidence document. Every command quoted in the new section has
been run in this session.

---

## 4. Progress checklist

```markdown
- [x] **Phase 0: Add the gates (additive, no behaviour change)** — Complete 2026-09-27
  - [x] 0.1: Write `scripts/check-spacing.mjs` with a positive control
  - [x] 0.2: Register `check:spacing` in `package.json`
  - [x] 0.3: Run it from `scripts/check-panel.mjs` and from `pages.yml`
  - [x] 0.4: Add the gate to `AGENTS.md`, `docs/development.md` and `.agents/rules/plan_and_documentation.md`
  - [x] 0.5: Prove it RED on current `main` — `byok` named
  - [x] 0.6: **NEW — not in the plan as written.** Repair `check:panel`'s own positive
        control, which is red on `main` and is a Phase 3 blocker. See `D12` below. **Done.**
- [x] **Phase 1: Provider correctness (D1 D3 D5 D6 D7 D8)** — Complete 2026-09-27
  - [x] 1.1: `capability.ts` + test — build-target fact in one place
  - [x] 1.2: Target-aware `readMode()` default + test
  - [x] 1.3: Body-aware `upstreamFailure` + test (400 → key, not audio)
  - [x] 1.4: Share `classify()` so server and browser agree on a 400
  - [x] 1.5: Delete `looksLikeGeminiKey` and `KEY_PATTERN`
  - [x] 1.6: Real "Save and test" probe — accepted / rejected / unknown
  - [x] 1.7: Persist only on accepted or unknown; disable in flight
  - [x] 1.8: Honest scope copy for the static deployment (D8)
  - [x] 1.9: Fix the stale "on the way" copy on `/`
  - [ ] 1.10: **NEW** — `quota.test.ts` is marginal against bun's 5s default
        timeout. See `D13` below.
- [ ] **Phase 2: Light-theme borders (D9 D10)**
  - [ ] 2.1: Re-measure `hairline`; pick a value ≥ 3:1 on white and canvas
  - [ ] 2.2: Change `--color-hairline` in `global.css`
  - [ ] 2.3: Border pairs enter the `check:contrast` exit code
  - [ ] 2.4: Drop `hairline-soft` from the table as out of scope for 1.4.11
  - [ ] 2.5: Rewrite the rationale comment — it is a resolution, not a defence
  - [ ] 2.6: Record the change in `DESIGN.md` (token table + Colors section)
- [ ] **Phase 3: Panel spacing (D11)**
  - [ ] 3.1: `mt-6` on the `ByokSettings` root section
  - [ ] 3.2: `check:spacing` GREEN, positive control still proven
  - [ ] 3.3: `bun run build` + `bun run check` green on BOTH targets
- [ ] **Phase 4: Documentation sync (D1 D2)**
  - [ ] 4.1: `docs/development.md` — deployment targets and where a secret lives
  - [ ] 4.2: `README.md` — run it; one verification command per target
  - [ ] 4.3: `bun run docs:sync`
- [ ] **Final gate**
  - [ ] F.1: `check:contrast` `check:secrets` `check:routes` `check:shell` `check:panel` `check:spacing` all exit 0
  - [ ] F.2: `bun test` green
  - [ ] F.3: No `GEMINI_API_KEY` in `dist/client/`
  - [ ] F.4: Changelog entry appended below
```

---

## 5. Execution guide & verification

### 5.1 Order of operations

1. **Phase 0 alone, in its own commit.** Nothing else may be in it. Its value is
   the red run; bundling it hides that.
2. Phase 1 — two commits if helpful: 1.1–1.2 (capability) and 1.3–1.9
   (diagnostics). They are independent.
3. Phase 2 on its own. It is a design-system change and should read as one.
4. Phase 3 last, and only after Phase 2 is green.
5. Phase 4 in the same commit as its source change where practical, per
   `AGENTS.md`'s documentation rule.

### 5.2 Commands

```bash
# Standing gates — all must exit 0
bun run check:contrast
bun run check:secrets
bun run check:routes
bun run check:shell
bun run check:panel
bun run check:spacing     # new in Phase 0

# Tests and types
bun test
bun run check

# Both targets
bun run build                                             # node (default)
$env:PAGES_TARGET = "pages"; bun run build; bun run check  # static (Pages)
Remove-Item Env:\PAGES_TARGET

# Server build, end to end — reads .env via the app, never by hand
bun run build && bun run start
Invoke-RestMethod http://localhost:4321/api/health   # expect state "configured"

# No key in the client bundle
Select-String -Path dist/client/**/*.js -Pattern "GEMINI_API_KEY|AIza|AQ\."
```

The last command is the standing proof that the Phase 1 and Phase 2 work did not
open a leak channel. Run it after every build.

### 5.3 Manual acceptance (browser)

| Step | Expectation |
| --- | --- |
| Open the Pages build, never having chosen a provider | BYOK is pre-selected, the server option carries "not available on this deployment", and neither is discovered by an error. |
| Paste a deliberately invalid key, press "Save and test" | Copy names the **key**. The words "audio", "format" and "voice" do not appear. The key is not persisted. |
| Paste a valid key, press "Save and test" | `accepted`, within one round trip, no quota spent. Generate one WAV. |
| Throttle the network to offline, press "Save and test" | `unknown` — "could not check", **not** "your key is wrong". |
| Toggle light / dark, load `/`, both tool pages | Every card, input, select and checkbox row has a visible boundary. |
| Inspect `/text-to-speech` and `/speech-to-text` | Four equal gaps in the panel column. No two cards touch. |
| Tab through `/text-to-speech` in light mode | Every stop shows the 2px `link` focus ring at ≥ 3:1 against its own surface. |
| `agent-browser a11y --tags wcag2a,wcag2aa` on all three routes | No new violations. |

### 5.4 Rollback

Each phase is independently revertable and none depends on a migration or a data
change. Two reversions need care:

- **Phase 2 rollback** restores `#ebebeb` in `global.css` **and** `DESIGN.md` **and**
  reverts the `check-contrast.mjs` gate change. Reverting only the hex leaves a
  permanently red gate; reverting only the gate leaves the token and the docs
  disagreeing. All three move together.
- **Phase 1 rollback** restores the regex gate. A user who saved a key that the
  probe rejected during the Phase 1 window keeps it until their next save; nothing
  else is affected, because a rejected key was never persisted in the first place.

---

## 6. Changelog

| Date | Change |
| --- | --- |
| 2026-09-27 | Plan drafted from four screenshot reports. Evidence collected into [plans/data/2026-09-27-defect-evidence.md](data/2026-09-27-defect-evidence.md): `.env` key confirmed valid via `/api/health`; Google CORS confirmed working from the Pages origin; Google confirmed to answer a bad key with `400 API_KEY_INVALID`; `check:contrast` confirmed light borders at 1.14:1 / 1.19:1. Status: Review-Only. |
| 2026-09-27 | **Phase 0 complete.** `scripts/check-spacing.mjs` added with two positive controls (the defect, and the parent-side escape hatch); `check:spacing` registered in `package.json`; spawned from `check:panel`; added as a CI step in `pages.yml`; documented in `AGENTS.md`, `docs/development.md` and `.agents/rules/plan_and_documentation.md`. Proven RED on a static build with `byok` named on both tool pages. Green at the time of writing: `check:contrast`, `check:secrets`, `check:routes`, `check:shell`, `bun run check` (0 errors), `bun test` (285 pass), `bun run build` on both targets. **D12 recorded**: `check:panel`'s own positive control is red on `main` for a CRLF reason unrelated to this plan; queued as 0.6, blocking F.1. |
| 2026-09-27 | **0.6 complete.** `check:panel`'s positive control now normalises line endings before stripping, restores the file byte-for-byte, and asserts *every* removal removed something instead of merely that the file changed — the `stripped === original` guard could not see a control that was three-quarters stripped. Control proven real again; `TtsPanel.astro` verified restored by SHA-256. |
| 2026-09-27 | **Phase 1 complete.** New: `lib/gemini/classify.ts` (zero-import shared classifier, lifted out of `health.ts` so the browser can use it), `lib/client/capability.ts` (build-target fact), `lib/client/key-probe.ts` (non-billable `models?pageSize=1` probe). Changed: `health.ts` and `client.ts` onto the shared classifier — **which exposed the same dead-400-branch bug on the server path**, not only the browser; `gemini-direct.ts` body-aware with `KeyLocation` and upstream `redact`; `keystore.ts` target-aware `readMode()`, regex gate deleted; `ByokSettings.astro` really tests, tells a static visitor the truth before they press anything, and no longer claims Live "uses the server" when there is none; `index.astro` no longer says BYOK is on the way; `check-secrets.mjs` allowlist extended with a stated reason. Verified: `bun run build` + `bun run check` exit 0 on **both** targets; `check:contrast` `check:secrets` `check:routes` `check:shell` exit 0; `bun test` 343 pass / 1 pre-existing marginal timeout (D13). Static build confirmed to ship `byok` pre-selected, key fields visible, and the two-feature notice. `check:spacing` still red by design — that is Phase 3. |
