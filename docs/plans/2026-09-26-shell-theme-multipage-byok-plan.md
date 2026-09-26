<!-- desc: Four-tier plan for the app shell (header/footer), the tri-state theme, the three-page split, and a browser-direct BYOK mode. -->
Status: In Progress (Phases 0-4 complete, gates passed) | Doc-Type: Full

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
2. `bun test` count does not regress below the 200 passing / 4489 assertions recorded at the end of Phase 4 (148 at plan draft).
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
- [x] **Phase 2 — Theme — COMPLETE 2026-09-26**
  - [x] 2.1 Measured light ramp; `DESIGN.md` updated same turn (3 values changed, see verdict)
  - [x] 2.2 Dark ramp behind `[data-theme='dark']`, mesh untouched, cascade order verified in artifact
  - [x] 2.3 No-flash head script (`is:inline` verified in served HTML) + tri-state radio toggle
  - [x] 2.4 Contrast audit of every token pair, both themes — `bun run check:contrast`, positive-control verified
- [x] **Phase 3 — Pages — COMPLETE 2026-09-26**
  - [x] 3.1 `/speech-to-text`
  - [x] 3.2 `/text-to-speech`
  - [x] 3.3 `/` landing with feature grid; panels removed
- [x] **Phase 4 — BYOK — COMPLETE 2026-09-26**
  - [x] 4.1 Provider abstraction + single `request()` seam
  - [x] 4.2 Keystore: session default, opt-in persist, clear
  - [x] 4.3 Transport per Phase 0 verdict
  - [x] 4.4 Settings UI with a *true* security statement
  - [x] 4.5 Panels migrated; server path still the default
  - [x] 4.6 Secret grep **with positive control** — `bun run check:secrets`
- [x] **Phase 5 — Resilience — COMPLETE 2026-09-26**
  - [x] 5.1 `/api/health` — `configured` | `missing` | `invalid` | `quota_exhausted` (+ `unknown`), redacted, `cache-control: no-store`, probed with `models?pageSize=1` so it costs no quota
  - [x] 5.2 Backoff + full jitter at the provider seam; `429`/`503` only, never `502` — see the verdict for why
  - [x] 5.3 Quota meter, honestly labelled; Pacific-day buckets; per-provider counts
  - [x] 5.4 Accessibility pass via the `web-design-guidelines` skill — eight findings fixed, plus a shipped-route defect it uncovered
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
| 2026-09-26 | **Phase 3 executed — pages complete.** `src/pages/speech-to-text.astro` and `text-to-speech.astro` each own one tool; `index.astro` is now a landing page (hero, two marketing-pill CTAs, 4-up feature grid) and mounts neither panel. The two `implemented` flags in `nav.ts` flipped, so **the header needed no edit** — the Phase 1 staging mechanism worked as designed, which is the payoff for declaring the routes ahead of the pages. `FeatureCard.astro` was extracted rather than inlined, because a grid of *identical* cards is the case where one owner beats a find-and-replace across N copies. **Four deviations from the plan, all recorded rather than smuggled in:** (a) **`Hero` gained a `compact` prop** — the plan said tool pages get "a reduced band, documented as a deliberate departure", and reducing it *per page* would have meant duplicating the hero's own padding and type-scale logic in both pages, so the reduction is a prop on the one component that owns those values. (b) **The tool pages are full-width, not grid cells.** The panels lived in a 2-up grid at ~570px; that width was never designed for them, so the split widens them as a consequence rather than as a redesign. (c) **The feature grid starts at `sm` (640px), not the 768px the breakpoint table implies for 2-up grids** — these cards are short, and a 2-up waiting until 1024px leaves both a phone and a tablet with a column of one. (d) **The CTA pills are `h-10` (40px), not 44px.** DESIGN.md's 44px claim rests on line-height-driven height, but `0px 14px` horizontal-only padding gives 20px at literal token values; 40px is the smallest height that still clears WCAG 2.5.8's 40px minimum. **One real bug was caught and fixed, and it only became possible *because* of the split:** the wordmark carried `aria-current="page"`, which was harmless while the nav held one link and became a duplicate the instant a "Home" nav item appeared — `/` matched both, putting a single-value attribute on two controls and announcing the current page twice. The wordmark is a brand link that happens to point home; the nav item represents a location, so it owns the attribute. **A measurement caveat that nearly produced a false alarm:** the first count read `2` per route and looked like the bug surviving the fix. Scoping it showed the two are the *desktop and mobile copies of the same link* (the menu is rendered in the DOM at all widths and revealed by the trigger, deliberately, so `aria-controls` points at something real) — one per nav landmark, not a duplicate. **A second environment trap, recorded because it nearly invalidated the whole phase:** port 4321 was held by a **stale standalone server** (`node dist/server/entry.mjs`) from an earlier session, not a dev server. It had the old bundle in memory, so it served pre-Phase-3 HTML *after* a successful rebuild — the browser showed the old two-up page and a one-item nav while `build`, `check`, `test` and `smoke` were all green. Four gates passing does not mean the thing you are looking at is the build; it means the build is sound. A stale process serves the previous truth indefinitely and no test notices. Relatedly, `bun run smoke` hardcodes a default `PORT=4321` and will happily attach to whatever already holds that port rather than the `dist/` it just spawned — so the real smoke run was repeated with `PORT=4322`. Gates: `bun run build` Complete!, `bun run check` 0 errors / 0 warnings / 0 hints (51 files), `bun test` 166 pass / 0 fail / 4431 assertions (164 → 166), `bun run smoke` 6/6 on port 4322, `bun run check:contrast` all pairs pass in both themes. Verified in-browser on all three routes: correct `<title>`, three nav links, footer link column, the landing grid, and each tool on its own page. **Disclosed:** the BYOK card on the landing page describes Phase 4 in the future tense ("is on the way") rather than claiming a feature that does not exist yet; if Phase 4 slips, that card is the thing to re-check. Next: Phase 4 (BYOK). |
| 2026-09-26 | **Phase 2 executed — theme complete.** Two deviations from the plan, both recorded. **(1) The plan said to add `--color-surface-*` tokens and re-point `canvas`/`elevated`/`hairline` through them. That was not done, because the build showed it is unnecessary: Tailwind emits colour utilities as `var()` references (`.bg-canvas{background-color:var(--color-canvas)}`), so a single `[data-theme='dark']` block that re-declares the EXISTING tokens re-binds the whole palette with zero component edits. The `--color-surface-*` layer would have added indirection and a second source of truth for one value. **(2) Phase 2.4 found three pre-existing WCAG AA failures in the LIGHT theme, not the dark one: `mute` #8f8f8f (3.10:1), `faint` #a1a1a1 (2.58:1) and `link` #0070f3 (4.36:1) against the near-white canvas — all used for 12-16px text, so all subject to the 4.5:1 bar. Corrected to #6b6b6b / #727272 / #006ce5 (5.11 / 4.61 / 4.70:1), the lightest change that clears it, with `DESIGN.md` updated in the same turn per the docs rule. The grey ladder stays strictly ordered: a naive per-token search collapsed `mute` and `faint` onto the same hex, which would have satisfied contrast by destroying the tiering. **Ramp values are computed, not eyeballed** — the one part of a dark ramp that cannot be judged by eye is contrast, and it is arithmetic. `bun run check:contrast` (`scripts/check-contrast.mjs`) now gates 26 text pairs across both themes, all passing, and it was verified to actually fail (regressed `faint` to #a1a1a1 → 2.58:1, exit 1) because a gate that cannot fail is not a gate. The dark ladder deliberately does NOT mirror the light one (15.74 → 8.49 → 6.07 → 5.34 vs 17.18 → 8.10 → 5.11 → 4.61): a literal mirror puts `faint` under 4.5:1. The cascade placement is the same layer-order trap Phase 1 hit, used deliberately this time — the dark block lives in `@layer base`, which the built CSS emits at index 6408 against the theme layer at 1032, so it wins over Tailwind's `:root` defaults. **A false claim in the codebase was corrected:** Phase 1's skip-link comment states this file "opens with `@layer theme, base, components, utilities;`". It never did — no such declaration exists, and the real order comes from Tailwind's own emission. **`is:inline` was verified rather than assumed,** as the plan required: the served HTML carries a plain `<script>` at index 3127 inside `<head>` (ending 5266) with no `type="module"`, which is what makes the no-flash guarantee real. The toggle is a native radio group, not a toggle button — a three-state preference cannot honestly be `aria-pressed`, and native radios bring platform grouping and arrow-key semantics instead of a hand-rolled imitation. All three states verified in the browser, including `system` resolving to `data-theme="dark"` on this OS-dark host, and the choice surviving a reload. Gates: `bun run build` Complete!, `bun run check` 0 errors / 0 warnings / 0 hints (48 files), `bun test` 164 pass / 0 fail, `bun run smoke` 5/5. **Disclosed, not hidden:** `hairline` sits at ~1.2:1 where WCAG 1.4.11 references 3:1 for a control-identifying boundary; card borders are exempt as decorative but an input border arguably is not. Lifting it would contradict DESIGN.md's explicit "1px hairline before any shadow", so it is recorded as a known gap in `docs/development.md` and reported as `warn` by the audit rather than silently "fixed". Side effect: a stray Tab during browser testing hit the mic's Space shortcut and started a real recording, consuming scarce free-tier quota and producing 429s. The app handled the 429 correctly. Next: Phase 3. |
| 2026-09-26 | **Phase 4 executed — BYOK complete, secret gate green.** 4.1-4.5 shipped in `c58d1c8`; 4.6 is the new `scripts/check-secrets.mjs` + `bun run check:secrets`. **Three deviations from the plan, all recorded.** (a) **The provider is a routing TABLE, not the plan's `'server' | 'byok'` union.** The five endpoints are not two kinds of thing: `synthesize`/`transcribe` follow the user's choice, `live-token` is *always* server (Phase 0.2 — a browser cannot send a header on a WebSocket, so the key would land in `?key=`), `extract` is *always* server (`mammoth`/`unpdf` are Node-bound), and `estimate` is `local` and never touches the network at all. Collapsing that to a boolean would have pushed `live-token` and `extract` down the browser-key path — which is precisely the leak this mode exists to prevent. A simplification here would have been a security regression wearing a boolean. (b) **4.4 ships a "Save and test" button, not a test-connection request.** A dedicated test endpoint would spend a billable call and a round-trip to answer a question the next real request already answers; the status line says so instead of pretending to verify anything. (c) **The keystore is `sessionStorage` by default with `localStorage` as the opt-in** — the plan said "session-only by default, opt-in remember", which this implements literally. **A real typecheck regression was caught while closing 4.6:** two no-argument `fetch` stubs in `provider.test.ts` were cast with `as typeof fetch`, which `@types/bun`'s `fetch.preconnect` makes an illegal narrowing — `bun run check` had been left red at 2 errors. Now `as unknown as typeof fetch`; `bun run check` reports 0. **The secret gate is the transferable finding.** Repo memory already records `Select-String -Path "dist\**"` producing a *false pass twice* (matched 1 of 45 files), so a bare grep is not evidence. The script enumerates files itself, prints how many it read, FAILS on a zero-file scan, plants a synthetic key in a temp file as a **positive control** that the detector must find, and reports hits as `file:line` so it can never leak the thing it hunts. **It was verified to actually fail** — a planted `AIza…` literal in `dist/client/` gave exit 1 — because a gate that cannot fail is not a gate. **And the first version of it failed on two false positives, both prose:** `ByokSettings.astro` renders `x-goog-api-key` inside a `<code>` element as the user's security statement, and `gemini-direct.ts` names `?key=` in the comment explaining why it never does that. The source checks now strip comments and read only real modules; a gate that cries wolf on its own documentation is a gate that gets ignored. **A documentation claim was corrected in the same turn:** `docs/development.md` told readers to verify that `generativelanguage` does *not* appear under `dist/client/`, which BYOK makes false by design — removed rather than left to fail, and replaced with the three invariants the gate actually enforces. Gates: `bun run build` clean, `bun run check` 0 errors, `bun test` 200 pass / 0 fail / 4489 assertions (plan baseline was 148), `bun run check:contrast` all pairs pass, `bun run check:secrets` exit 0 over 48 scanned files. **Not proven here:** nothing was exercised against a real user key in a browser — that needs a credential this repo does not have. Next: Phase 5.