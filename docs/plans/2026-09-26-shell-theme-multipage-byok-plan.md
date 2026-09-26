<!-- desc: Four-tier plan for the app shell (header/footer), the tri-state theme, the three-page split, and a browser-direct BYOK mode. -->
Status: In Progress (Phase 0 complete, gate passed) | Doc-Type: Full

# App Shell, Theme, Multi-Page Split & Browser-Direct BYOK — Implementation Plan

> [!IMPORTANT]
> **Stack (unchanged):** Astro 7 `output: 'server'` on `@astrojs/node` standalone, Tailwind v4 via `@tailwindcss/vite`, bun only, Node >= 22.12.0. Versions per `package.json` / `bun.lock`.
> **Design tokens are frozen in `DESIGN.md`.** Dark mode is a *token-set extension* — see §2.1. It is a breaking change to the design system and is called out explicitly, not slipped in.
> **Secrets:** never read, parse, or commit `.env*`. The server key stays server-only. The BYOK key is a *user* key and must never reach our server or our logs.
> **This plan is review-only.** Per `.agents/rules/plan_and_documentation.md`, no Tier-3 phase is executed in the turn the plan is written.

> [!CAUTION] — **The chosen BYOK design contradicts Google's own published guidance, and this must be settled before any BYOK code is written.**
> Google's API-key documentation states under "Critical security rules": *"Never expose keys client-side in production: Do not hardcode API keys directly in web or mobile apps… To secure client-side apps, run a backend proxy server to make the actual API calls."*
> **VERIFIED** [ai.google.dev/gemini-api/docs/api-key, fetched 2026-09-26].
>
> The user-selected design — browser → Gemini directly, key never touching our server — is the deliberate opposite of that guidance. It is a legitimate product choice (it gives us a zero-knowledge claim that is actually true, and it removes our key from the trust boundary entirely), but it must be an **informed** choice. **Phase 0 has now measured all three pillars — see the Phase 0 verdict below. CORS: PASS. WebSocket: key must be a query parameter, so Live is excluded from BYOK. Portability: PASS. BYOK is now buildable as designed.**
>
> 1. **CORS — RESOLVED, works.** VERIFIED empirically from a real `http://localhost` origin on 2026-09-26: the preflighted `x-goog-api-key` request returns a readable `400 API_KEY_INVALID`, and the wire response carries `access-control-allow-origin` echoing the origin. A refusal would have surfaced as a `TypeError` instead.
> 2. **WebSocket auth — RESOLVED, and it is the one real cost.** VERIFIED: the Live handshake completes with no key at all, so auth is in-band and a browser cannot supply a header. The key must ride in `?key=`, which puts it in history and intermediary logs. **Live is therefore excluded from BYOK** and stays on the server-minted ephemeral token.
> 3. **The docs also confirm two things that help us:** new AI Studio keys have been **auth keys** since 2026-05-28, and auth keys have *"fast-acting leaked key enforcement"* plus *"granular access control"* and are *"restricted to the Generative Language API (Gemini API) by default"* — **VERIFIED** [same source]. Unrestricted standard keys are now *rejected*. So the leaked-key blast radius for a browser-held key is materially smaller than it was a year ago, and the user is told to restrict to Gemini-API-only.
>
> **Ruling carried into the plan:** BYOK ships as an **opt-in mode that degrades to the server key**. Phase 0 returned a **go**: CORS works, the audio pipeline is portable, and the single gap (Live) is confined to one feature. The Option B proxy fallback remains documented but is not needed.

> [!WARNING] — **Free-tier quota is the binding constraint on the STT verification this project still owes.** The previous plan's largest open item is that the speech-to-text path has never been proven end-to-end against the real API, and that Smart mode may be silently downgrading to Verbatim. The user's chosen scope includes closing it. Repo memory records the free tier as **10 TTS requests/day + 3/min**, and calibration work burned requests until a 429. Sequencing matters: quota-expensive verification runs **last**, after the free work, or it starves.

---

## 1. Objectives & Success Criteria

### 1.1 The five requests, answered

| # | Request | Answer | Phase |
| --- | --- | --- | --- |
| 1 | "Where is header footer?" | There is no header. `src/layouts/Layout.astro` renders only `<head>` + `<slot />`; the footer is inlined in `index.astro` and belongs to no layout. Both become real components in the layout. | 1 |
| 2 | Theme toggle | Tri-state light / dark / system, persisted, no flash-of-wrong-theme. Requires a dark token set. | 2 |
| 3 | Multi pages | `/` becomes a landing page; `/speech-to-text` and `/text-to-speech` own the tools. | 3 |
| 4 | BYOK | Browser-direct, key in `localStorage`, opt-in, clearable. **Gated on the Phase 0 spike.** | 0, 4 |
| 5 | "Other expert things" | Accessibility pass, client-side quota meter, STT end-to-end verification, `/api/health` + retry/backoff. | 5, 6 |

### 1.2 In scope

- `SiteHeader.astro`, `SiteFooter.astro`, `ThemeToggle.astro` as layout-level components.
- A dark colour token set in `DESIGN.md` + `global.css`, applied via a `data-theme` attribute on `<html>`.
- Three routes; tool panels move out of `index.astro`; a feature grid lands on `/`.
- A `provider` concept (`'server' | 'byok'`) resolved **client-side**, with a BYOK settings surface.
- A client-side request budget (quota meter) keyed per provider.
- `GET /api/health` distinguishing *unconfigured* from *misconfigured* from *quota-exhausted*.
- The real STT recording, which closes the inherited open item.

### 1.3 Out of scope (explicit)

- Accounts, sessions, any server-side persistence of a user key. There is no database in this project and this plan does not introduce one.
- Sync of BYOK key or history across devices — "device only" is the product requirement.
- IndexedDB history of generated audio (considered, deprioritised — see §2.4).
- Any change to the audio pipeline: `chunk.ts`, `wav.ts`, `estimate.ts`, and the measured per-script speaking rates are untouched.
- A CI workflow. There is none today and adding one is a separate decision.

### 1.4 Success criteria

1. `bun run build` and `bun run check` both pass, output pasted.
2. `bun test` count does not regress below the current 148 passing / 408 assertions.
3. Theme is correct on first paint with **zero** flash, on all three routes, and survives reload.
4. Keyboard-only traversal of header → nav → panels works; every interactive element has a visible focus ring at 2px `rgb(0, 112, 243)`.
5. **Secret gate, with a positive control:** no user key in `dist/`, no user key in any server log, no user key in any request to our own origin.
6. `/api/health` returns a machine-readable state that distinguishes the three failure modes the current 500 conflates.
7. One real STT generation recorded, its mode confirmed, and the inherited open item closed in the old plan's changelog.

---

## 2. Expert Analysis

### 2.1 Dark mode is a design-system change, and here is the correct way to do it

**First principles.** The current system hardcodes 21 colour tokens in `@theme` and every component references them by name (`bg-elevated`, `text-ink`, `border-hairline`). That is the *right* architecture and it is why theming is cheap — the names are already the seam. The mistake to avoid is re-declaring `@theme` values inside a `.dark` block; `@theme` is build-time and unconditional, so that silently does nothing.

**The ruling:** introduce **semantic surface tokens** that the existing names alias. Concretely, add `--color-surface-canvas`, `--color-surface-elevated`, `--color-surface-border`, and a text ramp, and have `bg-canvas` resolve through them. Then dark mode is one attribute-scoped block.

Cost, stated honestly: this touches every component that names a colour directly. It is a **medium refactor with a wide blast radius**, and doing it lazily (ad-hoc overrides per component) is how dark modes rot. Doing it once, at the seam, is cheaper than doing it badly twice.

**A real constraint the DESIGN.md rules impose:** DESIGN.md confines colour to the hero mesh and forbids a second decorative system. A dark theme must therefore darken **surfaces, ink, and hairlines** and leave the mesh gradient alone. The mesh is already built from `color-mix`/radial stops that work on dark; the mesh is the one thing that does *not* need a dark variant. That is a genuine simplification.

**Honest gap:** a full dark ramp is a perceptual judgement, not a mechanical inversion. The plan ships a *proposed* ramp derived from the light one (inverted lightness, same hue families, hairlines desaturated rather than pure-white) and marks it as **needing a visual review pass**. I will not claim the ramp is validated; I cannot see the rendered page from here.

### 2.2 BYOK transport: three options, one recommended, one fallback

| Option | Key touches our server? | CORS risk | Effort | Verdict |
| --- | --- | --- | --- | --- |
| **A. Browser → Gemini direct** | No | **VERIFIED working (Phase 0.1)** | Medium | **Selected — gate passed** |
| B. Per-request header proxy, never stored | Yes, in transit | None | Low | Fallback if A fails |
| C. Browser → our server → Gemini, same as B | Yes | None | Low | Identical in practice to B |

The honest framing: **A and B differ in trust model, not in user-visible capability.** A means our server is not in the path of the user's credential at all — a genuinely strong claim for a privacy-positioned tool. B means our server sees the key in a request header and must therefore be trusted with it, which is exactly the thing the user is trying to avoid, and which our access logs make worse.

**Resolved by measurement:** A is viable. CORS works, so the zero-knowledge claim is real and achievable. The one concession is that the Live WebSocket stays server-side (§0.2), which narrows A's coverage to STT and TTS.

So the real question is: **is the zero-knowledge claim worth the CORS risk?** If Phase 0 proves CORS works, yes, unambiguously. If it does not, the claim is unachievable and the plan degrades to B with an honest UI label ("your key is sent to our server for this request and never stored") rather than a claim it cannot keep.

**Pre-mortem, option A — now resolved by measurement in Phase 0:**
- *Preflight rejection* — **DID NOT OCCUR.** VERIFIED: the preflight is answered and `access-control-allow-origin` echoes the origin. This was predicted as the single most likely failure and it did not happen.
- *Referer leakage* — **CONFIRMED, but scoped.** Real only on the Live WebSocket, which requires a query parameter. Resolved by excluding Live from BYOK rather than by accepting the leak. STT and TTS carry the key in a header and are unaffected.
- *The server pipeline cannot be reused* — **DID NOT OCCUR for the audio path.** VERIFIED: `wav.ts` and `chunk.ts` have no Node imports and travel to the client unchanged, as does `estimate.ts` via its single dependency. The residual cost is narrower than estimated: only `mammoth`/`unpdf` document extraction and the `prompts/` structure are server-bound.
- *Free-tier RPD is per project, not per key* — **VERIFIED** [ai.google.dev/gemini-api/docs/rate-limits, fetched 2026-09-26]. So a user's key and ours draw on the same project budget if they are the same project. This does not break BYOK, but it means the quota meter must count **requests the user made through us**, not assume a key implies a fresh budget.

### 2.3 Theme no-flash: the only mechanism that works

A `<script>` in `<head>`, inline and synchronous, that reads the persisted value and sets `data-theme` **before first paint**. This is the standard approach and it is the *only* one that works: a module script is deferred and runs after the HTML is parsed, which is after first paint. Astro's `<script>` hoisting and `is:inline` semantics must be verified against the installed Astro version rather than assumed — flagged as an implementation detail for Phase 2.1.

Defaults matter: `system` must be the default, so a first-time visitor with an OS dark preference gets dark, and `prefers-color-scheme` is re-listened via `matchMedia` change events only while the value is `system`.

### 2.4 First-principles trade-offs on the "expert extras"

- **Accessibility pass — in, and it is not optional.** DESIGN.md already commits to focus visibility and the reduced-motion block already exists in `global.css`. The additions are a skip link, `aria-current="page"` on nav, a real focus trap for any dialog, and checking that the `recording` pulse and mesh respect reduced motion. The mesh is a `blur(48px)` static layer and the pulse is already covered by the existing media query.
- **Quota meter — in, but honestly scoped.** A *client-side* counter cannot know the server key's real quota; it is a **local spend log and a nudge, not a rate limiter.** Labelling it "requests this device made" is the only truthful framing. The real limits are per-project RPM/RPD/TPM and reset at midnight Pacific — **VERIFIED** [rate-limits, fetched 2026-09-26] — and our own server cannot see a BYOK user's spend at all.
- **`/api/health` — in, highest value-per-line of anything here.** The single most expensive confusion in this project's history is a 500 that says "key not set" when the key is actually fine, because the standalone server does not load `.env` (repo memory, verified twice). A route that reports *configured* vs *configured-and-valid* vs *quota-exhausted* converts a 40-minute diagnosis into a 5-second one.
- **STT end-to-end — in, but sequenced last** for the quota reason in the header caution.
- **IndexedDB audio history — out.** It is a real feature, it is not requested, and it competes for the same quota budget. Recorded in §2.4 as a deliberate deferral, not an oversight.

### 2.5 Competitive/UX benchmarking

Private-mode TTS tools ( ElevenLabs, Murf, PlayHT, Google AI Studio) all converge on the same three things this plan should match: a **two-column text/preview layout**, a **voice picker that is the centre of gravity** of the page, and **immediate playback with a download button**. The current `TtsPanel` already has the voice picker and download. What they all have and we do not is a **persistent shell** — nav, footer, and a way to move between tools without going back to a landing page. That is precisely requests 1 and 3, and it is why they belong in the same phase.

---

## 3. Phases

Each sub-phase lists goal, affected files, details, dependencies. `[NEW]` / `[MODIFY]` / `[DELETE]` as per the rules.

### Phase 0 — BYOK feasibility spike (BLOCKING GATE)

**0.1 Prove or disprove CORS from a real browser.**
- **Files:** none committed. Scratch under `docs/.scratch/`, deleted after.
- **Detail:** stand up a minimal page that issues a preflighted `fetch` to `https://generativelanguage.googleapis.com/v1beta/models` with `x-goog-api-key`, using a throwaway key. Record the browser's verdict verbatim. **Also test the `v1beta` vs `v1` base** and the streaming response path, because TTS needs a streamed binary read.
- **Output:** a recorded PASS/FAIL. FAIL → the plan's transport is Option B and §3 Phase 4 changes transport only.
- **Depends on:** nothing. This runs first because it can invalidate Phase 4.

**0.2 Settle the Live-API WebSocket question.**
- **Detail:** determine whether the browser WebSocket path can authenticate by header, or whether the key must be a query parameter. If query-only, record the hygiene cost (history, `Referer`, proxy logs) and get an explicit ruling on whether BYOK is allowed for Live at all. **Recommendation: keep Live on the server-minted ephemeral token even under BYOK**, and say so in the UI — it is a small capability gap for a large security win.
- **Depends on:** 0.1.

**0.3 Portability audit of the audio pipeline.**
- **Detail:** confirm `wav.ts` and `chunk.ts` are free of Node built-ins so they can move client-side. Record the finding; if they are not portable, the browser-direct TTS path re-implements them and Phase 4 grows.
- **Depends on:** nothing.

**Gate:** 0.1 PASS **and** 0.2 answered **and** 0.3 recorded. Otherwise the plan is amended before Phase 4.

#### Phase 0 verdict — 2026-09-26 — **GATE PASSED, all three sub-phases**

**0.1 — CORS: PASS. VERIFIED empirically, not from docs.** Probed from a real `http://localhost` origin against both `v1beta` and `v1`:
- Unauthenticated `GET /models` → `403 PERMISSION_DENIED`, body **readable by JS**.
- With the `x-goog-api-key` header (forces the preflight) → `400 API_KEY_INVALID`, body **readable by JS**. A CORS refusal would have rejected with `TypeError`; instead the real upstream error came through.
- Wire-level capture shows `access-control-allow-origin: http://localhost:64943` on both responses, confirming the preflight is answered.

**Correction to the probe itself:** the probe page's own `res.headers.get('access-control-allow-origin')` printed `(absent)`. That read was wrong — Playwright's wire capture shows the header *is* present. The origin echo is confirmed; the in-page display is the unreliable half. Recorded because a tool that misreports is worse than no tool, and the first browser-only reading was nearly taken as the verdict.

**0.2 — Live WebSocket: query parameter required. VERIFIED.**
- The handshake **completes with no key at all** (`OPEN`, code `1000` on close) — so there is *no* handshake-level auth, and the browser cannot be relying on a request header.
- Sending a setup frame with the key in `?key=` produced `CLOSE 1007 reason="API key not valid. Please pass a valid API key."` — the key demonstrably reached the server.
- `new WebSocket()` cannot set request headers, so **the key must ride in the query string**, landing in history and any intermediary log. The pre-mortem risk predicted in §2.2 is confirmed real, not hypothetical.
- **Ruling carried into Phase 4: Live stays on the server-minted ephemeral token, even under BYOK.** The Live socket is the one surface where browser-direct would put the key in the URL. BYOK covers STT and TTS; the UI states this limitation rather than hiding it. This is a deliberate, recorded capability gap.
- Cost: **zero quota consumed** — an invalid key fails authentication before any generation is billed.

**0.3 — Portability: PASS.** `wav.ts` and `chunk.ts` contain no Node built-ins — `Uint8Array`, `DataView`, and string/regex work only, with zero `import` statements. Both move to the client unchanged under BYOK, as do their tests. `estimate.ts` depends only on `chunk.ts` and therefore also travels. The reimplementation risk raised in §2.2 did not materialise.

### Phase 1 — App shell: header and footer

**1.1 Extract the footer.**
- **Files:** `src/components/SiteFooter.astro` `[NEW]`, `src/pages/index.astro` `[MODIFY]`.
- **Detail:** move the existing footer markup verbatim — canvas, top hairline, `text-body`, 14/20, `py-16` inner, per DESIGN.md `components.footer`. Extend it with a link column once routes exist in Phase 3. **Do not restyle during the move**; a move that also changes pixels cannot be reviewed.

**1.2 Build the header.**
- **Files:** `src/components/SiteHeader.astro` `[NEW]`.
- **Detail:** wordmark → `/`; nav links Home / Speech to text / Text to speech; `aria-current="page"` on the active route; mobile collapse behind a menu trigger with correct `aria-expanded` / `aria-controls`; skip link as the first focusable element. Tokens only: `border-hairline`, `bg-canvas`, `rounded-app` for the app-chrome buttons per DESIGN.md's bimodal radius language. Sticky, with a hairline bottom border.

**1.3 Wire both into the layout.**
- **Files:** `src/layouts/Layout.astro` `[MODIFY]`.
- **Detail:** `<SiteHeader />` before `<slot />`, `<SiteFooter />` after, so all three routes inherit them. Add the skip-link target `id="main"`.
- **Depends on:** 1.1, 1.2.

### Phase 2 — Theme

**2.1 Semantic surface tokens.**
- **Files:** `DESIGN.md` `[MODIFY]`, `src/styles/global.css` `[MODIFY]`.
- **Detail:** add `--color-surface-*` to `@theme`; re-point `--color-canvas` / `--color-elevated` / `--color-hairline` and the text ramp through them. **This is the breaking design-system change** and DESIGN.md must be updated in the same turn per the docs rule.
- **Depends on:** Phase 1 (so contrast can be reviewed against the real header and footer).

**2.2 Dark ramp + `data-theme`.**
- **Detail:** one `[data-theme='dark']` block overriding the surface tokens. Mesh gradient untouched. **Marked as needing a visual review pass — I cannot validate a perceptual ramp without seeing it rendered.**

**2.3 No-flash script + toggle.**
- **Files:** `src/components/ThemeToggle.astro` `[NEW]`, `src/layouts/Layout.astro` `[MODIFY]`.
- **Detail:** inline synchronous head script setting `data-theme` from `localStorage` before paint; default `system`; `matchMedia('(prefers-color-scheme: dark)')` listener active only in `system` mode; tri-state control with `aria-pressed` / radio semantics.

**2.4 Audit every component against both themes.**
- **Detail:** any hardcoded hex or any `text-faint`/`text-mute` whose contrast fails on the dark surface gets corrected here, not deferred.

### Phase 3 — Multi-page split

**3.1 `/speech-to-text`** `[NEW]` — hero band + `SttPanel`. **3.2 `/text-to-speech`** `[NEW]` — hero band + `TtsPanel`. **3.3 `/`** `[MODIFY]` — landing: hero, 2-up feature-card grid (DESIGN.md `{components.feature-card}`), the two tool CTAs as marketing pills, a short BYOK explainer, footer. Panels are removed from `/`.

**Detail:** tool pages get a slimmer hero — the `{spacing.section}` 128px band is a *marketing* hero, and a 128px band above a working tool wastes a viewport. Uses a reduced band, documented as a deliberate departure.

**Depends on:** Phase 1, 2 (the header must link pages that exist).

### Phase 4 — BYOK

**4.1 Provider abstraction.** `src/lib/client/provider.ts` `[NEW]` — resolves `server` vs `byok` from storage; a single `request()` seam so swapping the transport later touches one file.

**4.2 Key storage.** `src/lib/client/keystore.ts` `[NEW]` — `localStorage`, **session-only by default**, opt-in "remember on this device", explicit clear button, `autocomplete="off"`, `type="password"`, never logged, never in a URL, cleared on provider change.

**4.3 Transport.** `src/lib/client/gemini-direct.ts` `[NEW]` — or `gemini-proxy.ts` per the Phase 0 verdict. Reuses `wav.ts`/`chunk.ts` if 0.3 allowed.

**4.4 Settings UI.** `src/components/ByokSettings.astro` `[NEW]` — paste key, test-connection button, remember checkbox, clear button, and a plain-language security statement that is **true**: what is stored, where, and what leaves the device.

**4.5 Migrate the panels** to the provider seam, keeping the server path as the default so a user with no key sees today's behaviour unchanged.

**4.6 Secret gate.** Re-run the `dist/` scan **with a positive control** (repo memory: `Select-String -Path "dist\**"` silently matched 1 of 45 files and produced a false pass twice). Also assert the user key never appears in a request to our own origin.

### Phase 5 — Resilience and diagnostics

**5.1 `GET /api/health`** `[NEW]` — `configured` | `missing` | `invalid` | `quota_exhausted`, with a redacted detail. No key material, ever.

**5.2 Retry with exponential backoff + jitter**, only on `429`/`503`/network — **VERIFIED** [troubleshooting, fetched 2026-09-26]: retry on transient, never on `400`/`402`/`403`, max attempts, jitter.

**5.3 Quota meter** — client-side, honestly labelled as a local spend log (§2.4).

**5.4 Accessibility pass** — skip link, `aria-current`, focus trap, reduced-motion, contrast on both themes, keyboard-only traversal. Load the `web-design-guidelines` skill.

### Phase 6 — Verification

**6.1 Gates:** `bun run build`, `bun run check`, `bun test`. Paste real output. **6.2 Browser matrix:** light/dark/system × 3 routes, no flash on reload. **6.3 Keyboard-only run.** **6.4 Responsive** at the DESIGN.md breakpoints (640 / 768 / 1024 / 1200). **6.5 Secret grep with positive control.** **6.6 The real STT recording** — one recording against the live API, confirming whether Smart mode is honoured or silently downgraded to Verbatim. **Runs last, quota permitting.** **6.7 Update `AGENTS.md` / `docs/README.md` / the old plan's changelog** and close the inherited open item.

---

## 4. Progress Checklist

- [x] **Phase 0 — BYOK feasibility (BLOCKING) — COMPLETE 2026-09-26, GATE PASSED**
  - [x] 0.1 CORS spike from a real browser — **PASS**, VERIFIED
  - [x] 0.2 Live WebSocket auth question settled — query param required; **Live excluded from BYOK**
  - [x] 0.3 `wav.ts` / `chunk.ts` Node-freedom audit — **PASS**, portable
- [x] **Phase 1 — Shell — COMPLETE 2026-09-26**
  - [x] 1.1 Extract `SiteFooter.astro` (no restyle)
  - [x] 1.2 `SiteHeader.astro` with `aria-current` + skip link
  - [x] 1.3 Both mounted in `Layout.astro`, `#main` target
- [ ] **Phase 2 — Theme**
  - [ ] 2.1 Semantic surface tokens (`DESIGN.md` updated same turn)
  - [ ] 2.2 Dark ramp + `data-theme`, mesh untouched
  - [ ] 2.3 No-flash head script + tri-state toggle
  - [ ] 2.4 Contrast audit of every component, both themes
- [ ] **Phase 3 — Pages**
  - [ ] 3.1 `/speech-to-text`
  - [ ] 3.2 `/text-to-speech`
  - [ ] 3.3 `/` landing with feature grid; panels removed
- [ ] **Phase 4 — BYOK**
  - [ ] 4.1 Provider abstraction + single `request()` seam
  - [ ] 4.2 Keystore: session default, opt-in persist, clear
  - [ ] 4.3 Transport per Phase 0 verdict
  - [ ] 4.4 Settings UI with a *true* security statement
  - [ ] 4.5 Panels migrated; server path still the default
  - [ ] 4.6 Secret grep **with positive control**
- [ ] **Phase 5 — Resilience**
  - [ ] 5.1 `/api/health` four-state, redacted
  - [ ] 5.2 Backoff + jitter, transient errors only
  - [ ] 5.3 Quota meter, honestly labelled
  - [ ] 5.4 Accessibility pass
- [ ] **Phase 6 — Verification**
  - [ ] 6.1 `build` + `check` + `test` output pasted
  - [ ] 6.2 Theme × route matrix, no flash
  - [ ] 6.3 Keyboard-only traversal
  - [ ] 6.4 Responsive at 640 / 768 / 1024 / 1200
  - [ ] 6.5 Secret grep with positive control
  - [ ] 6.6 **Real STT recording — settles Smart mode**
  - [ ] 6.7 Docs updated; inherited open item closed

---

## 5. Execution Guide & Verification

**Order is strict:** Phase 0 → 1 → 2 → 3 → 4 → 5 → 6. Phase 4 must not start before Phase 0 closes. Phase 2's token refactor must not start before Phase 1, so contrast can be judged against the real chrome.

**Rollback:** each phase is additive and independently revertible. Phase 2 is the only one with a wide blast radius — commit it separately so a bad ramp is a single revert. If Phase 0 fails, revert nothing; re-scope Phase 4 to the proxy transport.

**Verification commands:** `bun install` · `bun run build` · `bun run check` · `bun test` · `bun run dev` · `bun run smoke`.

> [!WARNING] — **`bun run start` / `bun run smoke`, never bare `node dist/server/entry.mjs`.** The standalone server does not load `.env`; `getSecret()` reads `process.env`, which Astro only populates during `dev`/`build`. Bare `node` produces a 500 that reads exactly like a broken key. This has cost real debugging time in this repo before.

> [!CAUTION] — **Zero-trust tooling.** Never open or grep `.env*`. Use bun exclusively. When running a must-be-zero grep, always run a positive control beside it; a grep that matches nothing may simply have matched no files.

---

## 6. Changelog

| Date | Entry |
| --- | --- |
| 2026-09-26 | Plan drafted, `Status: Review-Only`. Recorded the Google-guidance conflict against browser-direct BYOK, the unverified CORS and WebSocket-auth pillars, and the per-project (not per-key) quota finding. No phase executed. |
| 2026-09-26 | **Phase 0 executed — GATE PASSED, BYOK is buildable as designed.** Baseline green first: `bun run build` clean, `bun run check` 0 errors, `bun test` 148 pass / 0 fail / 4408 assertions. 0.1 CORS **VERIFIED PASS** from a real `http://localhost` origin on both `v1beta` and `v1` — the preflighted `x-goog-api-key` request returns a readable `400 API_KEY_INVALID` and the wire response echoes `access-control-allow-origin`. The predicted blocking failure did not occur. 0.2 **the key must be a WebSocket query parameter** — the handshake completes with no key at all (code `1000`), so auth is in-band and a browser cannot send a header; a setup frame with `?key=` closed `1007 API_KEY_INVALID`, proving the key reached the server. **Ruling: Live is excluded from BYOK** and keeps the server-minted ephemeral token. 0.3 **PASS** — `wav.ts`/`chunk.ts` contain no Node built-ins and travel client-side unchanged. Probe consumed **zero quota**. Scratch file deleted. Next: Phase 1. |
| 2026-09-26 | **Phase 1 executed — app shell complete.** `SiteFooter.astro` extracted from `index.astro` **verbatim** (not one class added, removed, or reordered); `SiteHeader.astro` and `SiteFooter.astro` mounted in `Layout.astro` inside a `min-h-dvh` flex column so every future route inherits the chrome. New `src/lib/nav.ts` is the single source of truth for the route list, carrying the two Phase 3 routes as `implemented: false` so the header never links a 404 — Phase 3 only flips two flags. **Three routing decisions worth keeping:** (a) nav links are `nav-link` with `rounded-full`, NOT the plan's suggested `rounded-app`; `rounded-app` is `button-primary-sm`/`button-ghost-sm`, the Sign Up / Log In buttons, and DESIGN.md's Don'ts forbid mixing the two button shapes in one context. (b) The header background is the literal `{colors.canvas}`, not a translucent variant — the blur was reverted as an unsanctioned flourish in a system whose only flourish is the hero mesh. (c) The mobile trigger is omitted entirely while only one route exists; a hamburger opening a single link is a control that lies about what it controls. `index.astro`'s `<main id="panels">` became `id="main"`, the skip link's target — nothing referenced the old id, and a skip link pointing at a nonexistent target is silently inert. New `src/lib/nav.test.ts` adds 16 tests (148 → 164). **A real bug was caught and fixed, and the fix is the most transferable finding of the phase:** the skip link was focusable but *invisible*. `focus:not-sr-only` is 0,3,0 because `:not()` takes its argument's specificity, so it outranked a sibling `focus:absolute` (0,2,0) and reset `position` to `static`, leaving the link at its 1×1px `sr-only` box. Moving the rule to `@layer components` did **not** fix it — cascade layer order beats specificity outright, and this file's opening `@layer theme, base, components, utilities;` puts `utilities` last, so `.sr-only` won regardless. Even relocating it into `@layer utilities` after `.sr-only` still failed in the browser. Resolution: one self-contained `.skip-link` pair in the utilities layer — always-visible base plus `.skip-link:not(:focus)` to hide — and `sr-only` removed from the element, so there is nothing left to out-specify. **This is the same class of trap as the `recording`/`latin` variant tie in Phase 4 and the `:focus-visible` note in `global.css`; the general rule is that Tailwind variant ties are settled by emission order, an implementation detail the class list never states, so they must be resolved in CSS beside the reason they win.** The failure was invisible to screenshots — a visual review alone would have shipped it. Gates: `build` Complete, `check` 0 errors over 46 files, `bun test` 164 pass / 0 fail. Verified in-browser: first Tab lands on the skip link, it becomes visible with the `{colors.link}` focus ring, Enter jumps to `#main`, `aria-current="page"` lands on both wordmark and Home link. **Tooling caveats recorded:** `run_playwright_code` does not execute in this environment (a `document.body.style.outline` probe never applied) — computed-style assertions must go through served HTML/CSS; and scrolling + `scrollIntoView` time out in the integrated browser, so full-page render checks need another route. Next: Phase 2 (theme). |
