# Agent Workflow

<!-- desc: How skills, rules, and MCP load; scratch-file policy; documentation rules; verification standard. -->

Detail behind [`AGENTS.md`](../AGENTS.md). Read on demand.

## How context loads

| Source | Mechanism | Loaded |
| --- | --- | --- |
| `AGENTS.md` | opencode project rules | every session |
| `.agents/rules/*.md` | `instructions` array in `opencode.jsonc` | every session |
| `.agents/skills/*/SKILL.md` | native `skill` tool | on demand, by name |
| `DESIGN.md` | manual read | when doing design work |
| `docs/*.md` | manual read, on demand | when the task needs the detail |

`AGENTS.md` wins over everything else. It is deliberately short; if a rule needs
more than a line, it belongs in `docs/` and gets linked from there.

## Rules

All are registered in `opencode.jsonc` and load automatically.

- **`analysis_and_research.md`** — three-pass research pipeline: Sweep (minimum
  three live touchpoints), Validate (first-principles teardown plus a
  pre-mortem), Synthesize. Every claim tagged `VERIFIED [source, version,
  fetched YYYY-MM-DD]` or `UNVERIFIED (memory — needs fetch)`. Ends with a
  three-question adversarial self-review that must produce a revision or an
  explicit gap — never a performative "yes, perfect".
- **`plan_and_documentation.md`** — mandatory structure for implementation
  plans: doc-type selector (Full 4-tier vs Lite), phase/sub-phase breakdown with
  goal / affected files / details / dependencies, an auto-updating checklist,
  and a verification matrix. Drafting a plan is review-only; execution needs
  explicit authorization.
- **`plan-execution-protocol.md`** — what happens *after* a plan is approved:
  mandatory ingestion (plan, companion report, evidence directory, regression
  suites), strict phase isolation with no drive-by refactoring, an acceptance
  gate that must be green before a phase closes, `[x]` checkoff and phase status
  update, then session compaction between phases. It references `npm run build`;
  in this repo that is `bun run build`, and `bun run check` is the typecheck
  gate.

## Skills

| Skill | Source | Use |
| :--- | :--- | :--- |
| `brainstorming` | `obra/superpowers` | Gate before creative or behavioral work |
| `code-skeptic` | local | Challenge unproven claims before declaring done |
| `frontend-design` | `anthropics/skills` | Visual direction for new UI |
| `tailwind-4-docs` | `Lombiq/Tailwind-Agent-Skills` | Tailwind v4 syntax and gotchas |
| `web-design-guidelines` | `vercel-labs/agent-skills` | UI review before shipping |
| `agent-browser` | `vercel-labs/agent-browser` | Browser automation CLI: navigation, forms, screenshots, scraping, exploratory testing, Electron apps |

Pinned in `skills-lock.json`. Names must match exactly — opencode rejects a
`SKILL.md` whose `name` differs from its directory, and silently ignores
frontmatter fields other than `name`, `description`, `license`, `compatibility`,
and `metadata`.

`agent-browser` ships a stub `SKILL.md` that carries `hidden: true` and
`allowed-tools` (both ignored here) and defers its real instructions to
`agent-browser skills get core`. Run that command before the first browser task
of a session; `agent-browser skills get electron` covers Electron desktop apps.

### Skill and rule overlap

`brainstorming` and `plan_and_documentation.md` both gate work behind approval.
They agree: `brainstorming` owns the conversation (understand intent → classify
→ propose design → get approval), `plan_and_documentation.md` owns the written
artifact once the design is approved.

`brainstorming` hands off to a **`writing-plans` skill that is not installed
here**. Substitute `.agents/rules/plan_and_documentation.md`.

`brainstorming` persists session artifacts to `.superpowers/`, which is
gitignored. Its visual companion needs Git Bash and a detached process — see the
OpenCode section of `.agents/skills/brainstorming/visual-companion.md` for the
Windows `Start-Process` invocation.

## Documentation tooling

Three verified sources, used in this order. Prefer a live source over training
data; if a tool is unavailable or blocked, say `STALE — memory only` and downgrade
confidence.

| Tool | Use for | Verified |
| :--- | :--- | :--- |
| `astro-docs` MCP | Astro APIs, integrations, config, CLI | `opencode.jsonc` |
| `ctx7` CLI | Any other library or framework | `v0.5.10`, logged in |
| `gh` CLI | Repos, issues, PRs, releases, CI, code search | `v2.101.0`, logged in |

### `ctx7` (Context7)

The binary is **`ctx7`**, not `context7` — `context7` is not on PATH. Two
commands, always in this order:

```bash
ctx7 library <name> "<query>"   # resolve a name to a Context7 library ID
ctx7 docs <libraryId> "<query>" # fetch documentation for that library
```

```bash
ctx7 library astro "server output adapter"   # -> /withastro/docs
ctx7 docs /withastro/docs "adapter config options"
```

**Read the resolved title and ID before querying.** Resolution is semantic and
ranks by relevance, not authority, so it can return a plugin or fork ahead of the
core library. Asking for `tailwindcss` returned
`/websites/deepwiki_catppuccin_tailwindcss` and `/catppuccin/tailwindcss` —
third-party theme plugins, not core Tailwind. Prefer official IDs, and spot-check
that a result actually documents the thing you asked about.

One topic per `ctx7 docs` query; run a separate query per distinct concept
unless they genuinely interact. `--json` gives structured output when parsing.

### `gh` (GitHub CLI)

Authenticated as `GoldLion123RP` over HTTPS, with `repo`, `workflow`,
`read:org`, and `gist` scopes. Use it to read state:

```bash
gh repo view --json name,description,defaultBranchRef
gh pr list --state open
gh run list --limit 5
gh search code "getSecret" --owner withastro
```

`gist` scope means `gh gist create` would publish content to a public URL — treat
that as an outbound publish and never run it unprompted, even for scratch notes.
Do not push, open PRs, or change repo settings unless explicitly asked.

## MCP

`astro-docs` — remote server at `https://mcp.docs.astro.build/mcp`, configured in
`opencode.jsonc`. Query it for any Astro API, integration, config option, or CLI
flag instead of relying on memory. It is Astro-specific; reach for `ctx7` on
everything else.


## Scratch and temp files

Keep all temporary work inside the repo so it is inspectable and disposable.

| Kind of file | Location |
| :--- | :--- |
| Scratch notes, intermediate data, throwaway analysis | `docs/.scratch/` |
| Generated plans and audits | `docs/<topic-slug>/` — one new topic folder per request, holding `plan.md`, `audit.md`, and `data/` only when web material was captured |
| Superseded documentation | `docs/archive/` |
| Anything a tool insists on writing elsewhere | `docs/.scratch/`, then move it back |

Rules:

- Never scatter temp files in the project root, `src/`, or the system temp dir.
- Everything written stays on the project drive inside this repo. No other
  drive, partition, profile directory, or system temp dir.
- `docs/.scratch/` is gitignored — nothing there is ever committed.
- Delete scratch files as soon as they stop being useful. Do not leave them for
  a later turn to clean up.
- If a temp file turns out to be worth keeping, move it into the relevant
  `docs/<topic-slug>/` folder and register it in `docs/README.md`
  (`bun run docs:sync`).
- `docs/plans/` is legacy. Never write a new plan, audit, or evidence file
  there; the contract above replaced it.
- `docs/archive/` is for documentation that is superseded but still worth
  reading. Never delete history; move it there and note what replaced it.

## Documentation rules

`README.md` and `docs/README.md` are living documents. Update them in the same
turn as any change — never defer, never wait to be asked.

Update when any of these change:

- Commands, scripts, dependencies, or versions
- Project structure — added, removed, or moved files and directories
- Routes, configuration, or environment variables
- A known gap is fixed (remove the gap note)
- Setup steps, prerequisites, or platform requirements
- Conventions, tooling rules, or the agent workflow itself
- Any status or roadmap claim the change makes untrue

How to write them:

- Verify every fact against the repo first. Run the command, read the file,
  check `package.json`. An unverified claim is worse than no claim.
- Keep the tone factual. No marketing adjectives, no unearned claims. If
  something is a stub or partial, say so plainly.
- Preserve existing heading structure and section order; extend rather than
  restructure.
- Re-read each doc once at the end of a change and confirm nothing in it is now
  false.

`docs/README.md` and `docs/archive/README.md` carry a generated table between
the `<!-- sync:start -->` and `<!-- sync:end -->` markers. Run
`bun run docs:sync` after adding, renaming, or deleting any file under `docs/`
— the script refuses to guess at prose and only rewrites that block.

## Verification standard

Never state that a build, typecheck, or test passed without pasting the actual
command output. If a command was not run, say so. `code-skeptic` enforces this,
and also checks whether the docs went stale.

This section is the detail behind the **Verification** hard rule in
[`AGENTS.md`](../AGENTS.md). That file holds the rule and wins on any conflict;
what follows is the per-gate status it points at, and it is the only place that
status lives. Update it in the same turn as a gate is added, gains a positive
control, or catches a real defect.

### Standing gates

`check:contrast`, `check:secrets`, `check:routes`, `check:shell`,
`check:panel`, and `check:spacing` are the standing gates. Run them; never
assert that they pass. Each one carries a positive control, so it is proven able
to fail — a gate that cannot fail is worse than no gate.

| Gate | Command | Maturity |
| :--- | :--- | :--- |
| `check:contrast` | `bun run check:contrast` | Has caught a real defect. |
| `check:secrets` | `bun run check:secrets` | Has caught a real defect. |
| `check:routes` | `bun run check:routes` | Has caught a real defect. |
| `check:shell` | `bun run check:shell` | Proven able to fail; has not yet caught anything. |
| `check:panel` | `bun run check:panel` | Has caught a real defect — the shipped bundle's missing `input` reconciliation, the permanently disabled Generate button. |
| `check:spacing` | `bun run check:spacing` | Has caught a real defect — the unspaced `ByokSettings` panel (`src/components/ByokSettings.astro`), stacked flush under `#quota`. Its real-page check only runs against a **static** build, because `output: 'server'` renders HTML on demand: on a node build it prints `skip` with the reason and asserts nothing. It also rebuilds the project twice, so it inherits `PAGES_TARGET` from its environment and will replace a static artifact with a node build when the variable is not set for the whole sequence. Verified 2026-09-27 on the static target: exit 0, two real pages asserted. |

`verify:stt` is a procedure, not a passing test. It synthesises an enumerated-list
passage and judges Smart against Verbatim by line structure, with `--mode
verbatim` as the control. It has never been run, so nothing in the repo may claim
the STT path is proven.
