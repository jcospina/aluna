# Re-derive the design-lint rung against High Meadow, and ban font family, radius and shadow

Status: done

## Epic

Module 5 — The Desk · Epic 5.1 — The token layer, and the corpus it invalidates
(PLAN decision 10 (three closed axes plus three of the four bans; the `border`
ban lands in 5.2/02 once the ink system covers generated boundaries):
`modules/05-the-desk/PLAN.md`)

## What to build

The design-lint rung's approved-value list re-derives against High Meadow names,
and three of ADR-0005's four new bans land with it. Until this issue is done no
capability can be built at all, because the rung still demands the token
vocabulary 5.1/01 deleted — which is why it comes second and nothing comes
between them.

Three axes stay closed and are picked from a list:

| Property | Rule |
|---|---|
| colour | only `var(--<token>)` from the High Meadow palette |
| type size | only from the High Meadow size set |
| spacing | only from the High Meadow spacing set |

Three properties are never declared at all:

| Property | Why |
|---|---|
| font family | inherited from the surface it sits on |
| `border-radius` | no radius tokens exist; a square corner is the absence of a declaration |
| `box-shadow` | nothing inside a window casts, and the shadow tokens are bare `<x> <y> <alpha>` numbers, so `var(--shadow-*)` produces an invalid value that fails silently |

Radius and shadow are absences in High Meadow rather than shorter lists, so
inventing token sets for them would contradict the design. The shadow ban is the
only thing that catches the shadow case at all, because it fails silently rather
than visibly.

ADR-0005's fourth closed axis, border weight, gets no successor list — but its
ban waits for 5.2/02, because a generated card with neither a border nor a drawn
boundary is invisible.

## Acceptance criteria

- [x] The rung rejects a raw value on each of the three closed axes and names the
      High Meadow token set in the refusal
- [x] The rung rejects any declaration of font family, `border-radius` or
      `box-shadow`, including the silently-invalid `box-shadow: var(--shadow-md)`
- [x] The rung accepts every High Meadow token on each closed axis, including the
      renamed ones, with no residual reference to the retired vocabulary
- [x] A capability built from the prompt bar clears the gate and renders its
      records in High Meadow — the first build on the new token layer
- [x] `bun run test`, `bun run typecheck`, `bun run lint` clean

## Implementation notes

- The token *names* the contract closes on now live once, in
  `src/presentation/design-tokens.ts`: the sixteen-colour High Meadow palette, the
  type-size ladder, the spacing steps, and the one line weight. The file states no
  value, and `design-tokens.test.ts` cross-checks every name against
  `design/styles/tokens.css`, so a token renamed in High Meadow fails the suite
  rather than quietly becoming an off-token value at build time.
- `style-discipline.ts` re-derives its predicates against those sets and gains the
  three bans. `border-radius` goes in every form — physical and logical longhands,
  vendor prefixes, and a bare `0`, because a square corner is the absence of a
  declaration rather than a value. `box-shadow` goes the same way; nothing before
  this caught it at all, since the enforcer left the whole declaration alone and
  the shadow tokens are bare `<x> <y> <alpha>` triples that paint nothing.
- The same walk now has a second reading. `describeStyleViolation` names the first
  declaration that would be dropped and the set it should have picked from, so a
  refusal reads in the contract's own words instead of as a before/after diff, and
  the two can never disagree about what conforms.
- `inline-style-scan.ts` reads `style` through the enforcer's own parser rather
  than a regex over the markup. That is what makes the refusal safe: the hostile
  probes carry `<b style="color: #ff0000">`, and a renderer that escapes it
  correctly renders those characters as inert text a regex cannot tell from an
  attribute. Parsing also decodes entities, which removes the residual the raw
  scan used to hand to the enforcer diff.
- The border-weight axis keeps a single accepted name, `var(--line)`. It gets no
  successor ladder because High Meadow has one weight, and the declaration itself
  survives only until 5.2/02 hands generated boundaries to the ink system.
- The injected generation contract enumerates the three sets and the three bans in
  full, rather than pointing at a `--color-*`-style prefix High Meadow does not
  have. It also states the two colours that carry a meaning the Gate cannot check:
  `--ink` draws lines and type and is never a fill, and `--signal` is reserved for
  alerts and destructive confirmation.
- `/demo/few-shot-gallery` returns behind its dev-only guard, which is where 5.1/01
  parked it. A new regression pins every exemplar's rendered record to the
  re-derived rung, so the gallery can never teach a composition the Gate refuses.
- Hardening from the adversarial pass, all of it closing a way past the three axes
  or the three bans rather than adding a fourth rule. Every check now reads one
  canonical property name — vendor-deprefixed, and refused outright unless it is a
  plain CSS ident, because `\66 ont-family` *is* `font-family` to a browser while
  reading nothing like it as a string. Axis membership became a predicate rather
  than a list: `-webkit-text-fill-color` paints type and `background` fills a
  surface exactly as `color` and `background-color` do, and an axis enumerating its
  way around them is closed in name only. `background` moving onto the colour axis
  is what stopped a gradient and the chrome's own `--title-bar` being painted onto
  a record.
- One of those was a security defect rather than a brand one. `HTMLRewriter` hands
  back the *raw* attribute text while the browser's parser decodes it, so
  `background-image: &#x75;rl(...)` read as a harmless `rl(` here and still loaded
  the resource on screen. A CSS value a record writes has no use for `&`, so it
  joins `\` in the smuggling-shape class and the whole family closes at once. The
  comment claiming values arrive entity-decoded was wrong and is gone.
- The shadow ban is written around the effect, not the property name, because its
  stated reason is that nothing inside a window casts: `text-shadow` and
  `filter: drop-shadow(...)` go with `box-shadow`. `all` joins them for the same
  kind of reason — it resets the inheritance the font-family ban depends on.
- Two refusals were false, and both were worse than they looked: `var( --ink )` and
  `color: var(--ink) !important` are legal spellings of an on-token value, and
  refusing them told the model to name the token it had just named — a fix loop
  that could not converge, failing a conforming build closed. An exhaustive
  property × value grid now pins `describeStyleViolation` and `sanitizeStyle` to the
  same verdict, including the empty `style` attribute they used to disagree about.
- ADR-0005's original §4 axis list is marked superseded in the ADR-0001 manner
  rather than left to be read as current, and `design/design-system.md` now says
  which of its four bans the gate enforces today and why `border` waits for 5.2.

## Verification

- `bun run test` — 1,203 passed, 0 failed. `bun run typecheck`, `bun run lint`,
  `git diff --check` — clean.
- **The first build on the new token layer.** "Track the books I read, with the
  title, author, the date I finished it, and my rating out of five" from the
  prompt bar, on `gpt-5.6-terra`: `structural passed · smoke passed · behavioral
  passed · design-lint passed (8,950ms)`, activated as `reading_log`. The
  generated `item.ts` reaches only for High Meadow — `var(--sun)`, `var(--sky)`,
  `var(--ink)`, `var(--line)`, `var(--space-1)`, `var(--space-2)` — with no radius,
  no shadow, no font family, and nothing left of the retired vocabulary.
- Browser check at `http://localhost:3030/`: a record added through the form
  renders with the rating chip computing to `rgb(242, 179, 44)` (`--sun`), the
  finished chip to `rgb(127, 210, 224)` (`--sky`), boundaries to `2px rgb(32, 48,
  28)` (`--line` and `--ink`), padding to `4px 8px` (`--space-1`/`--space-2`),
  `border-radius: 0px` and `box-shadow: none`. No console errors.
- `/demo/few-shot-gallery` renders the three exemplars through the live
  presentation path on High Meadow, and the injected contract reads back with the
  three sets and the bans enumerated.
- Two independent adversarial passes and one quality pass. The first found seven
  bypasses and two false positives; the second confirmed those closed and found
  four more, including a render-time defect in the enforcer. Every finding was
  repaired and is covered by a regression. The second pass's fuzz — 106,260
  structured inputs plus 400,000 random strings — reports no disagreement between
  `sanitizeStyle` and `describeStyleViolation`.

## Known and deliberately left

- `declarationsOf` splits a `style` value on `;` without regard for quoting, so
  `content: "a;b"` is refused as malformed. It fails closed — the split can only
  ever produce more checked declarations, never fewer — and reading it correctly
  needs a real CSS value parser, which is a larger change than this issue carries.
- `width`, `height`, `opacity`, `display` and the rest stay free. ADR-0005 puts
  them among the arrangement properties a record composes with, so a record can
  still make itself very large or invisible; that is composition the Gate does not
  referee, and the record-content probes are what keep a record meaningful.

## Living demo

Type a prompt into the prompt bar and watch a capability build green on the new
token layer, then browse its records. This is the slice that makes the corpus
deletion in 5.1/01 recoverable, so it is the first end-to-end proof that High
Meadow ships.

## HITL test instructions

1. `bun run dev` if the project is not already listening on port 3030, then open
   `http://localhost:3030/`.
2. A **Reading log** capability is already on the desk from this issue's live
   build. Open it and confirm the record reads correctly: a Fraunces-set desk, an
   amber rating chip and a pale-blue finished chip, each with a 2px ink boundary
   and **square** corners, and no shadow anywhere inside the window.
3. Click **New Reading log**, add a second book, and confirm it renders the same
   way — the design contract holds per record, not just for the first one.
4. Type a second, different prompt (say "keep track of the plants I water and when
   I last watered them") and watch it build. Confirm the narration reaches "I'm
   checking the first version now" and the capability activates on the desk.
5. Open the `</>` developer panel during that build and confirm the design-lint
   rung reports **passed**.
6. Optional: open `http://localhost:3030/demo/few-shot-gallery` and read the
   "Injected prompt preview" at the foot of the page. The three closed axes should
   be listed token by token, and the never-declared properties named with their
   reasons. That text is exactly what the generator receives.

## Blocked by

- modules/05-the-desk/5.1-token-layer-and-corpus-invalidation/issues/01-ship-design-styles-as-the-token-layer.md
