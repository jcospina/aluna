# Every colour pair passes AA for text and controls, and the focus ring splits by control kind

Status: ready-for-agent

## Epic

Module 5 — The Desk · Epic 5.11 — Contrast, motion and focus
(PLAN decisions 43, 45; C12's green swap already landed in 5.1/01:
`modules/05-the-desk/PLAN.md`)

## What to build

**The contrast audit.** WCAG AA contrast for text and controls is a real
commitment, and it is affordable **because the palette and its allowed uses are
closed**. The audit enumerates and pins every foreground/background pairing the
product actually declares for text, controls, focus and destructive state. It
does not make the false claim that every arbitrary palette colour must pass
against every other palette colour.

The rest narrows to best-effort — keyboard navigation, semantic landmarks and
reduced motion are honoured but are **not release gates**. That is a deliberate
narrowing, not an omission: a commitment that cannot be verified once and held is
not a commitment.

C12 was the one measured failure and was resolved at the palette in 5.1/01 rather
than accepted, by swapping the two greens. Ochre was the alternative and was not
taken: it is the only unused anchor that carries ink safely, at 5.01, but a gold
beside a green primary reads as a different *kind* of action rather than a quieter
version of the same one. This issue confirms every pair, C12 included, and records
the numbers.

**The focus-ring split.** A text input shows the focus ring on **any** focus;
every other control shows it on **keyboard focus only**. A ring on a clicked text
input tells you where typing will land, which is real information; a ring on a
clicked button tells you nothing you did not just do.

The design's ring is adopted as drawn — 3px violet on the enclosing shell, inner
ring suppressed. The split resolves a live contradiction in the shipped app, where
the field stylesheet paints on plain focus against the accessibility layer's
keyboard-only rule. Four rings escaped that override — the prompt bar, the search
rail, the segmented control, and the global default in the base stylesheet, which
painted violet only because a later file overrode its colour. All four are settled
under `design/styles/` already: the ring token lives in the token layer, the base
stylesheet names it directly, the two-file override mechanism is gone, and no
outline reaches for the signal colour any more. This issue confirms that state
survives the port and that no fifth ring appears.

## Acceptance criteria

- [ ] Every declared product foreground/background pairing passes the applicable
      AA text or non-text control threshold, C12 included, pinned by an assertion
      rather than a one-time check
- [ ] The allowed-pair inventory is exhaustive against shipped component/token
      references, so adding a new pairing fails the audit until classified
- [ ] The measured ratios are recorded in the issue notes
- [ ] A text input paints the focus ring on a mouse click; a button does not
- [ ] Every control paints the ring on keyboard focus
- [ ] The ring is 3px violet on the enclosing shell with the inner ring
      suppressed; no outline anywhere reaches for the signal colour, and no
      two-file override mechanism survives
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Click into a text input and see the ring; click a button and see none. Tab through
the same form and see the ring on everything. Open the palette page and confirm
every pair's recorded ratio.

## Blocked by

- modules/05-the-desk/5.10-form-choice-long-text-guidance-errors/issues/05-the-button-set-and-the-list-of-strings-control.md
