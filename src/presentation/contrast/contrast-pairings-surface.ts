/**
 * The pairings that are type on a fill.
 *
 * Read with `contrast-audit.ts`, which holds the terms these rows are stated in
 * and the exhaustiveness the audit checks them for. The split between this file
 * and `contrast-pairings-controls.ts` is where a reader would look for a row, not
 * a difference in kind: this one is what you read, that one is what you operate.
 */

import type { Pairing } from "./contrast-audit.js";

const ink = { token: "ink" } as const;
const surface = { token: "surface" } as const;
const surface2 = { token: "surface-2" } as const;
const ground = { token: "ground" } as const;
const ink2 = { token: "ink-2" } as const;
const ink3 = { token: "ink-3" } as const;
/** The halo `--shadow-desk-label` lays around type read straight off the wallpaper. */
const deskLabelHalo = { token: "ink", alpha: 0.85, over: ground } as const;
const wellFaint = { mix: ["surface", "ink"], toward: 0.4, space: "oklab" } as const;

export const SURFACE_PAIRINGS: readonly Pairing[] = [
  {
    what: "ink on a window, a card, a menu or the prompt rail",
    foreground: ink,
    background: surface,
    threshold: "text",
    note: "The default reading pair, and the strongest one on the surface.",
    sites: [
      "design/styles/components/collection.css § .detail__back:hover [color]",
      "design/styles/components/controls.css § .btn [color]",
      "design/styles/components/desk.css § .build__line:last-child [color]",
      "design/styles/components/desk.css § .logo-menu__item [color]",
      "design/styles/components/desk.css § .logo-tile--dev [color]",
      "design/styles/components/desk.css § .prompt-bar__input [color]",
      "design/styles/components/form-controls.css § .btn--outline [color]",
      "design/styles/components/form-controls.css § .field__select option [color]",
      "design/styles/components/list-field.css § .field-list__grip:hover:not(:disabled) [color]",
      "public/css/collection.css § .capability-search__input [color]",
      "public/css/components.css § .btn [color]",
      "public/css/deletion.css § .capability-deletion h1 [color]",
      "public/css/deletion.css § .capability-deletion__ending [color]",
      "public/css/demo.css § .build-stream__leaving-panel p [color]",
      "public/css/prompt.css § .prompt__field [color]",
      "public/css/record-view.css § .capability-record-view__back:hover [color]",
    ],
  },
  {
    what: "ink in an input, an item or a spec table",
    foreground: ink,
    background: surface2,
    threshold: "text",
    note: "What you type, read against the well it is typed into.",
    sites: [
      "design/styles/components/controls.css § .search__input [color]",
      "design/styles/components/form-controls.css § .field__control [color]",
      "design/styles/components/form-controls.css § .field__input, .field__textarea, .field__select [color]",
    ],
  },
  {
    what: "ink on the desk",
    foreground: ink,
    background: ground,
    threshold: "text",
    note: "The page's own default, and the hover fill under the search rail's Clear.",
    sites: [
      "design/styles/base.css § body [color]",
      "public/css/collection.css § .capability-search__clear:hover [color]",
    ],
  },
  {
    what: "ink on the tightest title-bar pane, and a link on a clay note",
    foreground: ink,
    background: { token: "pane-2" },
    threshold: "text",
    note:
      "A window title crosses five panes and a link lands on any note fill, so both " +
      "are measured against the darkest of them rather than the first.",
    alsoCovers: [
      { token: "pane-1" },
      { token: "pane-3" },
      { token: "pane-4" },
      { token: "pane-5" },
    ],
    sites: [
      "design/styles/base.css § a [color]",
      "design/styles/components/window.css § .window__title [color]",
    ],
  },
  {
    what: "an unfocused window title",
    foreground: { token: "ink", alpha: 0.72, over: { token: "pane-2" } },
    background: { token: "pane-2" },
    threshold: "text",
    note: "Unfocused desaturates the title bar. It stays a title, so it stays AA.",
    sites: ["design/styles/components/window.css § .window.is-unfocused .window__title [opacity]"],
  },
  {
    what: "a link on the menu bar",
    foreground: { token: "ink", alpha: 0.78, over: { token: "sky" } },
    background: { token: "sky" },
    threshold: "text",
    note:
      "The dimming is the pairing. At 0.66 this was 3.67 while its declared colour, " +
      "ink on sky, was 8.13 — the failure was in the `opacity`, not the `color`.",
    sites: [
      "design/styles/layout.css § .menubar a [color]",
      "design/styles/layout.css § .menubar a [opacity]",
    ],
  },
  {
    what: "ink on sky",
    foreground: ink,
    background: { token: "sky" },
    threshold: "text",
    note: "The info button.",
    sites: [
      "design/styles/components/form-controls.css § .btn--info [color]",
      "public/css/components.css § .btn--info [color]",
    ],
  },
  {
    what: "ink on sun",
    foreground: ink,
    background: { token: "sun" },
    threshold: "text",
    note:
      "The warm button, the waiting pill, a marked prompt, and the two rows that take " +
      "a fill when chosen — a selected option and a pressed segment. Sun is the " +
      "tightest fill either of those reaches, so both are measured on it.",
    alsoCovers: [surface, { token: "ground-deep" }],
    sites: [
      "design/styles/components/controls.css § .segmented button [color]",
      "design/styles/components/form-controls.css § .listbox__option [color]",
      "design/styles/components/controls.css § .pill--wait [color]",
      "design/styles/components/form-controls.css § .btn--warm [color]",
      'design/styles/components/form-controls.css § .listbox__option[aria-selected="true"] .listbox__note [color]',
      "design/styles/components/logo-contract.css § .prompt-block mark [color]",
      "public/css/components.css § .btn--warm [color]",
    ],
  },
  {
    what: "ink on clay",
    foreground: ink,
    background: { token: "clay" },
    threshold: "text",
    note: "The feature button — grow one.",
    sites: [
      "design/styles/components/form-controls.css § .btn--feature [color]",
      "public/css/components.css § .btn--feature [color]",
    ],
  },
  {
    what: "ink on leaf",
    foreground: ink,
    background: { token: "leaf" },
    threshold: "text",
    note:
      "C12's pairing, and the tightest on any button. The OK pill wore a light label " +
      "here at 3.01 until this audit — the same failure the green swap removed.",
    sites: [
      "design/styles/components/controls.css § .pill--ok [color]",
      "design/styles/components/form-controls.css § .btn--secondary [color]",
      "public/css/components.css § .btn--secondary [color]",
    ],
  },
  {
    what: "ink on the deletion notice",
    foreground: ink,
    background: { mix: ["sun", "surface"], toward: 0.7, space: "oklch" },
    threshold: "text",
    note: "A warning band, derived from sun rather than declared as a colour of its own.",
    sites: [
      "public/css/deletion.css § .capability-deletion__notice [background]",
      "public/css/deletion.css § .capability-deletion__notice [color]",
    ],
  },
  {
    what: "ink in an invalid field",
    foreground: ink,
    background: { token: "well-alert" },
    threshold: "text",
    note:
      "`--well-alert` recolours the fill and is itself derived from `--signal`; the " +
      "boundary stays ink, so the type on it does too.",
    sites: [],
  },
  {
    what: "a light label on the primary button",
    foreground: surface,
    background: { token: "shade" },
    threshold: "text",
    note: "C12: shade is the primary because it is dark enough to need a light label.",
    sites: [
      "design/styles/components/form-controls.css § .btn--primary [color]",
      "public/css/components.css § .btn--primary [color]",
    ],
  },
  {
    what: "a light label on the danger button",
    foreground: surface,
    background: { token: "signal" },
    threshold: "text",
    note: "The other of the two fills too dark to carry ink.",
    sites: [
      "design/styles/components/form-controls.css § .btn--danger [color]",
      "public/css/components.css § .btn--danger [color]",
    ],
  },
  {
    what: "a payload in the developer well",
    foreground: surface,
    background: ink,
    threshold: "text",
    note: "The one dark ground in Aluna, and the only place ink is a fill (D13).",
    sites: ["design/styles/components/desk.css § .devpanel__pre [color]"],
  },
  {
    what: "a name read straight off the wallpaper",
    foreground: surface,
    background: deskLabelHalo,
    threshold: "text",
    note:
      "The one pairing whose background is not a fill. What is behind the glyph is a " +
      "photograph, which cannot be measured; what is *adjacent* to it is the ink " +
      "`--shadow-desk-label` lays around it, and that is the whole reason the " +
      "treatment exists. Measured at the alpha the token states. Be plain about the " +
      "limit: the three layers are drop shadows offset a pixel or two down, so the " +
      "halo is strongest under a glyph and thinnest above it, where the widest layer's " +
      "7px blur is all there is. This row records a number rather than proving one.",
    sites: [
      "design/styles/components/logo-contract.css § .logo-label [color]",
      "public/css/prompt.css § .prompt__notice [color]",
    ],
  },
  {
    what: "the developer tile's name",
    foreground: { token: "surface", alpha: 0.85, over: deskLabelHalo },
    background: { token: "ink", alpha: 0.7225, over: ground },
    threshold: "text",
    note:
      "The one label that dims, and the halo dims with it — `opacity` takes the whole " +
      "element, shadow included, so the background here is the halo at 0.85 of 0.85. " +
      "Modelling only the glyph would have read 6.96 instead of 4.80.",
    sites: ["design/styles/components/desk.css § .logo--dev .logo-label [opacity]"],
  },
  {
    what: "secondary type on a window, a card or a menu",
    foreground: ink2,
    background: surface,
    threshold: "text",
    note: "Labels, counts, hints and the second line of a record.",
    sites: [
      "design/styles/components/collection.css § .collection__count [color]",
      "design/styles/components/collection.css § .detail__back [color]",
      "design/styles/components/controls.css § .control > .caps [color]",
      "design/styles/components/desk.css § .build__line [color]",
      "design/styles/components/desk.css § .devpanel__stage [color]",
      "design/styles/components/desk.css § .logo-rename__error [color]",
      "design/styles/components/doc.css § .numbers small [color]",
      "design/styles/components/doc.css § .swatch__meta code [color]",
      "design/styles/components/form-controls.css § .choice__hint [color]",
      "design/styles/components/form-controls.css § .field__control:has([readonly]) .field__input [color]",
      "design/styles/layout-kit.css § .text-muted [color]",
      "public/css/deletion.css § .capability-deletion__body [color]",
      "public/css/fields.css § .choice-set__heading [color]",
      "public/css/record-view.css § .capability-record-delete__copy [color]",
      "public/css/record-view.css § .capability-record-view__back [color]",
    ],
  },
  {
    what: "a placeholder in an alert well",
    foreground: ink2,
    background: { token: "well-alert" },
    threshold: "text",
    note:
      "The one place a placeholder is `--ink-2`: on `--well-alert` the faint strength " +
      "is 4.24, so an invalid field's placeholder steps up rather than the fill down.",
    sites: [
      "design/styles/components/form-controls.css § .field.is-invalid :is(.field__input, .field__textarea)::placeholder, .field.is-invalid .listbox__value.is-placeholder [color]",
    ],
  },
  {
    what: "secondary type on an item or a table head",
    foreground: ink2,
    background: surface2,
    threshold: "text",
    sites: [
      "design/styles/components/collection.css § .record__detail [color]",
      "design/styles/components/doc.css § .spec th [color]",
    ],
    note: "",
  },
  {
    what: "secondary type on the desk",
    foreground: ink2,
    background: ground,
    threshold: "text",
    note: "",
    sites: ["design/styles/layout.css § .page__foot [color]"],
  },
  {
    what: "an option's note under the keyboard",
    foreground: ink2,
    background: { token: "ground-deep" },
    threshold: "text",
    note:
      "The active row fills rather than outlining, so the note on it is read against " +
      "the deepest band in the palette. This was 4.42 before `--ink-2` was set by the audit.",
    sites: ["design/styles/components/form-controls.css § .listbox__note [color]"],
  },
  {
    what: "prose in a tinted note",
    foreground: ink2,
    background: { token: "pane-2" },
    threshold: "text",
    note:
      "The shared text roles land in every note variant, so they are measured against " +
      "the darkest pane a note is tinted with rather than the surface underneath.",
    alsoCovers: [
      { token: "pane-1" },
      { token: "pane-3" },
      { token: "pane-4" },
      { token: "pane-5" },
    ],
    sites: [
      "design/styles/base.css § .caps [color]",
      "design/styles/base.css § .lede [color]",
      "design/styles/base.css § .sm [color]",
      "design/styles/base.css § .xs [color]",
    ],
  },
  {
    what: "guidance, a placeholder and faint detail on a window",
    foreground: ink3,
    background: surface,
    threshold: "text",
    note:
      "Guidance and a placeholder are text a reader is meant to read, so neither is " +
      "incidental and neither is exempt. `--ink-3` was #8b9c82 at 2.86 here.",
    sites: [
      "design/styles/components/desk.css § .build__note [color]",
      "design/styles/components/desk.css § .devpanel__size [color]",
      "design/styles/components/desk.css § .prompt-bar__input::placeholder [color]",
      "design/styles/components/doc.css § .gallery__meta [color]",
      "design/styles/components/doc.css § .swatch__meta small [color]",
      "design/styles/components/form-controls.css § .field__guidance [color]",
      "design/styles/components/form-controls.css § .field__optional [color]",
      "design/styles/layout-kit.css § .text-subtle [color]",
      'public/css/collection.css § .capability-collection[data-search-state="no-matches"] > .capability-search__feedback [color]',
      "public/css/collection.css § .capability-empty [color]",
      "public/css/collection.css § .capability-search__clear [color]",
      "public/css/collection.css § .capability-search__feedback [color]",
      "public/css/collection.css § .capability-search__input::placeholder [color]",
      "public/css/deletion.css § .capability-deletion__retention [color]",
      "public/css/prompt.css § .prompt__field::placeholder [color]",
    ],
  },
  {
    what: "a placeholder inside a well",
    foreground: ink3,
    background: surface2,
    threshold: "text",
    note: "The darkest fill `--ink-3` is allowed on, and the value it is set by.",
    sites: [
      "design/styles/components/controls.css § .search__input::placeholder [color]",
      "design/styles/components/form-controls.css § .field__input::placeholder, .field__textarea::placeholder [color]",
      "design/styles/components/form-controls.css § .listbox__value.is-placeholder [color]",
    ],
  },
  {
    what: "a kicker, an eyebrow and a measured caption",
    foreground: { token: "shade" },
    background: surface,
    threshold: "text",
    note:
      "These were `--teal` at 3.15. Teal carries no readable text on this palette — " +
      "the same finding that keeps it off the buttons — so the shade beside it does the job.",
    sites: [
      "design/styles/base.css § .eyebrow [color]",
      "design/styles/base.css § .kicker [color]",
      "design/styles/components/doc.css § .gallery__name [color]",
      "design/styles/components/doc.css § .numbers em [color]",
      "design/styles/components/doc.css § .specimen__meta [color]",
    ],
  },
  {
    what: "an alert sentence",
    foreground: { token: "signal" },
    background: surface,
    threshold: "text",
    note: "Destructive state: `--signal` is reserved for it and reads only on the window fill.",
    sites: [
      "design/styles/components/desk.css § .prompt-bar.is-refused .prompt-bar__input::placeholder [color]",
      "design/styles/components/doc.css § .gallery__meta.is-short [color]",
      "design/styles/components/doc.css § .swatch__ratio[data-under] [color]",
      "design/styles/components/form-controls.css § .field.is-invalid .field__guidance--error, .field.is-invalid .field__guidance.is-over [color]",
      "design/styles/components/form-controls.css § .field__guidance.is-over [color]",
      'public/css/components.css § .notice[data-role="error"] [color]',
      "public/css/prompt.css § .prompt.is-refused .prompt__field::placeholder [color]",
    ],
  },
  {
    what: "a key in the developer well",
    foreground: { token: "sky" },
    background: ink,
    threshold: "text",
    note: "",
    sites: ["design/styles/components/desk.css § .devpanel__key [color]"],
  },
  {
    what: "a string in the developer well",
    foreground: { token: "leaf" },
    background: ink,
    threshold: "text",
    note: "",
    sites: ["design/styles/components/desk.css § .devpanel__string [color]"],
  },
  {
    what: "a number in the developer well",
    foreground: { token: "sun" },
    background: ink,
    threshold: "text",
    note: "",
    sites: ["design/styles/components/desk.css § .devpanel__number [color]"],
  },
  {
    what: "an atom in the developer well",
    foreground: { token: "ochre" },
    background: ink,
    threshold: "text",
    note:
      "Ochre, not violet. Violet was 4.38 here and violet is the focus ring, which " +
      "pulls the other way — the ring needs it dark enough to read on the desk. " +
      "Ochre is the anchor with no other job.",
    sites: ["design/styles/components/desk.css § .devpanel__atom [color]"],
  },
  {
    what: "punctuation and a resting stage in the developer well",
    foreground: wellFaint,
    background: ink,
    threshold: "text",
    note:
      "The well's own faint, derived from the surface. `--ink-3` is faint by being " +
      "darker, which is exactly wrong on the one dark ground in the product.",
    sites: [
      "design/styles/components/desk.css § .devpanel__block:not(.is-filled) .devpanel__pre [color]",
      "design/styles/components/desk.css § .devpanel__punct [color]",
    ],
  },
];
