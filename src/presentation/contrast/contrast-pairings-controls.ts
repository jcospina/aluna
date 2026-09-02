/**
 * The pairings that belong to a control rather than to a sentence.
 *
 * A ring, a glyph, a grip, a fill under the pointer, a control that has been
 * turned off. Most answer WCAG §1.4.11's 3:1 rather than §1.4.3's 4.5:1, because
 * what has to be visible is the part of the control that says it is there.
 * Read with `contrast-audit.ts`; see `contrast-pairings-surface.ts` for type.
 */

import type { Pairing } from "./contrast-audit.js";

const ink = { token: "ink" } as const;
const surface = { token: "surface" } as const;
const surface2 = { token: "surface-2" } as const;
const ground = { token: "ground" } as const;
const ink3 = { token: "ink-3" } as const;
const ring = { token: "focus-ring" } as const;

export const CONTROL_PAIRINGS: readonly Pairing[] = [
  {
    what: "the mark in a checked box or radio",
    foreground: ink,
    background: { token: "leaf" },
    threshold: "non-text",
    note:
      "A glyph owes only §1.4.11's 3:1, and a light mark here made exactly that at " +
      "3.01 — C12's pairing, surviving where the threshold was low enough to let it. " +
      "Ink is what every label on leaf takes, and it is 4.54.",
    sites: [
      "design/styles/components/form-controls.css § .choice__input:checked + .choice__mark [color]",
    ],
  },
  {
    what: "a glyph on a control — search, grip",
    foreground: ink3,
    background: surface2,
    threshold: "non-text",
    note:
      "Part of the control rather than type, so §1.4.11's 3:1 applies. The design's " +
      "search rail fills with `--surface-2` and is the tighter of the two; the " +
      "shipped one and the list row both stand on `--surface`.",
    alsoCovers: [surface],
    sites: [
      "design/styles/components/controls.css § .search__glyph [color]",
      "design/styles/components/list-field.css § .field-list__grip [color]",
      "public/css/collection.css § .capability-search__icon [color]",
    ],
  },
  {
    what: "the resize grip",
    foreground: { token: "ink", alpha: 0.55, over: surface },
    background: surface,
    threshold: "non-text",
    note:
      "The affordance that says a window can be resized, so it clears 3:1 like any " +
      "other control mark. At 0.45 it was 2.62.",
    sites: ["design/styles/components/desk.css § .window__grip::after [opacity]"],
  },
  {
    what: "the resize grip on the window in front",
    foreground: { token: "ink", alpha: 0.75, over: surface },
    background: surface,
    threshold: "non-text",
    note: "The focused window's grip steps up, and is measured at the strength it steps to.",
    sites: [
      "design/styles/components/desk.css § .window--desk.is-focused .window__grip::after [opacity]",
    ],
  },
  {
    what: "an ink-labelled button under the pointer",
    foreground: ink,
    background: { mix: ["leaf", "surface"], toward: 0.13, space: "oklab" },
    threshold: "text",
    note:
      "Hover steps the fill away from the label, so every ink-labelled variant reads " +
      "better hovered than at rest. Leaf is the tightest of the four and stands for " +
      "sky, sun and clay. Stepping toward ink instead took this pairing to 3.74.",
    alsoCovers: [
      { mix: ["clay", "surface"], toward: 0.13, space: "oklab" },
      { mix: ["sky", "surface"], toward: 0.13, space: "oklab" },
      { mix: ["sun", "surface"], toward: 0.13, space: "oklab" },
    ],
    sites: ["design/styles/components/form-controls.css § .btn:hover:not(:disabled) [background]"],
  },
  {
    what: "a light-labelled button under the pointer",
    foreground: surface,
    background: { mix: ["signal", "ink"], toward: 0.13, space: "oklab" },
    threshold: "text",
    note:
      "The two fills dark enough to need a light label step toward ink, which is still " +
      "away from the label. Signal is the tighter of the two and stands for shade.",
    alsoCovers: [{ mix: ["shade", "ink"], toward: 0.13, space: "oklab" }],
    sites: ["design/styles/components/form-controls.css § .btn:hover:not(:disabled) [background]"],
  },
  {
    what: "the outline button under the pointer",
    foreground: ink,
    background: { mix: ["surface-2", "ink"], toward: 0.06, space: "oklab" },
    threshold: "text",
    note: "The one variant with no fill of its own, so its hover names its own two ends.",
    sites: [
      "design/styles/components/form-controls.css § .btn--outline:hover:not(:disabled) [background]",
    ],
  },
  {
    what: "the scrim over a build you are about to leave",
    foreground: ink,
    background: surface,
    threshold: "exempt",
    note:
      "A dimming layer that carries no text: the question is asked on a `--surface` " +
      "panel standing on it, which is the pairing measured above. Mixed `in srgb` " +
      "because `transparent` is transparent black and carries no hue to interpolate.",
    sites: ["public/css/demo.css § .build-stream__leaving [background]"],
  },
  {
    what: "the focus ring inside a window",
    foreground: ring,
    background: surface,
    threshold: "non-text",
    note:
      "§1.4.11. One ring, one colour, 3px — declared once in the token layer's base " +
      "stylesheet and painted on the enclosing shell wherever a control has one.",
    sites: [
      "design/styles/base.css § :focus-visible [outline]",
      "design/styles/components/controls.css § .search:has(.search__input:focus) [outline]",
      "design/styles/components/controls.css § .segmented button:focus-visible [outline]",
      "design/styles/components/form-controls.css § .choice__input:focus-visible + .choice__mark [outline]",
      'design/styles/components/form-controls.css § .field__control:has(:is(input:not([type="checkbox"], [type="radio"]), textarea):focus), .field__control:focus-visible, .field__control:has(select:focus-visible) [outline]',
      "public/css/collection.css § .capability-search__clear:focus-visible [outline]",
      "public/css/collection.css § .capability-search__control:has(.capability-search__input:focus) [outline]",
    ],
  },
  {
    what: "the focus ring on the desk",
    foreground: ring,
    background: ground,
    threshold: "non-text",
    note:
      "The prompt rail and every logo stand on the ground, so the ring is measured " +
      "against it. `--violet` was #9a86c4 at 2.64 here before this audit.",
    sites: [
      "design/styles/base.css § :focus-visible [outline]",
      "design/styles/components/desk.css § .prompt-bar:has(.prompt-bar__input:focus) [outline]",
      "public/css/prompt.css § .prompt__composer:has(.prompt__field:focus) [outline]",
    ],
  },
  {
    what: "the focus ring brought in to meet a drawn line",
    foreground: ring,
    background: ink,
    threshold: "non-text",
    note:
      "Two rings are not drawn clear of the control but against the 2px line that " +
      "encloses it, which is then what they are adjacent to on every side. The " +
      "segmented control's is inset because the pressed segment behind it is sun at " +
      "1.97; a title-bar lamp's is at no offset because the panes it stands on are " +
      "2.64 to 2.94. Both are §1.4.11 met by the bounding colour, technique G195.",
    sites: [
      "design/styles/components/controls.css § .segmented button:focus-visible [outline]",
      "design/styles/components/window.css § .lamp:focus-visible [outline]",
    ],
  },
  {
    what: "a disabled control",
    foreground: ink3,
    background: surface,
    threshold: "exempt",
    note:
      "§1.4.3 excepts text in an inactive control. Both the fade to 0.42 and the " +
      "`--ink-3` a disabled control's own type falls back to are that exception, and " +
      "so is the busy prompt rail, whose field is disabled while a build runs.",
    sites: [
      "design/styles/components/form-controls.css § .field__control:has(:disabled), .btn:disabled, .choice:has(:disabled) [opacity]",
      'design/styles/components/form-controls.css § .listbox__option[aria-disabled="true"] [color]',
      "design/styles/components/list-field.css § .field-list__grip:disabled [opacity]",
      "public/css/deletion.css § .capability-deletion__actions form.htmx-request .btn--danger:disabled [background]",
      "public/css/deletion.css § .capability-deletion__actions form.htmx-request .btn--danger:disabled [color]",
      "public/css/deletion.css § .capability-deletion__actions:has(form.htmx-request) .capability-deletion__keep [opacity]",
      "public/css/prompt.css § .prompt--busy .prompt__composer [opacity]",
      "public/css/prompt.css § .prompt--busy .prompt__submit:disabled [background]",
      "public/css/prompt.css § .prompt--busy .prompt__submit:disabled [color]",
      "public/css/prompt.css § .prompt__field:disabled [color]",
      "public/css/record-view.css § .capability-record-view__back:disabled [color]",
    ],
  },
  {
    what: "a chevron and a mark",
    foreground: ink,
    background: surface2,
    threshold: "non-text",
    note: "Control glyphs the stylesheet draws itself.",
    sites: [
      "design/styles/components/controls.css § .field__chevron [color]",
      "design/styles/components/form-controls.css § .choice__mark [color]",
      "design/styles/components/form-controls.css § .listbox__chevron [color]",
    ],
  },
  {
    what: "the browser's own date picker indicator",
    foreground: { token: "ink", alpha: 0.55, over: surface2 },
    background: surface2,
    threshold: "non-text",
    note:
      "User-agent artwork: the stylesheet dims it and never gives it a colour, so the " +
      "dimming is the whole of what there is to measure. Chrome draws it in near-ink.",
    sites: [
      "design/styles/components/form-controls.css § .field__input::-webkit-calendar-picker-indicator [opacity]",
    ],
  },
  {
    what: "a control the browser paints from an accent",
    foreground: { token: "shade" },
    background: { token: "well-alert" },
    threshold: "non-text",
    note:
      "`accent-color` hands a checkbox or a range to the user agent, which paints it " +
      "in that colour — so it is a pairing this stylesheet makes without naming a " +
      "foreground. Measured on the reddest fill a checkbox stands on, an invalid " +
      "inline field; `--leaf` on the range is 3.01 on the window it stands on.",
    alsoCovers: [{ token: "surface" }, { token: "surface-2" }],
    sites: ["public/css/fields.css § .field__checkbox [accent-color]"],
  },
  {
    what: "a leaf mark on the window — the range, and the search spinner",
    foreground: { token: "leaf" },
    background: surface,
    threshold: "non-text",
    note: "Both are marks rather than type, so 3:1 is the threshold that applies.",
    sites: [
      'design/styles/components/controls.css § .control input[type="range"] [accent-color]',
      "public/css/collection.css § .capability-search__loading [border-top-color]",
    ],
  },
];
