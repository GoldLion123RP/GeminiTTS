# Plans → data

<!-- desc: Measured evidence, probe output, and reproduction commands behind the plans in this folder. A plan states what to build; the data folder records what was observed to justify it. -->

Every claim in a plan that says a defect *exists* rather than *might* exist has a
corresponding row here, with the command that produced it. Anything a plan asserts
without an entry here is an assumption, and is labelled as one.

Regenerating an entry means re-running its command. Numbers that drift are a bug in
the entry, not noise — update the entry in the same commit as the code change that
moved the number.

## Documents

<!-- sync:start -->

| Document | Description |
| :--- | :--- |
| [Defect Evidence — Pages deployment, BYOK, light-theme borders, panel spacing](2026-09-27-defect-evidence.md) | Probe output, contrast arithmetic, and source locations for the four defects reported 2026-09-27. |

<!-- sync:end -->
