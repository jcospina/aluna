# Aluna design system

Read this before building any UI. It holds names — which classes exist, which
properties you pick from a list, which you never declare, what is banned — and it
holds no values. Every number lives in `design/styles/`, the shipped stylesheet.
Nothing is stated twice, so there is nothing for the two to disagree about.

Two kinds of markup reach the screen and the rules bind them differently. The
platform renders the chrome from code in this repo: the desk, the window, the
collection, the form, the buttons. A capability's item renderer produces the
markup inside a record, and a model writes it. That generated markup is what the
closed contract below constrains and what the gate checks, and
[ADR-0005](../docs/adr/0005-opinionated-capability-ui-design-contract-and-gate.md)
names this file as the source of truth for that class vocabulary. Both kinds obey
the same palette and the same line.

The system is settled on two pages you can open in a browser: `design/index.html`
for the desk and decisions D1–D14, `design/controls.html` for the control set and
C1–C12. Language and product voice live in [CONTEXT.md](../CONTEXT.md).

## Colour

The palette is High Meadow, and it is closed: a colour that is not a token does
not exist.

Five fills build every surface — `--ground` for the desk, `--ground-deep` for
bands and wells, `--surface` for windows and cards, `--surface-2` for inputs and
items — and `--ink` draws every line and sets every piece of type. `--ink` is
never a background and never a fill. Type at lower strengths takes `--ink-2` and
`--ink-3`, which never draw a line.

Eight tint anchors carry role and identity: `--leaf`, `--shade`, `--teal`,
`--sky`, `--sun`, `--ochre`, `--clay`, `--violet`. A capability's ground colour is
one of the eight, named by the model. `--signal` is not among them. It is
reserved for alerts and destructive confirmation, so a red on screen always means
one thing.

There is no dark theme. This palette is daylight and does not invert, and the
viewer's OS preference is ignored in both directions. A dark theme was decided
against rather than deferred, so no switching machinery exists and none is owed.

## Type

Two faces. `--font-display` is Fraunces, for headings and window titles;
`--font-body` is Outfit, for everything a capability generates. `--font-mono`
belongs to the developer panel alone, which shows raw payloads and stands outside
the product voice, and nothing a capability generates may reach for it.

Sizes run `--type-xs` through `--type-xl`, with `--type-title` for a window title
and `--type-display` for the one clamped display size. Small caps is a role rather
than a size: `--caps-size` and `--caps-tracking` set it and `.caps` applies both,
for labels, counts and kickers.

## Spacing and units

`--space-1` through `--space-8`, and nothing between them.

Layout and type are relative. Body size, the window title, the small-caps size,
the label measure, the grid track, the window minimum, gaps and paddings are all
in rem, so browser text scaling grows the box along with the text it holds. Text
scaling is the most-used accessibility setting there is.

Drawing constants stay in pixels: the ink line's weight and its deviation, the
logo tile's box and its contour, the corner clip. These describe a picture rather
than a layout, and scaling them changes the artwork's character instead of the
layout's fit.

Two breakpoints. The desk changes shape at 720px, where the window stops floating
and becomes the screen. Forms drop to one column at 620px.

## What a generated screen may declare

Three axes are pick-from-a-list. Colour, type size and spacing are set by naming a
token and never by writing a value: `var(--leaf)`, `var(--type-lg)`,
`var(--space-4)`. The class vocabulary below covers common arrangement with no
inline `style` at all; where it does not reach, inline `style` is the escape
hatch, and on these three axes it may still only name a token.

### Never declared

Four properties belong to the platform, and generated markup declares none of
them. `font-family` inherits from the surface it sits on, which is already the
right face. `border` is not yours to set, because the ink system owns every
boundary and a drawn line is an SVG path rather than a CSS edge. `border-radius`
has no token to pick from, because there are none: every corner on the surface is
mitred, and a square corner is the absence of a declaration rather than a value of
zero. `box-shadow` is the one that fails quietly — nothing inside a window casts,
and the object-shadow tokens are bare `<x> <y> <alpha>` numbers rather than CSS
shadows, so `box-shadow: var(--shadow-window)` produces an invalid value that does
nothing and says nothing. `--shadow-desk-label` is the named exception: a complete
three-pass `text-shadow` treatment for type read directly from the wallpaper, never
an inline-style or generated-markup option.

Outside those three axes and these four properties, inline `style` is free:
arrangement, alignment, aspect ratio, width and the rest. Two rules follow the
shadow's reasoning rather than its property name: `text-shadow` and
`filter: drop-shadow(...)` cast the same shadow and go the same way, and `all` is
out because resetting the surface's inheritance is how the face, the colour and
the metrics above would be undone.

All four bans are enforced. `border` was the last to land, because it could not
until the ink system reached the records themselves: a generated card with neither
a border nor a drawn line is invisible. Now that the platform draws the card, the
gate refuses every boundary a record could declare — the shorthand, every side and
every sub-property, and `outline` and `column-rule`, which are the same CSS edge
under other names. Without a border, separation comes from the palette and the
spacing: a filled block, a change of size or weight, a gap.

### Banned outright

- An off-token value on one of the three closed axes — a raw hex or `rgb()`
  colour, a px or rem font size, a raw spacing value.
- Any class outside the vocabulary below.
- An interactive descendant inside a record. The record is itself the button.
- `<script>`, and `on*=` handlers.
- A user field value interpolated into markup unescaped, or into a `style`
  attribute at all. Styles are literal in the renderer source.
- A resource loaded from inside `style` — `url(...)` and every function beside it that
  fetches or synthesizes one.
- Anything that takes a record out of its own bounds: a `position` that escapes them,
  and equally the whole transform and motion family — `transform` and its longhands,
  the three individual `translate` / `rotate` / `scale` properties, `zoom`,
  `perspective` and `offset`. Offsets are lengths and name a spacing token like any
  other.
- A decoration shorthand carrying a colour or a thickness. `text-decoration` and
  `text-emphasis` name a line and a style; the colour belongs on `-color`, where the
  palette answers for it, and there is no thickness token to name.

Two enforcers catch these. The design-lint gate rung fails the build closed, and
the allow-list enforcer the presentation adapter applies to every record catches
whatever reaches render time, so a dynamic field value cannot become executable
markup even after a build has passed.

## The class vocabulary

Generated screens already speak these names, and they keep them. The gate keys on
this list; platform chrome is named by the stylesheets under `design/styles/`
instead. The kit itself ships as `design/styles/layout-kit.css`, imported by the
manifest below the components so its utilities win where they apply.

`.stack` flows a record's own fields top to bottom and `.cluster` puts them in a
row that wraps, both with an on-token default gap. Under those sit the low-level
knobs for the long tail of arrangement: `.flex`, `.grid`, `.flex-col`,
`.flex-wrap`, the `.items-*` and `.justify-*` alignment classes, `.grid-cols-*`,
`.grow` and `.w-full`. `.gap-*` maps onto the spacing tokens and
`.text-*` onto the type sizes — `.gap-0_5` names a half step this scale does not
have and resolves to the same first step as `.gap-1` — with `.text-bold`, `.text-muted` and `.text-subtle`
for weight and secondary colour; body size is the inherited default and needs no
class. `.truncate` holds a long value to one ellipsised line and `.line-clamp-*`
to N lines. `.media-frame` is a ratio-locked, clipped box for an image or video
field, with square and wide modifiers beside the default.

The kit is sensible defaults rather than a CSS framework. Rebuilding Tailwind is a
non-goal, and the escape hatch absorbs the long tail.

`.stack` had a second meaning and loses it. `design/styles/layout.css` used the
name for a page column, in a file whose own header states it owns no product
component; that one is renamed. Renaming the incidental use is cheaper than
renaming the one every generated screen already speaks, and leaving both would
have quietly given a generated stack a page column's spacing, with no error
anywhere.

## The line

Every boundary on the surface is drawn rather than ruled: mitred at the corners,
deviating from true, inked twice, and carrying its own seed. That reaches into
generated content. Record cards, rows and tables are drawn like everything else,
because records are what a user looks at longest and a straight-edged card on a
drawn desk reads as unfinished.

A component declares its border as normal and the ink system takes it over on
mount, recolouring the border to transparent so it still occupies its space and
nothing moves. The declaration is the room the line will need, not the finished
line.

Two things a drawn component gives up, because the line is two SVG layers that
live inside it. It is never `:empty` and nothing in it is ever `:only-child`, so a
rule that hides a region until it fills has to ask past the layers rather than
through those two selectors. And a region whose content is text rather than
elements cannot be drawn at all, since `:empty` is the only selector that can see
text. Nothing may outrank the seam either: `.is-ink` recolours the border at one
class of specificity, so a state rule that sets `border-color` from a heavier
selector paints a true edge back beside the drawn one.

Every line is the same weight; there is no weight ladder. Hierarchy rides on the
hand instead. The frame hand goes to the things that hold others, the window and
the prompt rail; the fine hand to everything drawn inside one; the close hand to
small parts under about 24px, where the fine hand reads as a dented square rather
than a lighter line. A component asks for a hand with `--ink-hand`, and fine is
the default.

A seed may never be derived from where an element sits, or it would re-roll on
every move and every resize. A drawn record card seeds from the record's own id,
handed to the ink system through `data-ink-seed`, so the same record keeps the
same hand across a view swap and across a resize. The generation pipeline never
learns the ink system exists. Resize is observed once per list container rather
than once per card, because the children of a list resize together.

## Shadow, and the two blurs

Only what stands on the desk casts: the window, the prompt rail, the logo tile.
Nothing inside a window casts, so depth inside one comes from ordered bands and
from the hands. A shadow is displacement and never blur — the drawn element's own
silhouette, offset, deviating exactly as the line it belongs to — which is why the
tokens are stated as `<x> <y> <alpha>` and handed to the ink system rather than
written as a `box-shadow`.

A frame around a region is correct. Every boundary is drawn, so a region that
holds something is framed rather than separated by tone and spacing alone. The
prompt rail is raised and framed on `--surface`: it stands on the desk beside the
windows, takes the full hand, and casts. It is not a borderless field lying on the
ground.

Blur appears in exactly two treatments. One is the desk label's text-shadow,
three graded passes straight down, shared by a capability name and the prompt
notice because both are read directly from the wallpaper. `design/logo.html`
defends it as the only blurred type treatment in Aluna: the hard-shadow rule
governs what an *object* casts onto the desk, where a soft edge would fake a depth
the flat-band model does not have, and a glyph casts nothing. The other is the
companion's light. Glow, bloom, particles and rays belong to the spark, and the
drawn-line rules govern surfaces rather than light.

## The window and the collection

The desk holds one window and the window is the content area. Everything a
capability shows happens inside it: the collection, a record, a confirmation, the
narration of a build. Opening another capability swaps the contents and the frame
does not move. There is no modal anywhere in Aluna, so opening a record replaces
the collection inside the window and Back returns to it.

A record is a `<button>`. Opening one is the only thing you can do with it, and a
button is what the keyboard already reaches, so a record carries no `role`, no
`tabindex` and no key handling of its own. What opens is the form, in edit mode.
Aluna has no read view of a record, so the form is where a record is read as well
as changed.

The collection's order is fixed and is the same for every capability: the search
rail, then the count and the create action, then the records in the capability's
declared layout. `ui_intent.collection.layout` is a closed enum — `.records--feed`
is a single column, `.records--grid` fills as many equal columns as fit. Search is
server-side and debounced.

## Forms

A control is a shell plus a bare native element. `<input>` is a void element and
`<select>` admits only `<option>`, so neither can hold the two SVG layers a drawn
boundary needs. `.field__control` is the shell, carrying the boundary, the fill,
the padding and every state. `.field__input` is the bare input inside it, with no
border and no background of its own, and `.field__textarea` and `.field__select`
are the same thing for the other two.

The boundary is always ink. Invalid is carried by the well and the guidance, and
disabled by printing the whole object lighter, because a coloured boundary would
be a second ink.

Two field types sit beside the scalars. A choice field declares its own values and
renders through the drawn listbox, since a native `<select>`'s popup belongs to
the browser and no stylesheet reaches inside it; it carries grouped options, a
note per option, and a disabled state per option. Which control it uses — picker,
radio group or segmented — is declared per field in the spec rather than inferred
from how many options there are. Long text is the other, and it is what every
notes, description, review and journal field has been missing. Long text grows to
fit what is typed, then scrolls. It is never dragged: the resize grip is the
operating system's mark and the only one on the surface that would not be ours.
A list-of-strings field takes a drawn control too, in the input mode the form
declares. `comma_separated` is one `.field__control` holding one input, with the
comma as the separator. `repeatable` is `.field-list__values`, a column of
`.field-list__row`s that are each a shell of their own between a `.field-list__grip`
and a small outline remove. The grip is dragged — the row follows the pointer
under `translate` while the rows it passes slide clear, and the list itself is
reordered once, on release. Because order is part of the value rather than a view of
it, the grip is also a `<button>`: space picks the row up, the arrow keys move it,
space drops it and escape puts it back, with each step said in the field's own
`.field-list__live` region.

Two keys sit on a field. `guidance` is a short hint under the field, and it also
carries the sentence announcing a default, so a default needs no key of its own.
`max_length` is declared once and drives both the handler's validation and the
character counter. There is no placeholder key, because guidance survives typing,
which is when a format hint matters.

Two states are the renderer's alone and touch no schema. Optional is marked and
required is not, since the other way round spends an asterisk on most of the
fields on screen. Disabled fades the whole object, line included, because a drawn
boundary cannot be greyed on its own without becoming a second ink. Read-only is
not a third: the form is the only view a record has, so no field is ever printed
rather than filled, and an absent value is an empty input rather than a muted em
dash.

Errors sit in the field, replacing that field's guidance. The browser checks
required fields before submitting, which recovers the native constraint validation
a drawn picker gives up. A generated form may not author its own copy for a
declared business error: displaying an error per field is presentation, and the
words belong to `behavioral_errors`.

## Buttons

The fill names a button's role, and the text is ink unless the fill is too dark to
carry it, which is true of `--shade` and `--signal` only — the two fills that take
a light label, and the reason primary is `--shade` rather than the lighter
`--leaf` that secondary carries. Six of the seven variants carry a
fill: `.btn--primary`, `.btn--secondary`, `.btn--info`, `.btn--feature`,
`.btn--warm` and `.btn--danger`.

`.btn--outline` is the seventh and the only unfilled one, for the action you take
when you are not taking the action. It names what the base already is — `.btn`
sets no fill, so there is no eighth, quieter button hiding behind the absence of a
modifier. `ghost` is not a name in this system, and neither is `neutral` or
`default`.
`.btn--danger` is the only place `--signal` appears on a button and is reserved
for destructive confirmation.

One row height. `--control-h` is what a field and a button share, so a control row
aligns without a nudge, with `--control-h-sm` and `--control-h-lg` either side of
it and `.btn--block` for full width.

## Accessibility

WCAG AA contrast for text and controls is a commitment. The palette is closed, so
each colour pair is checked once and stays true, and every pair a button uses
passes. The one that did not was a light label on `--leaf` at 3.01; the two greens
changed places, so primary is `--shade` at 5.18 and secondary is `--leaf` at 4.54
under ink.

The check is an audit rather than a habit. Every foreground the stylesheets
declare — every `color`, every ring, and every `opacity` that dims one — is
enumerated with the fill it is read against and the threshold that applies to it,
measured from the live token values, and a declaration nothing has classified
fails. Three tokens are set by that audit rather than by eye: `--ink-2` and
`--ink-3` are as light as AA allows on the darkest fill each is permitted on, and
`--violet` is as dark as the focus ring needs to read on the desk. What `--ink-3`
may sit on is closed to the two window fills; the developer well, which is the one
dark ground in the product, derives its own faint instead. Hover steps a fill away
from the label it carries, because a step toward ink took the two tightest buttons
below AA.

The palette page states every measured ratio, computed from the same tokens.

Keyboard navigation, semantic landmarks and reduced motion are honoured, but they
are not release gates.

Motion is on by default and is part of the product's personality. When the OS
Reduce Motion setting is on, Aluna stops positional travel — windows flying open,
content sliding, press-jumps — because travel is what triggers nausea. In-place
character continues: the companion keeps breathing, blinking and reacting. Travel
is switched off centrally on that one axis, rather than through a blanket reset or
a hand-maintained selector list.

The axis is `--travel`, in `styles/tokens.css`: a scale of one that Reduce Motion
takes to zero, with every travelling distance (`--travel-nudge`, `--travel-press`,
`--travel-lift`) and the travel duration (`--dur-travel`) stated as a multiple of
it. Which of the two a rule belongs to is the property it uses. `transform` says
where a thing sits; `translate` is how far it travels and goes on `--dur-travel`;
`scale` and `rotate` are how it changes without going anywhere and keep
`--dur-fast`. A new component gets the behaviour by using those primitives, and a
raw distance fails `travel-axis.test.ts` rather than shipping.

The focus ring is `--focus-ring`, painted on the enclosing shell with the inner
control's own ring suppressed, so a control never shows a second ring further in.
Every ring on the surface is that one colour, including the prompt bar, the search
rail and the segmented control; none is `--signal`, which has a job of its own.
A text input shows its ring on any focus, including a mouse click, because the
ring tells you where typing will land and that is real information. Every other
control shows it on keyboard focus only — which means a shell that also holds a
button rings for the control it names, never for anything focused inside it, and
that a move the product makes rather than the person asks for the ring explicitly.

A ring is a control mark rather than type, so what it owes is 3:1 against what it
is drawn on. Two are brought in to meet the drawn line enclosing their control
instead of standing clear of it, because the fill behind them cannot carry the
ring: the segmented control's pressed segment, and a title-bar lamp on its panes.
