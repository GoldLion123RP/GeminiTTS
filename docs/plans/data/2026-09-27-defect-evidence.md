# Defect Evidence — Pages deployment, BYOK, light-theme borders, panel spacing

<!-- desc: Probe output, contrast arithmetic, and source locations for the four defects reported 2026-09-27 from screenshots of goldlion123rp.github.io/GeminiTTS. Every row names the command that produced it. -->

Collected 2026-09-27 by direct inspection of the repository, the live GitHub Pages
deployment, the live Gemini API edge, and the local server build. No `.env` file was
read, opened, parsed, or grepped at any point — the local key is verified through
the application's own `/api/health` endpoint, which reports a state and never
returns key material.

| Report | Finding ID | Status |
| --- | --- | --- |
| 1. `.env` key set but nothing works; asks about pasting it into GitHub | `D1`–`D3` | Root cause identified |
| 2. BYOK also does not work | `D4`–`D8` | Root causes identified |
| 3. Light-mode outlines invisible | `D9`–`D10` | Confirmed by arithmetic |
| 4. Panels touching each other, no space | `D11` | Confirmed in source |

---

## D1 — The deployed site is a static build with no server behind it

**Reported as:** the `.env` key is set but every request fails.

**Observation.** The URL in the screenshot is
`https://goldlion123rp.github.io/GeminiTTS/text-to-speech/`. GitHub Pages serves
files; it cannot execute a Node process.

```
$ gh run list --limit 8 --json conclusion,displayTitle,url
[{"conclusion":"success","displayTitle":"fix(tts): report a panel that fails to load…","url":"…/runs/36268203835"}, …]
```

`.github/workflows/pages.yml:44-45` sets `PAGES_TARGET: pages` at job level, and
`astro.config.mjs:28-36` reads it to flip `output` to `'static'` and set
`base: '/GeminiTTS/'`. In `output: 'static'`, the six routes that carry
`export const prerender = false` (`api/estimate.ts`, `api/extract.ts`,
`api/health.ts`, `api/live-token.ts`, `api/synthesize.ts`, `api/transcribe.ts`) cannot
be prerendered, so they are emitted into `dist/server` — and `pages.yml:92` uploads
only `dist/client`. Nothing on Pages runs them.

**Proof from the live site.** Fetching the deployed HTML returns no `/api/*` route
and no server bundle:

```
$ r = Invoke-WebRequest "https://goldlion123rp.github.io/GeminiTTS/text-to-speech/"
$ [regex]::Matches($r.Content,'/api/[a-z-]+') | … | Sort-Object -Unique     # no output
$ r.Content.Length                                                          # 31220
```

The page's own copy already states this, which is why the screenshots are so
informative — the app is *telling* the user what is wrong and nobody read it:

> "Live draft is off: The live transcript needs the server build, which this
> static demo does not run." — screenshot 2, rendered by
> `src/lib/client/provider.ts:199`

**Consequence.** `GEMINI_API_KEY` is a *server-process environment variable*. On a
static host there is no server process, so the value has nowhere to live. The
`.github/workflows/pages.yml:56-58` comment already says this explicitly.

---

## D2 — The `.env` key is valid; the server build works

This is the finding that answers report 1 completely: the key is not the problem.

```
$ bun run build
$ bun run start          # node --env-file-if-exists=.env dist/server/entry.mjs
[@astrojs/node] Server listening on http://localhost:4321

$ Invoke-RestMethod http://localhost:4321/api/health
{
    "state":  "configured",
    "detail":  "Gemini accepted the key.",
    "checkedAt":  "2026-09-27T04:54:10.834Z"
}
```

`state: "configured"` is the answer `src/lib/gemini/health.ts:105-133` produces only
after Gemini itself accepted the key on a live `models?pageSize=1` call. The key is
live, correctly scoped, and not exhausted.

**Direct answer to "do I paste the key into GitHub somewhere?"** No — and the reason
is not a policy preference, it is arithmetic:

- Adding the key as a GitHub Actions secret changes nothing about what Pages can
  execute. There is no process to receive it.
- Making it a `PUBLIC_` variable so a static bundle could "see" it would inline it
  into `dist/client/*.js`, where any visitor can read it with View Source. That is a
  public key leak and it would also break `bun run check:secrets`.
- GitHub Secrets are the wrong store for this even on a host that *can* run the
  server. The key belongs in that host's own secret store (Cloudflare, Render,
  Fly, Railway), set once, as `GEMINI_API_KEY`.

---

## D3 — The static deploy's default provider is the one provider it cannot serve

`src/lib/client/keystore.ts:146-148` defaults `readMode()` to `'server'`, and
`src/lib/client/provider.ts:67-71` routes `synthesize` and `transcribe` to
`/api/*` whenever the mode is not `byok`. On Pages, `/api/*` is a 404 HTML page.
`provider.ts:189-203` translates that into a 501 with a helpful sentence — after the
user has already typed text, waited, and pressed a button.

So the first thing every Pages visitor does is fail. The deployment target is
knowable at build time (`import.meta.env.BASE_URL` is non-empty only for Pages), and
the default is chosen at runtime from storage that starts empty. That mismatch is
the defect.

---

## D4 — BYOK is architecturally viable on Pages: CORS answers

The hypothesis worth killing first was that the browser cannot reach Google from a
`*.github.io` origin. It can.

```
$ POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent
  headers: x-goog-api-key: <invalid>, Origin: https://goldlion123rp.github.io
→ STATUS 400
  Access-Control-Allow-Origin = https://goldlion123rp.github.io
  Access-Control-Expose-Headers = vary,vary,vary,content-encoding,date,server,content-length
  {
    "error": {
      "code": 400,
      "message": "API key not valid. Please pass a valid API key.",
      "status": "INVALID_ARGUMENT",
      "details": [ { "reason": "API_KEY_INVALID", "domain": "googleapis.com" } ]
    }
  }
```

`Access-Control-Allow-Origin` echoes the Pages origin exactly, and
`Access-Control-Expose-Headers` is present. BYOK on Pages is a working design. The
defects below are in the code around it, not in the platform.

---

## D5 — A rejected key is reported as an audio problem (highest severity)

This is why "BYOK does not work" reads as "BYOK does not work". The user pastes a
key, and the app tells them their *audio format* is wrong.

`src/lib/client/gemini-direct.ts:83-95`:

```ts
function upstreamFailure(status: number, raw: string): Response {
  const response = status === 400
    ? fail('Gemini rejected the request. The audio format, language, or voice may be unsupported.', 502, raw)
    : status === 401 || status === 403
      ? fail('Gemini rejected the API key. Check the key in this page’s settings.', 502, raw)
      : …
```

Compare with the measured answer in D4: **Google returns `400` with
`API_KEY_INVALID` for a bad key.** So:

- A bad key lands in the `400` branch and is reported as *"The audio format,
  language, or voice may be unsupported."* Confidently wrong, and it points the user
  at three things that are all fine.
- The `401`/`403` branch — the only copy that says "check the key" — is **dead code
  against Google's current edge**. The user can never be told the true cause.

`src/lib/gemini/health.ts:105-116` already has this right for the server path: it
special-cases `400` and greps the body for `API_KEY_INVALID`. The browser transport
never learned the lesson. The correct fix is a body sniff, not a status guess, so
that an authentic 400 (`INVALID_ARGUMENT` about a real field) still reports as a
request problem.

---

## D6 — The "Save and test" button never tests anything

`src/components/ByokSettings.astro:125-131` renders the control, and
`:247-262` wires it:

```ts
save?.addEventListener('click', () => {
  const value = keyInput?.value.trim() ?? '';
  if (value.length === 0) { say('Paste a key first.', 'error'); return; }
  if (!looksLikeGeminiKey(value)) { say('That does not look like a Gemini key…', 'error'); return; }
  writeKey(value, remember?.checked ?? false);
  writeMode('byok');
  sync();
  …
  say('Key saved. Test it by generating or transcribing something.');
});
```

The button is labelled **"Save and test"** and performs no test. It runs one regex
against the pasted string and stores it. The user is then told to go and generate
something to find out whether the key works — which is the exact loop that produces
a "BYOK is broken" report. The single cheapest fix in this document is to make the
label true, because the probe is already written and non-billable:
`src/lib/gemini/health.ts:174` uses `models?pageSize=1`, explicitly to avoid
spending quota, and `classify()` is a pure exported function already covered by
`health.test.ts`.

---

## D7 — The key format check is a false-rejector with no security value

`src/lib/client/keystore.ts:48`:

```ts
const KEY_PATTERN = /^(?:AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,})$/;
```

Two problems, in order of severity:

1. **It has no security value.** It guards a credential the visitor pasted into their
   own browser, which is already in their own `sessionStorage`. A format check here
   cannot prevent anything; it can only reject.
2. **Google's live key format is changing underneath it.** VERIFIED
   [ai.google.dev/gemini-api/docs/api-key, fetched 2026-09-27]: all new AI Studio
   keys are now **auth keys** prefixed `AQ.Ab…`; unrestricted `AIza…` keys were
   rejected from **2026-06-19**, and `AIza…` keys are rejected outright from
   **September 2026** — i.e. this month. The regex pins a character class
   (`[0-9A-Za-z_-]`) and a minimum length that the provider never contracted to.
   Any auth key containing a character outside that class is refused with "That
   does not look like a Gemini key", and a valid key is then indistinguishable from
   a typo.

The commit history shows this exact class of bug already bit once —
`21df3b3 fix(byok): accept AQ. auth keys — the AIza-only check locked out every
current key`. Widening the regex again treats the symptom. Replacing the check with
a live probe (D6) removes the failure mode entirely.

---

## D8 — A mode the UI offers can be reached but is never verified

`src/lib/client/provider.ts:52-58` pins `live-token` and `extract` to
`always-server` — correctly, because the Live WebSocket can only authenticate via
`?key=` and the file extractors need Node (`mammoth`/`unpdf`). On Pages both are
guaranteed to fail, and `provider.ts:195-200` does say so in plain language.

The residual defect is that the BYOK panel's scope statement
(`ByokSettings.astro:163-167`) frames the Live exclusion as a *design* boundary and
never mentions that on a static deployment *two* of the five endpoints are simply
absent. A visitor reading the security list concludes BYOK covers the page.

---

## D9 — Light-theme borders are 1.14:1 against the canvas

`bun run check:contrast` already computes the answer and already reports it. It
exits 0 anyway.

```
$ bun run check:contrast
=== LIGHT — text (bar 4.5:1) ===
pass   17.18:1  headings, wordmark on canvas
…
=== LIGHT — borders (reference 3:1, advisory) ===
info    1.14:1  card border on canvas
warn    1.19:1  input border in cards
info    1.12:1  selected / inset fill

=== DARK — borders (reference 3:1, advisory) ===
info    1.31:1  card border on canvas
warn    1.22:1  input border in cards
info    1.06:1  selected / inset fill

All pairs pass.                       # exit 0
```

The tokens are `src/styles/global.css:65-66`:

- `--color-hairline: #ebebeb` on `--color-canvas: #fafafa` → **1.14:1**
- `--color-hairline: #ebebeb` on `--color-elevated: #ffffff` → **1.19:1**

WCAG 2.1 SC 1.4.11 (Non-text Contrast) requires **3:1** for the visual boundary of
a UI component. 1.14:1 is not a subtle hairline; it is below the threshold of
detectable by many users at any display calibration, and it is why every card in
screenshot 1 reads as an unbordered white slab.

Why the dark theme looks fine while light does not, and why nobody noticed: the dark
`--color-hairline: #262626` sits on `--color-elevated: #141414` and *is* visible to
the eye even at 1.22:1, because the perceived step is larger on a dark field. The
same token value produces two different perceived results, which is why a visual
review and a contrast script disagree here.

**The gate is the real bug.** `scripts/check-contrast.mjs:82-105` deliberately
excludes border pairs from the exit code and prints them as `info`/`warn`, on the
stated grounds that a 1px hairline is DESIGN.md's intent. That reasoning holds for a
*decorative divider*. It does not hold for a text input or a `<select>`, whose
border is frequently the only thing marking the hit area — which the script's own
comment concedes at `:93-99` before waving it through as a "known gap". A known gap
that is still reported as a pass is a gap that will never close.

---

## D10 — The token change needed to fix D9 is a design-system change

`DESIGN.md:13` and `DESIGN.md:285` both fix `hairline: "#ebebeb"`, and
`DESIGN.md:501-504` states the rule the value serves: *"Define cards and inputs with
a 1px hairline (`{colors.hairline}`) before any shadow — flat is the default."*

`DESIGN.md:267-271` sets the precedent this project already follows for exactly
this situation. Three light-theme text tokens (`mute`, `faint`, `link`) failed WCAG
AA, were changed, and the substitution was recorded in DESIGN.md rather than slipped
in:

> "…only its illegible floor was lifted."

The same argument applies to `hairline`, and the plan extends that precedent rather
than inventing a policy. A new value is **not** a new token — the token name, role,
and every component that references it stay identical; only one hex changes, in both
`global.css` and `DESIGN.md`, which is what "frozen" is protecting against: two
sources of truth for one colour.

---

## D11 — `ByokSettings` has no top margin, so it welds to the panel above it

Screenshot 3, red box: an empty bordered band between the "Requests today" panel and
the "Optional / Use your own Gemini key" panel.

`src/pages/text-to-speech.astro:32-36` and `src/pages/speech-to-text.astro:38-42`
render the same three siblings in the same order:

```astro
<main id="main" class="container-page pb-24">
  <TtsPanel />       <!-- rounded-card border …  no margin -->
  <QuotaMeter />     <!-- mt-6  ✓ -->
  <ByokSettings />   <!-- rounded-card border …  NO margin  ✗ -->
</main>
```

- `src/components/QuotaMeter.astro:37` — `class="mt-6 rounded-app border …"`
- `src/components/ByokSettings.astro:26` — `class="rounded-card border border-hairline bg-elevated p-6 shadow-whisper"` — **no `mt-*`**

Three of the four gaps in that column are 24px. The last one is 0px, so two
1px-bordered cards sit flush and their borders merge into a single rule. In light
mode the merged rule is 1.14:1 and the seam is essentially invisible; in dark mode
it reads as one malformed box, which is what the screenshot shows.

This is the exact class of bug that only a layout assertion catches. Nothing in
`astro check`, `bun test`, or `check:panel` looks at vertical rhythm.

Note the second-order effect, which is why D9 makes this worse rather than merely
co-existing with it: with 1.14:1 borders, removing the margin is nearly free
visually, which is why it survived review. Fix the border and the missing margin
becomes an obvious defect instead of a subtle one.

---

## Summary of the causal chain

```
Deployment target is static (D1)
        │
        ├─► .env key is never loaded → but the key is fine (D2)
        │
        └─► default provider is the one that cannot work (D3)
                    │
                    └─► user switches to BYOK to work around it
                                │
                                ├─► bad key → "audio format is wrong" (D5)  ← what the user sees
                                ├─► good key, but "Save and test" never tests (D6)
                                └─► key format gate may reject a valid key (D7)

Light-mode borders 1.14:1 (D9)  →  cards read as unbordered slabs
No margin on ByokSettings (D11) →  two cards weld into one box
                                     (D9 is what let D11 survive review)
```

D5, D6 and D7 are independent defects that all terminate in the same user-visible
symptom. Fixing any one of them alone will not make BYOK appear to work.
