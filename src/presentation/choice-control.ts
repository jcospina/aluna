// The choice control, in the three presentations a field may declare.
//
// All three draw the same declared options in the same order and post the same wire
// value; what differs is the shape on screen. The picker is the drawn listbox
// (`design/scripts/listbox.js`, ported to `public/choice-picker.js`) — a `<select>` is a
// replaced element whose popup no stylesheet reaches inside, so on a surface where every
// boundary is drawn the panel has to be ours. Radio is native radio inputs in one
// labelled radiogroup. Segmented is the joined button row, which carries neither a group
// heading nor an option note and is refused a spec that declares one.
//
// Create and edit share every path here: the only difference between them is which
// option arrives already chosen.

import { choiceInputForField } from "../choice-input/index.ts";
import {
  type ChoiceOption,
  type ChoiceOptionRun,
  type ChoicePresentation,
  choiceFieldOptions,
  choiceOptionRuns,
  type SpecField,
  type UiFormIntent,
} from "../registry/index.ts";
import { ALUNA_PRESENT_MARKER } from "../router/wire-protocol.ts";
import { escapeHtml } from "../web/html.ts";

/**
 * The option a control draws as chosen.
 *
 * A stored value the field does not declare resolves to nothing rather than to the first
 * option, which is what an unguarded control does and what would rewrite the record on
 * the next save. Append-only values mean a committed row cannot reach that, and this is
 * the fail-safe for when one somehow does.
 */
function chosenValue(field: SpecField, value: unknown): string {
  const stored = value === null || value === undefined ? "" : String(value);
  return choiceFieldOptions(field).some((option) => option.value === stored) ? stored : "";
}

/**
 * Whether this option refuses a press.
 *
 * How it then says so differs by control, and deliberately: the picker's option is a
 * `div`, which cannot take the native attribute, so it says `aria-disabled` — the design's
 * own spelling. A radio and a segment are real controls, so they take `disabled`, which
 * the browser announces and enforces for free. Both are announced; neither is merely
 * unclickable.
 *
 * The option the record already holds is never one of them, in any presentation. A value
 * that becomes disabled after a row stored it stays that row's value: the control renders
 * it, an unrelated edit preserves it, and moving to an enabled option is how it is left.
 * Refusing it here would either hide the record's own value or, for the two native
 * presentations, drop it from the submission and clear the row. The platform's own
 * refusal draws the same line from the other side — a disabled value is admitted only
 * when it is the one already stored.
 */
function refusesSelection(option: ChoiceOption, chosen: string): boolean {
  return option.disabled === true && option.value !== chosen;
}

export function renderChoiceField(
  inputId: string,
  field: SpecField,
  form: UiFormIntent,
  value: unknown,
): string {
  const { presentation } = choiceInputForField(form, field.name);
  const chosen = chosenValue(field, value);
  const body = controlFor(presentation)(inputId, field, chosen);

  return (
    `<div class="field field--choice${presentation === "picker" ? " listbox" : ""}"` +
    ` data-choice-presentation="${presentation}"${placeholderAttribute(presentation, field)}` +
    `${initialAttribute(presentation, chosen)}>` +
    `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${escapeHtml(field.name)}">` +
    body +
    `</div>`
  );
}

type ChoiceControl = (inputId: string, field: SpecField, chosen: string) => string;

/** The total dispatch from a declared presentation to its control. */
function controlFor(presentation: ChoicePresentation): ChoiceControl {
  switch (presentation) {
    case "picker":
      return renderPicker;
    case "radio":
      return renderRadioGroup;
    case "segmented":
      return renderSegmented;
    default:
      return assertNever(presentation);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled choice presentation: ${String(value)}`);
}

/* ── shared parts ──────────────────────────────────────────────────────────── */

/**
 * The field's own label, which every presentation names its control by. The picker's
 * closed control is a button and the other two are groups, so none of them is a form
 * element a `<label for>` can point at — all three are named by reference instead.
 */
function fieldLabel(inputId: string, field: SpecField): string {
  return `<span class="field__label" id="${inputId}-label">${escapeHtml(field.label)}</span>`;
}

/**
 * A required choice says so on the roles that can carry it — `combobox` and `radiogroup`.
 * `group`, which is what a segmented row is, supports no such state, so the segmented
 * control says nothing here rather than saying it invalidly.
 *
 * This is advisory for the picker and the segmented row: neither has a native constraint,
 * which is what 5.10/04 recovers with a client-side check. The radio group keeps its own
 * (see {@link radioOption}) and this rides beside it.
 */
function requiredAttribute(field: SpecField): string {
  return field.required ? ' aria-required="true"' : "";
}

/** The one value the whole control posts, for the two presentations that draw no input. */
function valueCarrier(field: SpecField, chosen: string): string {
  return (
    `<input type="hidden" name="${escapeHtml(field.name)}"` +
    ` value="${escapeHtml(chosen)}" data-choice-value>`
  );
}

/**
 * What the server drew as chosen, kept so a finished create form can be put back to it.
 *
 * The two carrier-bearing controls cannot lean on `form.reset()` the way the radio group
 * can. A hidden input's `value` is in the HTML "default" value mode, which means the IDL
 * property *reflects* the content attribute rather than shadowing it: writing a choice
 * through the carrier rewrites its default, and a reset then restores the value it was
 * just asked to forget. So the truth is written once, here, where nothing later moves it.
 */
function initialAttribute(presentation: ChoicePresentation, chosen: string): string {
  if (presentation === "radio") return "";
  return ` data-choice-initial="${escapeHtml(chosen)}"`;
}

/**
 * What the picker's closed control reads with nothing chosen. It rides the field rather
 * than being read back off the rendered value, because the rendered value is the *chosen*
 * label whenever there is one — a control that recovered its placeholder from the label it
 * is currently showing would put that label back the next time it was emptied.
 */
function placeholderAttribute(presentation: ChoicePresentation, field: SpecField): string {
  if (presentation !== "picker") return "";
  return ` data-choice-placeholder="${escapeHtml(placeholderFor(field))}"`;
}

function placeholderFor(field: SpecField): string {
  return `Choose ${field.label}…`;
}

/** The design's caret for the select shell (`design/controls.html`, "Enums"). */
const CHOICE_CHEVRON =
  `<span class="listbox__chevron">` +
  `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"` +
  ` stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M6 9l6 6 6-6"></path>` +
  `</svg></span>`;

/* ── the picker ────────────────────────────────────────────────────────────── */

/**
 * The drawn listbox: a closed `role="combobox"` button, a hidden panel, and a hidden
 * input carrying the value into the form. The panel is server-rendered complete, so the
 * chosen label reads correctly before any script runs; `public/choice-picker.js` takes
 * over the opening, the keyboard and the active-descendant reporting.
 */
function renderPicker(inputId: string, field: SpecField, chosen: string): string {
  const chosenOption = choiceFieldOptions(field).find((option) => option.value === chosen);
  const shown = escapeHtml(chosenOption ? chosenOption.label : placeholderFor(field));

  return (
    fieldLabel(inputId, field) +
    valueCarrier(field, chosen) +
    `<button class="field__control field__control--select listbox__button" type="button"` +
    ` id="${inputId}" role="combobox" aria-haspopup="listbox" aria-expanded="false"` +
    ` aria-controls="${inputId}-panel" aria-labelledby="${inputId}-label"` +
    `${requiredAttribute(field)}>` +
    `<span class="listbox__value${chosenOption ? "" : " is-placeholder"}">${shown}</span>` +
    CHOICE_CHEVRON +
    `</button>` +
    `<div class="listbox__panel" id="${inputId}-panel" role="listbox" tabindex="-1"` +
    ` aria-labelledby="${inputId}-label" hidden>` +
    `<div class="listbox__scroll">${pickerRuns(inputId, field, chosen)}</div>` +
    `</div>`
  );
}

function pickerRuns(inputId: string, field: SpecField, chosen: string): string {
  return renderRuns(choiceOptionRuns(field), (run, offset) => {
    const options = run.options
      .map((option, index) => pickerOption(inputId, option, chosen, offset + index))
      .join("");
    if (!run.group) return options;
    // The wrapper is what makes the heading an announced option group; the heading itself
    // stays presentational, as the design draws it (`design/controls.html`, "Enums") — its
    // words are read through `aria-labelledby`, and a second non-option element owned by
    // the group would break the listbox's required children.
    const headingId = `${inputId}-group-${run.group.id}`;
    return (
      `<div role="group" aria-labelledby="${headingId}">` +
      `<div class="listbox__group caps" role="presentation" id="${headingId}">` +
      `${escapeHtml(run.group.heading)}</div>` +
      options +
      `</div>`
    );
  });
}

function pickerOption(
  inputId: string,
  option: ChoiceOption,
  chosen: string,
  index: number,
): string {
  const noteId = `${inputId}-note-${index + 1}`;
  const disabled = refusesSelection(option, chosen) ? ' aria-disabled="true"' : "";
  const describedBy = option.note === undefined ? "" : ` aria-describedby="${noteId}"`;
  // `aria-hidden` keeps the note out of the option's name-from-contents while leaving it
  // readable through `aria-describedby`, which reaches a referenced node either way.
  // Without it a screen reader says the note twice — once as part of what the option is
  // called, once as its description.
  const note =
    option.note === undefined
      ? ""
      : `<span class="listbox__note" id="${noteId}" aria-hidden="true">` +
        `${escapeHtml(option.note)}</span>`;

  return (
    `<div class="listbox__option" role="option" id="${inputId}-option-${index + 1}"` +
    ` data-value="${escapeHtml(option.value)}"` +
    ` aria-selected="${option.value === chosen}"${disabled}${describedBy}>` +
    `${escapeHtml(option.label)}${note}</div>`
  );
}

/* ── the radio group ───────────────────────────────────────────────────────── */

/**
 * Native radio inputs in one labelled radiogroup — the real input stays the thing
 * focused, checked and submitted, and the drawn mark beside it is what is painted
 * (`design/controls.html`, "Radio"). No value carrier: the checked input is the value,
 * and an unchecked group posts nothing, which is the same absent selection the picker's
 * empty carrier means.
 */
function renderRadioGroup(inputId: string, field: SpecField, chosen: string): string {
  const runs = choiceOptionRuns(field);
  const grouped = runs.some((run) => run.group !== undefined);
  const body = renderRuns(runs, (run, offset) => {
    const options = run.options
      .map((option, index) => radioOption(inputId, field, option, chosen, offset + index))
      .join("");
    if (!grouped) return options;
    return radioRun(inputId, field, run, options);
  });

  // Ungrouped, the whole set is one radiogroup — the shape the design draws. Grouped, it
  // cannot be: `radiogroup` owns radios and nothing else, so a heading wrapper inside one
  // would take its own radios out of it. The runs become the radiogroups instead, each
  // named by its heading, inside a plain group named by the field. The inputs share a
  // name either way, so the browser still treats them as one exclusive set.
  const role = grouped ? "group" : "radiogroup";
  const required = grouped ? "" : requiredAttribute(field);
  return (
    fieldLabel(inputId, field) +
    `<div class="choice-set" id="${inputId}" role="${role}"` +
    ` aria-labelledby="${inputId}-label"${required}>${body}</div>`
  );
}

function radioRun(
  inputId: string,
  field: SpecField,
  run: ChoiceOptionRun,
  options: string,
): string {
  if (!run.group) {
    return (
      `<div class="choice-set__group" role="radiogroup"` +
      ` aria-labelledby="${inputId}-label"${requiredAttribute(field)}>${options}</div>`
    );
  }
  const headingId = `${inputId}-group-${run.group.id}`;
  return (
    `<div class="choice-set__group" role="radiogroup" aria-labelledby="${headingId}"` +
    `${requiredAttribute(field)}>` +
    `<span class="choice-set__heading caps" id="${headingId}">` +
    `${escapeHtml(run.group.heading)}</span>` +
    options +
    `</div>`
  );
}

function radioOption(
  inputId: string,
  field: SpecField,
  option: ChoiceOption,
  chosen: string,
  index: number,
): string {
  const optionId = `${inputId}-option-${index + 1}`;
  const noteId = `${inputId}-note-${index + 1}`;
  const disabled = refusesSelection(option, chosen) ? " disabled" : "";
  const describedBy = option.note === undefined ? "" : ` aria-describedby="${noteId}"`;
  const note =
    option.note === undefined
      ? ""
      : `<span class="choice__hint" id="${noteId}" aria-hidden="true">` +
        `${escapeHtml(option.note)}</span>`;

  // The one presentation that keeps a native constraint. `required` on a radio binds the
  // whole same-named set, so the browser refuses a submit with nothing chosen — which is
  // exactly what the drawn picker and the segmented row had to give up.
  const required = field.required ? " required" : "";
  return (
    `<label class="choice choice--radio">` +
    `<input class="choice__input" type="radio" id="${optionId}"` +
    ` name="${escapeHtml(field.name)}" value="${escapeHtml(option.value)}"` +
    `${option.value === chosen ? " checked" : ""}${required}${disabled}${describedBy}>` +
    `<span class="choice__mark"><span class="choice__glyph"></span></span>` +
    `<span class="choice__body">` +
    `<span class="choice__title">${escapeHtml(option.label)}</span>${note}` +
    `</span></label>`
  );
}

/* ── the segmented control ─────────────────────────────────────────────────── */

/**
 * The joined button row: one mutually exclusive pressed value, ordinary button keyboard
 * activation, and a hidden input carrying the choice into the form
 * (`design/controls.html`, "Segmented"). The spec has already refused a grouped or noted
 * option here, so there is exactly one run to draw.
 */
function renderSegmented(inputId: string, field: SpecField, chosen: string): string {
  const segments = choiceFieldOptions(field)
    .map((option, index) => segment(inputId, option, chosen, index))
    .join("");

  return (
    fieldLabel(inputId, field) +
    valueCarrier(field, chosen) +
    `<div class="segmented" id="${inputId}" role="group"` +
    ` aria-labelledby="${inputId}-label">${segments}</div>`
  );
}

function segment(inputId: string, option: ChoiceOption, chosen: string, index: number): string {
  const disabled = refusesSelection(option, chosen) ? " disabled" : "";
  return (
    `<button type="button" id="${inputId}-option-${index + 1}"` +
    ` data-value="${escapeHtml(option.value)}"` +
    ` aria-pressed="${option.value === chosen}"${disabled}>` +
    `${escapeHtml(option.label)}</button>`
  );
}

/* ── run walking ───────────────────────────────────────────────────────────── */

/**
 * Draw each run in order, handing every run the number of options already drawn. Ids are
 * positional across the whole control rather than within a run, so an option's id and its
 * note's id stay unique however the groups are arranged.
 */
function renderRuns(
  runs: readonly ChoiceOptionRun[],
  draw: (run: ChoiceOptionRun, offset: number) => string,
): string {
  let offset = 0;
  const drawn: string[] = [];
  for (const run of runs) {
    drawn.push(draw(run, offset));
    offset += run.options.length;
  }
  return drawn.join("");
}
