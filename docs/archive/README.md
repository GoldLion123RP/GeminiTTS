# Archive

Superseded documentation, kept for history. Nothing here is authoritative — when
something in this folder contradicts [`AGENTS.md`](../../AGENTS.md) or
[`DESIGN.md`](../../DESIGN.md), those win.

## When to archive

- A document that has been rewritten and whose old version still has reference
  value.
- A plan that shipped, was abandoned, or was superseded by a newer plan.
- A note whose finding is stale but whose reasoning is still useful.

Do **not** archive a document just because it is old. If it is still true, it
belongs in [`docs/`](../README.md).

## How to archive

1. Move the file into this folder.
2. Change its H1 to mark it as archived, and add a line under the `desc` marker
   saying what replaced it and when:

   ```markdown
   # Old Title (archived 2026-09-26)

   <!-- desc: Superseded by ../../docs/new-thing.md on 2026-09-26. -->
   ```

3. Run `bun run docs:sync` from the project root to regenerate this index and
   [`docs/README.md`](../README.md).
4. Fix any inbound links that pointed at the old location.

## Documents

<!-- sync:start -->

_No documents yet._

<!-- sync:end -->
