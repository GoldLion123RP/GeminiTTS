# Shell, Theme & BYOK

Planning folder for the app shell, the tri-state theme, the three-page split, and
the browser-direct BYOK mode. The location contract is defined in
[`.agents/rules/plan_and_documentation.md`](../../.agents/rules/plan_and_documentation.md).

**Status: in progress.** Phase 6.6 is the only item left and it is blocked on a
credential, not on work — `bun run verify:stt` has never been executed because no
`GEMINI_API_KEY` was available. Read the `Status:` line on line 1 of
[`plan.md`](plan.md) for the authoritative position.

## Documents

<!-- sync:start -->

| Document | Description |
| :--- | :--- |
| [App Shell, Theme, Multi-Page Split & Browser-Direct BYOK — Implementation Plan](plan.md) | Four-tier plan for the app shell (header/footer), the tri-state theme, the three-page split, and a browser-direct BYOK mode. |

<!-- sync:end -->

## Notes

- **No `audit.md`.** This plan predates the plan + audit pair being required on
  disk; its Tier-1.4 analysis is §2 of the plan itself. An agent executing it
  should treat §2 and the `> [!CAUTION]` block at the top as the audit.
- **Provenance.** Written 2026-09-26 as
  `docs/plans/2026-09-26-shell-theme-multipage-byok-plan.md` and moved here on
  2026-09-27 when the legacy `docs/plans/` folder was retired. Content is
  unchanged; `git log --follow` carries the history.
- **Relationship to the other topic.** The BYOK design decided in Phase 0 here is
  what makes [`docs/pages-deployment-defects/`](../pages-deployment-defects/) a
  separate problem: on a static deployment there is no server key, so BYOK
  becomes the default rather than the opt-in. Read §2.2 of this plan before
  changing anything in `src/lib/client/keystore.ts`.
