# The prompt bar explains what happened to the prompt, and a structured refusal renders on the surface it arrived from

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.8 — Message surfaces and restoration
(PLAN decisions 24, 26: `modules/05-the-desk/PLAN.md`)

## What to build

The desk has two places to speak, and each message goes to the one that was
asked.

**The prompt bar explains what happened to the prompt.** Anything rejected
*before* a build starts speaks there: a prompt the resolver refuses, or a build
refused because another one holds the lease. The 400ms refusal flash **stays as
the attention cue and stops being the whole message** — a wordless flash tells the
user something went wrong and nothing about what. The prompt notice that carries
refusals in the shipped shell finds its counterpart on the desk in the prompt bar
itself.

**A structured refusal renders on the surface it arrived from.** The 422 and 409
responses that are retargeted into a per-capability error node today render **in
the window** when the window is what asked, and **on the prompt bar** when the
prompt bar is what asked. A desk-furniture action that is refused before it can
take the window — for example Delete while a build still owns that window — also
speaks on the prompt bar. One ownership rule, no per-error routing table.

Per-field validation errors are a different matter and are settled by 5.10/04 —
those belong in the field, not on either surface.

The prompt-bar message is one replaceable `aria-live` slot, not a stack or a
timer. A refusal preserves the typed prompt and remains readable until the user
edits/retries or another desk message replaces it; editing clears the stale
sentence, an admitted prompt follows the existing clear-on-success lifecycle, and
focus stays in the originating control. Desk-furniture messages use the same slot
and are replaced/cleared by the next relevant desk action.

## Acceptance criteria

- [ ] A prompt the resolver refuses speaks on the prompt bar, in words, with the
      flash as the cue rather than the message
- [ ] A build refused because another holds the lease speaks on the prompt bar
- [ ] A 422 or 409 arising from a window action renders in the window
- [ ] A 422 or 409 arising from a prompt-bar action renders on the prompt bar
- [ ] A logo/desk-furniture action refused before window takeover renders on the
      prompt bar and leaves the current window content mounted
- [ ] No notice component is added to the desk
- [ ] Prompt messages replace rather than stack, announce through one live slot,
      preserve refused input/focus, and clear on edit or the next successful/replacing action
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Submit a prompt the resolver refuses and read the reason on the prompt bar rather
than watching a wordless flash. Start a build, then submit a second prompt while
the lease is held, and confirm the refusal speaks on the bar. Trigger a structured
refusal from inside a capability's window and confirm it renders there.

## Blocked by

- modules/05-the-desk/5.8-message-surfaces-and-restoration/issues/02-the-window-explains-what-happened-and-holds-until-dismissed.md
