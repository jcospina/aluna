## Agent skills

### Issue tracker

Issues live as local markdown files under `modules/`. See `docs/agents/issue-tracker.md`.

### Triage labels

This repo uses the default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.

### Delivery summaries

Lead every final delivery summary with clear, non-technical plain-English product
outcomes: what changed for the product, what a user can now accomplish or what
problem is solved, and how the work moves the product or project forward. Put
technical implementation details and verification in the section after that.
Never let them lead, and never let them obscure the product outcome.

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

Wire relevant runtime work into the current homepage demo as soon as it can be
exercised, even if the demo is temporary or ugly. Real functionality replaces the
demo piece by piece. Do not leave an integration gap invisible until the final
end-to-end slice.

Every completed turn must end with human-in-the-loop (HITL) test instructions:
what command to run, what URL or route to open, what prompt/action to try, and
what visible behavior confirms the work.

### How to approach an issue

This repo holds a lot of documents, and reading them in the main session eats
context fast. Send a subagent to read them instead, and have it report back the
big picture plus the specific details you need. Keep the main session clear for
the actual work. Send subagents to run quality and adversarial tests before the live test. Fix
every adversarial finding. An issue with an unfixed adversarial finding is not
done.

Choose the model and the number of subagents deliberately. Reading code and docs
for a summary is cheap-model work (Sonnet for Claude, Terra for Codex). Harder
tasks need a SOTA model, and adversarial testing always does. The main session always runs the most powerful model at the highest effort. No
subagent may run at settings higher than the main session.

### Coding guidelines

- There are hooks configured to run linter and formatter after every file edit. Never try to bypass them by adding exceptions to the rules stated there. 
- Do not pollute the codebase with comments. Comments are useful to explain not obvious things or as JSDOC. Commenting every line, style or function just for the sake of commenting makes the code larger than it needs to be.
