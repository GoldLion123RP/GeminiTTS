# Implementation Plan & Documentation Standard Rules

These rules define the mandatory structure, rigor, and execution guidelines for any implementation plan, architectural specification, or strategic documentation created in the GeminiTTS project.

Project memory is `AGENTS.md` in the repository root — the authority on stack, versions, commands, and conventions. `DESIGN.md` is the authority on visual design.

---

## Artifact Location & Storage Contract (BLOCKING — read before writing any file)

This contract overrides every older convention, including `docs/plans/`.

**Layout — one topic, one new folder, directly under `docs/`.** When the user
asks for an implementation plan and an audit report, write them to disk in a
topic folder you create for that request:

```
docs/<topic-slug>/plan.md     the implementation plan
docs/<topic-slug>/audit.md    the audit / analysis report
docs/<topic-slug>/data/       created ONLY if material was pulled from the web
```

- `<topic-slug>` is 2–4 lowercase kebab-case words naming the topic — e.g.
  `byok-diagnostics`, `light-theme-contrast`, `app-shell-a11y`. No date prefix,
  no `-plan` / `-report` suffix, no restating of the file names.
- File names are exactly `plan.md` and `audit.md`. The folder carries the topic,
  so the file names stay short and the pair is impossible to confuse.
- `data/` holds **only** what came from outside the repo: fetched pages, API
  responses, raw JSON/CSV, transcripts, screenshots. Create it on the first web
  fetch, name each file after its source, and cite it from the plan and the
  audit so every web-sourced claim is traceable. If nothing came from the web,
  do not create `data/`.
- Each document opens with a single `# ` H1 and a `<!-- desc: one-line summary -->`
  comment on the next line, or `bun run docs:sync` fails.
- Report the created paths in your reply so the user can open them directly.

**Forbidden locations.** `docs/plans/` and `docs/superpowers/plans/` are legacy:
never add a new plan or audit there. Never write a plan or audit loose in
`docs/`, into `docs/archive/`, into `.agents/`, `src/`, or the project root, and
never use a dated flat filename such as `docs/2026-09-27-thing-plan.md`.

**Drive boundary (BLOCKING).** Every file you create or modify stays inside this
repository working tree on the project drive (`E:`). Never write to another
drive or partition, a user profile directory, or the system temp directory. A
temp path offered by tooling is for transient process output only; anything worth
keeping is moved into the repo before the turn ends. Scratch work goes to
`docs/.scratch/` — see `docs/agent-workflow.md`.

---

## 0. Activation Triggers & Doc-Type Selector (MUST)

Fire this rule when user intent matches ANY: `plan`, `implement`, `build`, `spec`, `architecture`, `roadmap`, `migration`, `refactor`, `milestone`, `writing`, `documentation`, explicit `@plan_and_documentation.md` reference, or handoff from [[.agents/rules/analysis_and_research.md]] Deep Mode output.

Select doc type before writing:

| Doc type | When to use | Required tiers |
| :--- | :--- | :--- |
| **Full 4-tier plan** | Multi-phase work, DB/API/schema changes, migrations, new features, cross-cutting refactors | Tiers 1–4 in full (§§1–4) |
| **Lite doc** | Single-file fix, typo/docs-only edit, runbook note, decision record with no code change | Tier 1 (condensed) + Tier 3 checklist only; state `Doc-Type: Lite (<reason>)` at top |

**Anti-Overfire rule:** planning keywords alone are insufficient. Require intent to change code, schema, config, or documented behavior. When ambiguous, default to Lite doc, never Full.

**Plan-vs-Execute gate:** drafting a plan is review-only. NEVER execute Tier 2 phases in the same turn unless the user says `proceed`, `execute`, or `implement`. State `Status: Review-Only` or `Status: Proceed-Authorized` at the top of every plan.

**Write-to-disk rule (BLOCKING).** When the user explicitly asks for the plan and
the audit report, the artifacts MUST be written to disk per the Artifact Location
& Storage Contract above. Proposing the content in chat without creating
`docs/<topic-slug>/plan.md` and `docs/<topic-slug>/audit.md` is a failure, not a
draft. When the user does *not* ask for files, chat-only output is fine and no
folder is created.

---

## Mandatory Document Architecture

Every implementation plan or technical planning document must adhere strictly to the following 4-tier structure:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. HEADER & EXPERT SYNTHESIS                                │
│    - Important Notes & Critical Alerts                      │
│    - Problem Description & Objectives                       │
│    - Table of Contents / Index Page                         │
│    - Expert Analysis ("What the Experts Say" & Benchmarks)  │
├─────────────────────────────────────────────────────────────┤
│ 2. PHASE & SUB-PHASE EXECUTION BLUEPRINT                    │
│    - Phase 1: ... (Sub-phases 1.1, 1.2, ...)                │
│    - Phase 2: ... (Sub-phases 2.1, 2.2, ...)                │
├─────────────────────────────────────────────────────────────┤
│ 3. DYNAMIC TO-DO CHECKLIST & PROGRESS TRACKER               │
│    - Hierarchical markdown checklist (- [ ] / - [x])        │
│    - Real-time auto-updating on completion of each phase    │
├─────────────────────────────────────────────────────────────┤
│ 4. AI EXECUTION GUIDE & VERIFICATION PROTOCOL               │
│    - Step-by-step operational instructions for the AI agent │
│    - Stress testing & failure mode scenarios                │
│    - Automated test commands & validation criteria          │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Top Section Requirements

### 1.1 Important Notes & Critical Alerts
- Place critical caveats immediately at the top using GitHub-flavored alerts (`> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`).
- Explicitly highlight:
  - **Stack and version ceilings**: Astro and Tailwind v4 versions from `bun.lock` / `package.json`; any build-output, bundle-size, or performance budget the project must respect.
  - **Design system constraints**: new work must reuse tokens from `DESIGN.md`; any new token is a breaking change to the design system.
  - **Security & secret safety**: zero-trust secret protection rules (never read or commit `.env*`; never inline secrets into client bundles).
  - **Breaking changes or migration hazards**.

### 1.2 Document Description & Objectives
- State the business purpose and technical problem clearly.
- Define explicit success criteria, scope limits (what is in scope vs out of scope), and expected deliverables.

### 1.3 Table of Contents (Index Page)
- Provide a clean, hyperlinked Markdown index of all sections, phases, and appendices for instant navigation.

### 1.4 Expert Analysis ("What the Experts Say")
- Provide an authoritative synthesis from a Senior Principal Architect perspective (decisive, quantified, no generic pros/cons dumps):
  - **Industry Best Practices**: Established architectural patterns for the domain.
  - **Competitor Benchmarking**: Real-world comparison against competing platforms and services.
  - **First-Principles Trade-offs**: Direct comparison of alternative approaches with justification for the chosen design.
  - **Pre-Mortem Failure Analysis**: Identification of edge cases, race conditions, memory bottlenecks, and regression vectors before implementation begins.
- **Deep Mode handoff (when present):** consume [[.agents/rules/analysis_and_research.md]] outputs directly — benchmarks and trade-offs → this section; decisions → Tier 2 phases; failure modes → Tier 4 stress tests. Tag claims `VERIFIED [source, version, fetched YYYY-MM-DD]` vs `UNVERIFIED (memory — needs fetch)`. NEVER invent URLs, versions, limits, or pricing.

---

## 2. Structure: Phases & Sub-Phases

All technical work must be segmented into ordered, logical phases and fine-grained sub-phases:
- **Phase Hierarchy**: Every major milestone is a `Phase N`, divided into `Phase N.M` sub-phases.
- **Granular Specification**: Each sub-phase must include:
  1. **Goal & Scope**: Exactly what changes in this step.
  2. **Affected Files**: Clickable links (`[path/to/file](file:///...)`) marking `[NEW]`, `[MODIFY]`, or `[DELETE]`.
  3. **Implementation Details**: Code snippets, schema models, API payloads, or config diffs.
  4. **Dependencies**: Prerequisites required before starting the sub-phase.

---

## 3. Bottom Section: Dynamic To-Do List & Auto-Checkoff

Near the bottom of the document, provide a comprehensive Markdown task list reflecting every phase and sub-phase:

```markdown
## Implementation Progress & To-Do List

- [ ] **Phase 1: Database Layer & Connection Pooling**
  - [ ] Phase 1.1: Define SQLModel schemas and relationships
  - [ ] Phase 1.2: Configure connection pool with `pool_pre_ping=True`
- [ ] **Phase 2: API Endpoints & Business Logic**
  - [ ] Phase 2.1: Implement controller endpoints in `/backend/controllers`
  - [ ] Phase 2.2: Add Pydantic validation and error handling
...
```

### Self-Updating Contract for the AI
- **Auto-Update Rule**: Whenever the AI agent finishes executing any sub-phase or phase, it **must immediately open the plan document and check off the item** (`- [ ]` → `- [x]`).
- **Progress Visibility**: Never leave completed phases unchecked. The checklist must always accurately mirror real repository state.

---

## 4. End Section: AI Execution Guide & Verification Suite

### 4.1 AI Execution Guide
- Detail operational instructions on how subsequent agents or execution turns should proceed:
  - Strict order of execution (never skip prerequisite sub-phases).
  - Context preservation techniques (e.g., verifying lockfiles, AST models, and env schemas first).
  - Rollback and failure recovery protocols in case a build or command fails.

### 4.2 Stress Testing & Edge Cases
   - Include specific stress tests when applicable:
   - **Build integrity**: `bun run build` completes with no errors, and `npx astro check` reports zero type errors.
   - **Responsive & viewports**: verify layouts at mobile, tablet, and desktop widths per the breakpoints in `DESIGN.md`.
   - **Accessibility & UX**: keyboard navigation, focus visibility, contrast ratios, and reduced-motion behavior.
   - **Hydration & client JS**: confirm no hydration mismatch warnings and that client-side JS stays within budget.
   - **Cross-browser**: verify in the browser targets listed in `DESIGN.md`.

### 4.3 Automated Verification & Audit Matrix
- Specify exact verification commands:
  - Install: `bun install`
  - Dev: `bun run dev`
  - Build: `bun run build`
  - Type check: `npx astro check` (must report zero errors)
  - Preview smoke test: `bun run preview`, then load `/` and confirm the page renders styled.
  - End-to-end smoke tests and acceptance checks against the success criteria in Tier 1.
  - **Standing gates.** `check:contrast`, `check:secrets`, `check:routes`, `check:shell`, `check:panel` and `check:spacing` must all appear in the phase's acceptance list and must be run, not asserted. `AGENTS.md` records which of them have caught a real defect and which skip part of their work on a node build; that paragraph is the authority, so read it rather than restating it from memory.
- **Zero-Trust & Tooling (BLOCKING):** NEVER open, read, parse, or grep `.env`, `.env.local`, or any `*.env` file — use `.env.example` if present. Use `bun` / `bunx` exclusively; do not introduce npm, pnpm, or yarn. Never write outside the project drive: plans, audits, and evidence stay inside this repo per the Artifact Location & Storage Contract.

---

## 5. Canonical Plan Skeleton (copy, do not reinvent)

Every Full 4-tier plan MUST start from this skeleton. Single canonical copy — no sidecar templates.

```markdown
Status: Review-Only | Doc-Type: Full
# <Title> — Implementation Plan
<!-- desc: one-line summary -->

> [!IMPORTANT] — Stack: Astro + Tailwind v4 via `@tailwindcss/vite`, bun package manager (versions per `AGENTS.md` / `bun.lock`). Design tokens are frozen in `DESIGN.md`; new tokens are a breaking change. Never read or commit `.env*`. Breaking-change risk: <state>.
## 1. Objectives & Success Criteria (scope in/out, deliverables)
## 2. Expert Analysis (benchmarks, trade-offs, pre-mortem; VERIFIED/UNVERIFIED tags)
## 3. Phases (Phase N.M: goal, affected files [NEW]/[MODIFY]/[DELETE], details, dependencies)
## 4. Progress Checklist (- [ ] / - [x], auto-update on each completed phase)
## 5. Execution Guide + Verification (order, rollback, `bun run build` / `npx astro check`, smoke tests)
## 6. Changelog
```

The companion audit lands beside it as `docs/<topic-slug>/audit.md` with the same
H1 + `<!-- desc: ... -->` pair. No path outside the contract in the top section.

---

## 6. Exit Gate & Changelog Wiring (MANDATORY)

Before marking any plan complete, run this gate. Show the log or the plan is invalid:

1. `Is this the best answer I can give?` → If no, upgrade now. Max 3 iterations.
2. `Is there anything I am forgetting?` → Checklist: triggers + doc-type correct? Tier 1–4 (or Lite) present? phases have goal/files/details/dependencies? VERIFIED/UNVERIFIED tags? design-token + secret-safety + `bun`-only checks done? rollback defined?
3. `Is there any way I can improve this answer?` → Apply one concrete upgrade or state `No further upgrade within iteration budget — confidence: High/Med/Low + gaps: ...`.

**Rules:** NEVER output performative `yes, perfect` with no delta. Each question MUST produce a revision or an explicit gap. Final MUST include Confidence + Gaps/Assumptions.
- **Changelog wiring:** every executed plan appends an entry to the changelog section of the plan document itself, or to `docs/CHANGELOG.md` if that file exists. Docs-only Lite records may log a single line.
