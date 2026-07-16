## Agent skills

### Issue tracker

Issues live as local markdown files under `modules/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.

### Delivery summaries

Lead every final delivery summary with clear, plain-English product outcomes:
what changed for the product, what users can now accomplish or what problem is
solved, and how the work moves the product or project forward. Put technical
implementation details and verification in a separate section afterward; they
must not lead or obscure the product outcome.

Format:

```
# Product outcome

Aluna can now ...
- bullet
- points
- listing
- new stuff

# How this moves us forward

Paragraph explaining how this moves us forward to reach the overall goal stated in the architecture

# Technical Details

Implementation details
```

### Living demo and HITL

Relevant runtime work must be wired into the current homepage demo as soon as it
can be exercised, even if the demo is temporary or ugly. The demo is replaced
piece by piece by real functionality; do not leave integration gaps invisible
until the final end-to-end slice.

Every completed turn must end with human-in-the-loop (HITL) test instructions:
what command to run, what URL or route to open, what prompt/action to try, and
what visible behavior confirms the work.

### How to approach an issue

Repo has lots of documents that can eat up context quickly. Use subagents to read documents and get the big picture and needed details from them instead of reading them on the main session. This will keep the session clean for the actual work.
Use subagents as well to run quality and adversarial tests before running the live test.
