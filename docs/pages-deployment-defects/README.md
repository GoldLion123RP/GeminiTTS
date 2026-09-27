# Pages Deployment Defects

Planning folder for the four defects reported 2026-09-27 from screenshots of the
static GitHub Pages deployment: the deployment cannot serve the `.env` key, BYOK
reports failures under the wrong cause, light-theme borders sit at 1.14:1, and
`ByokSettings` has no top margin. The location contract is defined in
[`.agents/rules/plan_and_documentation.md`](../../.agents/rules/plan_and_documentation.md).

**Status: complete except one human gate.** Phases 0–4 and `D15` are done, and the
final gate discharged `F.1`, `F.2`, `F.3` and `F.5` on 2026-09-27. `F.4` — the
§5.3 light/dark screenshot pass — is **open and blocked**: the container this was
finished in has no browser and Chrome could not be fetched. Three of the eight §5.3
rows were verified against the built static artifact instead. Read the `Status:`
line on line 1 of [`plan.md`](plan.md) for the authoritative position.

## Documents

<!-- sync:start -->

| Document | Description |
| :--- | :--- |
| [Defect Evidence — Pages deployment, BYOK, light-theme borders, panel spacing](data/2026-09-27-defect-evidence.md) | Probe output, contrast arithmetic, and source locations for the four defects reported 2026-09-27 from screenshots of goldlion123rp.github.io/GeminiTTS. Every row names the command that produced it. |
| [Pages Deployment, BYOK Diagnostics, Light-Theme Borders & Panel Spacing — Implementation Plan](plan.md) | Four-tier plan for the four defects reported 2026-09-27: the static GitHub Pages deployment cannot serve the .env key, BYOK reports failures under the wrong cause, light-mode borders sit at 1.14:1, and ByokSettings has no top margin. |

<!-- sync:end -->

## Evidence

`data/` holds the measured evidence behind the plan. Every claim in the plan that
says a defect *exists* rather than *might* exist has a row in
[`data/2026-09-27-defect-evidence.md`](data/2026-09-27-defect-evidence.md), with
the command that produced it. Anything the plan asserts without a row there is an
assumption, and is labelled as one.

Regenerating an entry means re-running its command. Numbers that drift are a bug in
the entry, not noise — update the entry in the same commit as the code change that
moved the number.

Findings are cited as `D<n>` and resolve to that file.

`data/` also holds one executable harness,
[`data/quota-formatter-bench.mjs`](data/quota-formatter-bench.mjs) — the measurement
behind `D15` / Q.2. It is not indexed by `docs:sync`, which indexes Markdown only.
Run it with `bun data/quota-formatter-bench.mjs`; it prints the `recordSpend` cost
over a full 200-entry log with a per-call `Intl.DateTimeFormat` and with a hoisted
one, in the same process, so the difference is attributable to the formatter.

## Notes

- **No `audit.md`.** Written 2026-09-27 before the plan + audit pair was required
  on disk; the audit-equivalent content is §2 (`D1`–`D18` plus the pre-mortem)
  together with the evidence file, which together satisfy the "Finding Register"
  and "do not fix" reading of
  [`.agents/rules/plan-execution-protocol.md`](../../.agents/rules/plan-execution-protocol.md).
- **Provenance.** Written as
  `docs/plans/2026-09-27-pages-byok-theme-spacing-defects-plan.md` and moved here
  on 2026-09-27 when the legacy `docs/plans/` folder was retired. Content is
  unchanged; `git log --follow` carries the history. One stale path survives
  inside the changelog at §4 — the `docs/plans/` reference there records what a
  command printed on 2026-09-27 and is deliberately not rewritten.
- **Related folder.** [`docs/shell-theme-byok/`](../shell-theme-byok/) owns the
  BYOK transport decision this plan builds on.
