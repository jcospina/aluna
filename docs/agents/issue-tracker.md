# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `modules/`.

## Hierarchy

The tracker mirrors the build plan in `docs/modules.md`: **modules** contain **epics**, and epics contain **issues**.

```
modules/<module-slug>/<epic-slug>/issues/<NN>-<slug>.md
```

## Conventions

- One MODULE per top-level directory: `modules/<module-slug>/` — a high-level phase from `docs/modules.md` (e.g. `01-platform-scaffold-runtime-spine`).
- One EPIC per sub-directory: `modules/<module-slug>/<epic-slug>/` — keep the spec's epic number in the slug (e.g. `1.1-project-and-toolchain`) so it sorts and traces back to `docs/modules.md`.
- Implementation issues live under the epic: `modules/<module-slug>/<epic-slug>/issues/<NN>-<slug>.md`, numbered from `01`.
- An optional PRD for an epic is `modules/<module-slug>/<epic-slug>/PRD.md`.
- **One issue belongs to exactly one epic.** An issue never spans multiple epics. An epic is covered by one or more issues — usually several small, independently-actionable ones; occasionally just one if the epic is genuinely atomic. Prefer fine granularity so an AFK agent can pick up any single issue and finish it in isolation.
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings).
- "Blocked by" references use the full repo-relative path to the blocking issue file.
- Comments and conversation history append to the bottom of the file under a `## Comments` heading.

## When a skill says "publish to the issue tracker"

Create a new issue file under the owning epic: `modules/<module-slug>/<epic-slug>/issues/` (creating the module and epic directories if needed). Keep each issue scoped to a single epic.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.
