# Plans

<!-- desc: Legacy folder of plans written before the topic-folder convention. Read-only. -->

**Do not write here.** New plans, audits, and web evidence go in a new topic
folder under `docs/` — `docs/<topic-slug>/plan.md`, `docs/<topic-slug>/audit.md`,
and `docs/<topic-slug>/data/` — per
[`.agents/rules/plan_and_documentation.md`](../../.agents/rules/plan_and_documentation.md).
This folder is kept for history so the links in `docs/README.md` stay valid.

Status is declared on line 1 of every plan — `Status: Review-Only` or
`Status: Proceed-Authorized`. Drafting is review-only; never execute a plan's
phases in the same turn it was written unless explicitly told to.

## Documents

<!-- sync:start -->

| Document | Description |
| :--- | :--- |
| [App Shell, Theme, Multi-Page Split & Browser-Direct BYOK — Implementation Plan](plans/2026-09-26-shell-theme-multipage-byok-plan.md) | Four-tier plan for the app shell (header/footer), the tri-state theme, the three-page split, and a browser-direct BYOK mode. |
| [Pages Deployment, BYOK Diagnostics, Light-Theme Borders & Panel Spacing — Implementation Plan](plans/2026-09-27-pages-byok-theme-spacing-defects-plan.md) | Four-tier plan for the four defects reported 2026-09-27: the static GitHub Pages deployment cannot serve the .env key, BYOK reports failures under the wrong cause, light-mode borders sit at 1.14:1, and ByokSettings has no top margin. |
| [Defect Evidence — Pages deployment, BYOK, light-theme borders, panel spacing](plans/data/2026-09-27-defect-evidence.md) | Probe output, contrast arithmetic, and source locations for the four defects reported 2026-09-27 from screenshots of goldlion123rp.github.io/GeminiTTS. Every row names the command that produced it. |

<!-- sync:end -->
