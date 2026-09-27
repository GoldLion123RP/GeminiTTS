# GeminiTTS — Project Guide

Astro 7 (`output: 'server'`) + Tailwind CSS v4. bun. Node >= 22.12.0.

**This file is project memory and stays short.** Detail lives in the files it links — read those on demand instead of duplicating them here. If a rule needs more than a line, put it in `docs/` and link it.

## Index

| File | Authority on |
| --- | --- |
| `AGENTS.md` (this file) | stack, hard rules, verification, index of the rest |
| [`DESIGN.md`](DESIGN.md) | visual design system — tokens, type, spacing, components |
| [`docs/README.md`](docs/README.md) | documentation index and archive |
| [`docs/development.md`](docs/development.md) | commands, project structure, environment quirks |
| [`docs/agent-workflow.md`](docs/agent-workflow.md) | skills, rules, MCP, scratch/temp policy, verification-gate detail |
| `opencode.jsonc` | rules registration and MCP wiring |
| `README.md` | user-facing setup and overview |

Where any two disagree, this file wins.

## Stack

| Fact | Value |
| --- | --- |
| Framework | Astro 7, `output: 'server'` on `@astrojs/node` (`mode: 'standalone'`) + Vite plugins |
| Styling | Tailwind v4 via `@tailwindcss/vite` |
| Stylesheet entry | `src/styles/global.css` (`@import 'tailwindcss'`), imported by `src/layouts/Layout.astro` |
| Server secret | `GEMINI_API_KEY` — server-only, never `PUBLIC_`; declared in `src/env.d.ts` |
| User secret | A BYOK Gemini key — browser-only, in `src/lib/client/keystore.ts`; never reaches our server (`bun run check:secrets`) |
| Package manager | bun — `bun` / `bunx`. Never npm, pnpm, or yarn. |
| Lockfile | `bun.lock` |
| Type check | `bun run check` (`astro check`) |
| Build / typecheck gates | `bun run build` and `bun run check` must both pass |

Server output exists so *our* Gemini key never reaches the browser. Anything touching `GEMINI_API_KEY` must stay server-side; a user-supplied BYOK key is the one deliberate exception and lives only in `src/lib/client/`. Commands, project structure, and the `bun install` drive quirk: [`docs/development.md`](docs/development.md).

## Hard rules

- **Design.** Read `DESIGN.md` before any markup, class, or component; never invent colors, fonts, spacing, radii, or motion timings. A new token is a breaking change and must be called out explicitly.
- **Secrets.** Never read, parse, grep, or commit `.env`, `.env.local`, or any `*.env` file; use `.env.example`. Never inline secrets into client code.
- **Verification.** Never state a build, typecheck, or test passed without pasting the actual command output; if a command was not run, say so. The standing gates are `check:contrast`, `check:secrets`, `check:routes`, `check:shell`, `check:panel`, and `check:spacing` — run all six, never assert them. All six are green on the static build, which is the target CI builds; `check:spacing`'s real-page check only runs on a static build (`$env:PAGES_TARGET="pages"`) and prints `skip` with the reason on a node build, and `check:panel` rebuilds the project, so export that variable for the whole sequence or it replaces the static artifact with a node one. `verify:stt` has never been run. Gate maturity and scopes: [`docs/agent-workflow.md`](docs/agent-workflow.md#verification-standard).
- **Temp and scratch files** go under `docs/.scratch/`, never in the project root or `/tmp`; delete them once no longer needed. Policy: [`docs/agent-workflow.md`](docs/agent-workflow.md#scratch-and-temp-files).
- **Plan and audit location.** A requested plan and audit report go in a new topic folder — `docs/<topic-slug>/plan.md`, `docs/<topic-slug>/audit.md`, plus `docs/<topic-slug>/data/` only when web material was captured; `docs/plans/` is retired (removed 2026-09-27), never recreate it. Contract: [`plan_and_documentation.md`](.agents/rules/plan_and_documentation.md).
- **Drive boundary.** Every file an agent writes stays on the project drive inside this repo — never another drive or partition, a user profile directory, or the system temp directory.
- **Docs stay current.** Update `README.md` and `docs/README.md` in the same turn as any change to commands, versions, structure, routes, config, or the agent workflow; drop a known-gap note when the gap is fixed, and verify every claim against the repo first. Policy: [`docs/agent-workflow.md`](docs/agent-workflow.md#documentation-rules).
- **Plan execution.** Executing an approved plan follows `.agents/rules/plan-execution-protocol.md`: ingest plan + companion report, work one phase in isolation, verify before advancing, check off the plan's `[x]` boxes, then compact. `npm` in that protocol means `bun` here.
- **English only** in comments, docs, and commit messages.

## Skills

Load with the `skill` tool before acting. Match by exact name.

| Skill | Load when |
| --- | --- |
| `brainstorming` | Any new feature or behavior change; classifies the work and gates implementation |
| `frontend-design` | New UI surface, component, page, or aesthetic direction |
| `tailwind-4-docs` | Any Tailwind utility, `@theme`, or `@plugin` change — verify, don't guess |
| `web-design-guidelines` | Reviewing or shipping any UI change |
| `agent-browser` | Any browser task — navigation, forms, screenshots, scraping, exploratory testing, dogfooding, QA, or Electron app automation. Preferred over built-in browser/web tools. The `SKILL.md` is a discovery stub: run `agent-browser skills get core` for the real workflow. |
| `code-skeptic` | Before claiming any task is done — demands real command output |

Details, overlap notes, and the `.superpowers/` caveat: [`docs/agent-workflow.md`](docs/agent-workflow.md).

## Documentation and tooling

Verify before guessing — library APIs, CLI flags, and config options change faster than training data. Three verified sources, in order of preference:

| Tool | Use for |
| --- | --- |
| `astro-docs` MCP | Astro APIs, integrations, config, CLI. Configured in `opencode.jsonc` |
| `ctx7` (Context7 CLI) | Any other library or framework docs. `ctx7 library <name> "<query>"` to resolve an ID, then `ctx7 docs <id> "<query>"` |
| `gh` (GitHub CLI) | Repos, issues, PRs, releases, CI runs, code search across GitHub |

**`ctx7` caveats.** The binary is `ctx7`, not `context7`. Resolution is semantic, so it can return plugins and forks ahead of the core library — for `tailwindcss` it ranked a Catppuccin theme plugin first. Always read the resolved title and ID and prefer the official one (`/withastro/docs` for Astro). One topic per query; `--json` for structured output.

**`gh` caveats.** Authenticated as `GoldLion123RP` over HTTPS with `repo`, `workflow`, `read:org`, and `gist` scopes. Use it to read state; never push, open PRs, or change repo settings unless explicitly asked.

Full routing matrix and evidence rules: [`docs/agent-workflow.md`](docs/agent-workflow.md).

