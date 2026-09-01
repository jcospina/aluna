# Every colour pair passes AA for text and controls, and the focus ring splits by control kind

Status: done

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

- [x] Every declared product foreground/background pairing passes the applicable
      AA text or non-text control threshold, C12 included, pinned by an assertion
      rather than a one-time check
- [x] The allowed-pair inventory is exhaustive against shipped component/token
      references, so adding a new pairing fails the audit until classified
- [x] The measured ratios are recorded in the issue notes
- [x] A text input paints the focus ring on a mouse click; a button does not
- [x] Every control paints the ring on keyboard focus
- [x] The ring is 3px violet on the enclosing shell with the inner ring
      suppressed; no outline anywhere reaches for the signal colour, and no
      two-file override mechanism survives
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Living demo

Click into a text input and see the ring; click a button and see none. Tab through
the same form and see the ring on everything. Open the palette page and confirm
every pair's recorded ratio.

## What landed

**The audit.** `src/presentation/contrast.ts` resolves a colour the way a browser
does — a token, a token composited at an `opacity`, or a `color-mix()` in oklab or
oklch — and measures WCAG 2.2 contrast between two of them. The oklab arithmetic
was checked against Chrome's own `color-mix()` and agrees byte for byte; oklch does
not, because a browser drops the hue of a near-achromatic side, so `worstContrast`
measures both readings and takes the tighter one.

`src/presentation/contrast-audit.ts` holds the terms, and
`contrast-pairings-surface.ts` and `contrast-pairings-controls.ts` hold the 42
rows. `contrast-audit.test.ts` asserts four things: every row clears the threshold
that applies to it; C12's two halves are still 5.18 and 4.54, measured rather than
remembered, and no light label is back on leaf; every `color`, `outline`, `opacity`
and derived fill in every shipped stylesheet is claimed by a row; and every palette
token the stylesheets name as type or as a fill reaches the inventory. A row may
stand in for lighter fills through `alsoCovers`, and that claim is verified rather
than taken.

The boundary is stated in the test: a plain `background: var(--token)` is covered
by the token check rather than as a site, and no static analysis can catch a *new
combination* of two tokens already in the inventory, because which fill a rule
lands on is a fact about the DOM.

**The focus ring.** `focus-ring.test.ts` pins the split. One global
`:focus-visible`, in `design/styles/base.css`, at 3px `var(--focus-ring)`; every
other ring rule paints exactly that; no outline names `--signal`; every any-focus
ring belongs to an enumerated text-input shell and every other waits for
`:focus-visible`; every shell that rings suppresses the control inside it.

## What the audit found

C12 was not the only failure. The audit was button-shaped before this issue, and
everything outside the button set was unmeasured.

| Failure | Was | Resolution |
|---|---|---|
| `--ink-3` on `--surface` / `--surface-2` — guidance, placeholders, counts, the empty state | 2.86 / 2.67 | `--ink-3` #8b9c82 → **#64745c**, and what it may sit on is closed to the two window fills |
| `--ink-2` on `--ground-deep` and on `--pane-2` — an option's note under the keyboard, prose in a clay note | 4.42 / 4.32 | `--ink-2` #55684e → **#52644b** |
| The focus ring on the desk | 2.64 | `--violet` #9a86c4 → **#8f7bb9**; it now has exactly one consumer, `--focus-ring` |
| `.devpanel__atom` — violet on the dark well, pulling against the ring | 4.38 | → `--ochre` at 5.01 |
| `.devpanel__punct` and the resting stage — `--ink-3` is faint by being *darker* | would have become 2.79 | the well derives its own faint, `color-mix(in oklab, var(--surface), var(--ink) 40%)` at 5.47 |
| `.pill--ok` — a light label on leaf, the exact pairing C12 took off the primary button | 3.01 | label → `--ink` at 4.54 |
| `--teal` as type — `.eyebrow`, `.gallery__name`, `.numbers em`, `.specimen__meta` | 3.15 | → `--shade` at 5.18. Teal carries no readable text, which is why it is not a button either |
| `a` in `--signal`, on the desk and in a sky note | 3.97 / 3.77 | → `--ink`; the underline does the identifying |
| `.menubar a` — dimmed to 0.66 while its declared colour was 8.13 | 3.67 | opacity → 0.78, and hover is a rule rather than a second colour |
| `.window__grip::after` — the resize affordance | 2.62 | opacity 0.45 → 0.55, clearing §1.4.11's 3:1 |
| **Hover on the secondary and feature buttons.** "Hover steps the fill 13% toward ink" cannot hold on a palette whose tightest pairs are 4.54 and 4.72 | 3.74 / 3.87 | hover steps the fill **away from the label it carries** — `--btn-hover-toward`. Still one derived line; no variant now reads worse hovered than at rest |
| **The picker rang on a mouse click.** `.field__control` *is* the listbox button, so `:focus-within` matched the element itself | — | split into `:has(:is(input, textarea):focus)` for text and `:focus-visible` for the control |
| **The search rail rang around its Clear button** (introduced and caught in this issue) | — | scoped to `:has(.capability-search__input:focus)` |
| **The prompt rail rang around Make it** — `:focus-within` matched the submit button | — | scoped to `:has(.prompt-bar__input:focus)` |
| `public/css/a11y.css` restated the global ring at 2px and won by loading later | shipped 2px | deleted — the two-file override mechanism itself |

Four restatements of the global ring were removed with it: `.capability-item`,
`.capability-record-view__back`, `.capability-deletion h1`'s colour-only rule, and
`.capability-search__clear`'s 2px ring. `desk-window.test.ts` now sizes its scroll
gutter from the one ring in `base.css` rather than from a copy of it.

One deliberate non-change: `src/capability-logo/request.ts` keeps `amethyst` at
#9a86c4. That ladder is the vocabulary sent to the image generator and is pinned to
its former bytes on purpose; it is not a reference to `--violet`, and nothing puts
the two side by side.

## The measured ratios

Every row of the inventory, measured from the live token values. `exempt` names a
WCAG §1.4.3 exception — an inactive control, or a fill nothing is read against.

| What | Pairing | Measured | Threshold |
|---|---|---|---|
| ink on a window, a card, a menu or the prompt rail | `ink` on `surface` | 13.68 | 4.5 |
| ink in an input, an item or a spec table | `ink` on `surface-2` | 12.77 | 4.5 |
| ink on the desk | `ink` on `ground` | 11.59 | 4.5 |
| ink on the tightest title-bar pane, and a link on a clay note | `ink` on `pane-2` | 10.01 | 4.5 |
| an unfocused window title | `ink @0.72 over pane-2` on `pane-2` | 4.77 | 4.5 |
| a link on the menu bar | `ink @0.78 over sky` on `sky` | 4.86 | 4.5 |
| ink on sky | `ink` on `sky` | 8.13 | 4.5 |
| ink on sun | `ink` on `sun` | 7.50 | 4.5 |
| ink on clay | `ink` on `clay` | 4.72 | 4.5 |
| ink on leaf | `ink` on `leaf` | 4.54 | 4.5 |
| ink on the deletion notice | `ink` on `sun + 70% surface` | 11.58 | 4.5 |
| ink in an invalid field | `ink` on `well-alert` | 11.85 | 4.5 |
| a light label on the primary button | `surface` on `shade` | 5.18 | 4.5 |
| a light label on the danger button | `surface` on `signal` | 4.68 | 4.5 |
| a payload in the developer well | `surface` on `ink` | 13.68 | 4.5 |
| a name read straight off the wallpaper | `surface` on `ink @0.85 over ground` | 8.89 | 4.5 |
| the developer tile's name | `surface @0.85 over ink @0.85 over ground` on `ink @0.7225 over ground` | 4.80 | 4.5 |
| secondary type on a window, a card or a menu | `ink-2` on `surface` | 6.25 | 4.5 |
| a placeholder in an alert well | `ink-2` on `well-alert` | 5.42 | 4.5 |
| secondary type on an item or a table head | `ink-2` on `surface-2` | 5.84 | 4.5 |
| secondary type on the desk | `ink-2` on `ground` | 5.30 | 4.5 |
| an option's note under the keyboard | `ink-2` on `ground-deep` | 4.68 | 4.5 |
| prose in a tinted note | `ink-2` on `pane-2` | 4.58 | 4.5 |
| guidance, a placeholder and faint detail on a window | `ink-3` on `surface` | 4.90 | 4.5 |
| a placeholder inside a well | `ink-3` on `surface-2` | 4.57 | 4.5 |
| a kicker, an eyebrow and a measured caption | `shade` on `surface` | 5.18 | 4.5 |
| an alert sentence | `signal` on `surface` | 4.68 | 4.5 |
| a key in the developer well | `sky` on `ink` | 8.13 | 4.5 |
| a string in the developer well | `leaf` on `ink` | 4.54 | 4.5 |
| a number in the developer well | `sun` on `ink` | 7.50 | 4.5 |
| an atom in the developer well | `ochre` on `ink` | 5.01 | 4.5 |
| punctuation and a resting stage in the developer well | `surface + 40% ink` on `ink` | 5.47 | 4.5 |
| the mark in a checked box or radio | `ink` on `leaf` | 4.54 | 3.0 |
| a glyph on a control — search, grip | `ink-3` on `surface-2` | 4.57 | 3.0 |
| the resize grip | `ink @0.55 over surface` on `surface` | 3.39 | 3.0 |
| the resize grip on the window in front | `ink @0.75 over surface` on `surface` | 6.13 | 3.0 |
| an ink-labelled button under the pointer | `ink` on `leaf + 13% surface` | 5.37 | 4.5 |
| a light-labelled button under the pointer | `surface` on `signal + 13% ink` | 5.40 | 4.5 |
| the outline button under the pointer | `ink` on `surface-2 + 6% ink` | 11.34 | 4.5 |
| the scrim over a build you are about to leave | `ink` on `surface` | 13.68 | exempt |
| the focus ring inside a window | `focus-ring` on `surface` | 3.60 | 3.0 |
| the focus ring on the desk | `focus-ring` on `ground` | 3.05 | 3.0 |
| the focus ring brought in to meet a drawn line | `focus-ring` on `ink` | 3.80 | 3.0 |
| a disabled control | `ink-3` on `surface` | 4.90 | exempt |
| a chevron and a mark | `ink` on `surface-2` | 12.77 | 3.0 |
| the browser's own date picker indicator | `ink @0.55 over surface-2` on `surface-2` | 3.32 | 3.0 |
| a control the browser paints from an accent | `shade` on `well-alert` | 4.48 | 3.0 |
| a leaf mark on the window — the range, and the search spinner | `leaf` on `surface` | 3.01 | 3.0 |
| secondary type on a developer preview | `ink-2` on `shade @0.1 over ground` | 4.68 | 4.5 |
| type on a developer preview | `ink` on `shade @0.1 over ground` | 10.24 | 4.5 |

## What the adversarial review found

Two reviewers went at it — one at the audit's honesty and completeness, one at the
focus ring. Everything below is fixed.

**Two AA failures the first inventory misfiled.** `--well-alert` fills the whole
field on a radio, segmented or checkbox presentation, so the error sentence was
`--signal` on the alert well at **4.06**, not on the window at 4.68. The fill now
stops at the sentence. Inside a text field's alert well the placeholder was
`--ink-3` at **4.24**; a redder well takes `--ink-2` at 5.42.

**Two more places the focus ring did not clear 3:1.** A title-bar lamp stands on
the panes, where violet is 2.64–2.94; its ring is now drawn at no offset, against
the lamp's own 2px ink circle at 3.80 — the same G195 argument the segmented
control's inset ring already made. The menu bar filled with `--sky`, where violet
is **2.14** and nothing in the palette clears it; the bar is `--surface` now and
keeps its identity from the ink rule under it.

**C12's pairing was still alive on a glyph.** A checked box's tick and a radio's
dot were `--surface` on `--leaf` at 3.01 — passing only because a glyph owes 3:1
rather than 4.5. Both are ink now, at 4.54. Owing less is not a reason to spend it.

**The developer preview pages were faint on the desk.** `.preview-note` was
`--ink-3`, which on `--ground` is 4.15; those pages have no window under them, so
it is `--ink-2` at 5.30.

**And the audit itself had holes.** Every one is closed:

| Hole | Now |
|---|---|
| A site was keyed by selector, so recolouring a claimed declaration was silent | Each site is bound to the colour it paints: the tokens in the declaration must be ones the pairing measures |
| An `opacity` names no colour, so a dim could go unmeasured | A dimming has to match an alpha some pairing states |
| Only `color`, `outline`, `opacity` were read — a UA checkbox takes `accent-color`, a spinner `border-top-color`, and `-webkit-text-fill-color` overrides `color` outright | Fifteen properties, and the three live ones are classified |
| `AUDITED_SHEETS` was a hand-kept literal | Checked against the two manifests' `@import`s, every `.css` beside them, and every source carrying a `<style>` |
| Four served pages carry their stylesheet inline and were unaudited | All four are in the list |
| A second `outline:`/`color:` in one rule was invisible, and the browser paints the last | Last wins, as it does in a browser; CSS nesting is refused rather than mis-parsed |
| `box-shadow` was an unguarded way to draw a fifth ring in the alert colour | No `box-shadow` may sit on a `:focus` selector |
| `outline-offset` on its own was a two-file override the test did not name | An offset must sit in the rule that declares its ring, and come from a stated set |
| The any-focus shell list was a licence — adding a line to it admitted anything | A shell has to name a text control inside its `:has()`, and may not name a button |
| Suppression was checked per sheet, not per shell | Each shell names the rule that silences its control |
| `resolveCandidates` held the first colour's hue rather than the chromatic one | Holds whichever side carries the chroma |
| The window's fill and its five panes are painted from JavaScript, so eighteen rows measured a background no sheet declares | `window-frame.js` is asserted to name those tokens and no others |
| The desk label was measured against a halo that does not dim with it | The dimmed tile has its own row at 4.80, and the note is plain that a shadow is not a background |

**One behavioural consequence, recorded.** A refusal moves focus to the field it
is about, and after a mouse-clicked submit the browser rightly calls that focus
non-keyboard — so a picker or a segmented row would have been landed on with no
ring. The four places the product moves focus itself now ask for it with
`focus({ focusVisible: true })`, declared in `types/focus-visible.d.ts` because the
DOM lib has not caught up with the standard.

**One finding that was not a defect.** `--teal` is named by no stylesheet any more,
but it is not dead: `teal_green` is a logo family, so it is a colour a capability
wears rather than one the platform paints.

## Verification

- `bun run test` — 2449 passed, 0 failed. `bun run typecheck` and `bun run lint`
  clean.
- The audit's own guards were mutation-tested: a later file offsetting the global
  ring, a second `outline` in the same rule, a `box-shadow` focus indicator, and a
  recoloured declaration all fail now and all passed before.
- Live, on the running dev server, with real clicks and real document focus:
  clicking a text input rings its shell `rgb(143, 123, 185) solid 3px` with the
  inner control at `none`; clicking the picker button rings nothing, and neither
  does clicking a title-bar lamp; tabbing to either rings it — the lamp at offset
  `0px`, against its own line; tabbing to the prompt rail's Make it rings the
  button and not the rail; tabbing on to a logo on the desk rings the logo.
- The palette page renders every pairing's measured ratio from the tokens, with
  anything under 4.5:1 marked, so the page and the audit cannot drift apart.

## Blocked by

- modules/05-the-desk/5.10-form-choice-long-text-guidance-errors/issues/05-the-button-set-and-the-list-of-strings-control.md
