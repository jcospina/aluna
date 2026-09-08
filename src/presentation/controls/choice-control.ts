// The choice control, in the three presentations a field may declare.
//
// All three draw the same declared options in the same order and post the same wire value; what
// differs is the shape on screen. The picker is the drawn listbox (`public/choice-picker.js`) —
// a `<select>` is a replaced element whose popup no stylesheet reaches inside, so on a surface
// where every boundary is drawn the panel has to be ours. Radio is native radio inputs in one
// labelled radiogroup. Segmented is the joined button row, which carries neither a group heading
// nor an option note and is refused a spec that declares one. Create and edit share every path
// here; the only difference is which option arrives already chosen.

import { assertNever } from "../../platform/errors.ts";
import {
  type ChoiceOption,
  type ChoiceOptionRun,
  type ChoicePresentation,
  choiceFieldOptions,
  choiceOptionRuns,
  type SpecField,
  type UiFormIntent,
} from "../../registry/index.ts";
import { choiceInputForField } from "../../runtime/field-types/choice-input.ts";
import { ALUNA_PRESENT_MARKER } from "../../runtime/router/wire/wire-protocol.ts";
import { escapeHtml } from "../../server/http/html.ts";
import { type FieldChrome, fieldChrome } from "../fields/field-chrome.ts";

/**
 * The option a control draws as chosen. A stored value the field does not declare resolves to
 * nothing, not to the first option, which an unguarded control would save over the record.
 */
function chosenValue(field: SpecField, value: unknown): string {
  const stored = value === null || value === undefined ? "" : String(value);
  return choiceFieldOptions(field).some((option) => option.value === stored) ? stored : "";
}

/**
 * Whether this option refuses a press. The option the record already holds is never one: refusing
 * it would hide that value, or drop it from the submission and clear the row.
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
  // A choice is always emptyable — no selection is a stored `null` — and never carries a
  // length limit, so the chrome here is the optional marker and the declared hint.
  const chrome = fieldChrome(inputId, field, form, { emptyable: true });
  const body = controlFor(presentation)(inputId, field, chosen, chrome);

  return (
    `<div class="field field--choice${presentation === "picker" ? " listbox" : ""}"` +
    ` data-choice-presentation="${presentation}"${placeholderAttribute(presentation, field)}` +
    `${initialAttribute(presentation, chosen)}>` +
    `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${escapeHtml(field.name)}">` +
    body +
    chrome.trailing +
    `</div>`
  );
}

type ChoiceControl = (
  inputId: string,
  field: SpecField,
  chosen: string,
  chrome: FieldChrome,
) => string;

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
      return assertNever(presentation, "choice presentation");
  }
}

/* ── shared parts ──────────────────────────────────────────────────────────── */

/**
 * The field's own label, which every presentation names its control by. None of the three is a
 * form element a `<label for>` can point at, so all three are named by reference instead.
 */
function fieldLabel(inputId: string, field: SpecField, chrome: FieldChrome): string {
  return (
    `<span class="field__label caps" id="${inputId}-label">` +
    `${escapeHtml(field.label)}${chrome.labelSuffix}</span>`
  );
}

/**
 * A required choice says so on the roles that can carry it — `combobox` and `radiogroup`. A
 * segmented row is a `group`, which supports no such state, so it says nothing at all.
 */
function requiredAttribute(field: SpecField): string {
  return field.required ? ' aria-required="true"' : "";
}

/**
 * The one value the whole control posts, for the two presentations that draw no input. A hidden
 * input is barred from constraint validation, so `data-choice-required` is what the client reads.
 */
function valueCarrier(field: SpecField, chosen: string): string {
  return (
    `<input type="hidden" name="${escapeHtml(field.name)}"` +
    ` value="${escapeHtml(chosen)}" data-choice-value` +
    `${field.required ? " data-choice-required" : ""}>`
  );
}

/**
 * What the server drew as chosen, kept so a finished create form can be put back to it. A hidden
 * input's `value` is its default, so writing through the carrier rewrites what a reset restores.
 */
function initialAttribute(presentation: ChoicePresentation, chosen: string): string {
  if (presentation === "radio") return "";
  return ` data-choice-initial="${escapeHtml(chosen)}"`;
}

/**
 * What the picker's closed control reads with nothing chosen. It rides the field rather than the
 * rendered value, which is the chosen label and would come back the next time it was emptied.
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
 * The drawn listbox: a closed `role="combobox"` button, a hidden panel, and a hidden input
 * carrying the value. Server-rendered complete, so the chosen label reads before any script runs.
 */
function renderPicker(
  inputId: string,
  field: SpecField,
  chosen: string,
  chrome: FieldChrome,
): string {
  const chosenOption = choiceFieldOptions(field).find((option) => option.value === chosen);
  const shown = escapeHtml(chosenOption ? chosenOption.label : placeholderFor(field));

  return (
    fieldLabel(inputId, field, chrome) +
    valueCarrier(field, chosen) +
    `<button class="field__control field__control--select listbox__button" type="button"` +
    ` id="${inputId}" role="combobox" aria-haspopup="listbox" aria-expanded="false"` +
    ` aria-controls="${inputId}-panel" aria-labelledby="${inputId}-label"` +
    `${chrome.describedBy}${requiredAttribute(field)}>` +
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
    // The wrapper is what makes the heading an announced option group; the heading itself stays
    // presentational, since a second non-option child would break the listbox's required children.
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
  // `aria-hidden` keeps the note out of the option's name-from-contents while leaving it readable
  // through `aria-describedby`. Without it a screen reader says the note twice.
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
 * Native radio inputs in one labelled radiogroup: the real input is focused, checked and
 * submitted, and the drawn mark beside it is painted. No value carrier — the input is the value.
 */
function renderRadioGroup(
  inputId: string,
  field: SpecField,
  chosen: string,
  chrome: FieldChrome,
): string {
  const runs = choiceOptionRuns(field);
  const grouped = runs.some((run) => run.group !== undefined);
  const body = renderRuns(runs, (run, offset) => {
    const options = run.options
      .map((option, index) => radioOption(inputId, field, option, chosen, offset + index))
      .join("");
    if (!grouped) return options;
    return radioRun(inputId, field, run, options);
  });

  // Ungrouped, the whole set is one radiogroup. Grouped it cannot be — `radiogroup` owns radios
  // and nothing else — so each run becomes one, and a shared name keeps the set exclusive.
  const role = grouped ? "group" : "radiogroup";
  const required = grouped ? "" : requiredAttribute(field);
  return (
    fieldLabel(inputId, field, chrome) +
    `<div class="choice-set" id="${inputId}" role="${role}"` +
    ` aria-labelledby="${inputId}-label"${chrome.describedBy}${required}>${body}</div>`
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

  // The one presentation that keeps a native constraint: `required` on a radio binds the whole
  // same-named set, so the browser refuses a submit with nothing chosen.
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
 * The joined button row: one mutually exclusive pressed value, ordinary button activation, and a
 * hidden carrier. The spec has refused a grouped or noted option here, so there is one run.
 */
function renderSegmented(
  inputId: string,
  field: SpecField,
  chosen: string,
  chrome: FieldChrome,
): string {
  const segments = choiceFieldOptions(field)
    .map((option, index) => segment(inputId, option, chosen, index))
    .join("");

  return (
    fieldLabel(inputId, field, chrome) +
    valueCarrier(field, chosen) +
    `<div class="segmented" id="${inputId}" role="group"` +
    ` aria-labelledby="${inputId}-label"${chrome.describedBy}>${segments}</div>`
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
 * positional across the control, not within a run, so they stay unique however groups arrange.
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
