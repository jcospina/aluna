// @ts-check
/**
 * Capability presentation patterns.
 *
 * Shell-level patterns applied to every capability, not decisions generation
 * makes. Two of them exist so far: the collection and the record form — and on
 * this surface they are two views of one window rather than a page and a popup
 * over it (D2). Opening a record replaces the collection inside the window and
 * a back control returns to it. There is no modal anywhere in Aluna, because a
 * modal would make the rest of the desk inert to look at one book.
 */

import { STATE_TONE } from "./data/capabilities.js";

/** @typedef {import("./data/capabilities.js").Capability} Capability */
/** @typedef {import("./data/capabilities.js").CapabilityRecord} CapabilityRecord */
/** @typedef {import("./data/capabilities.js").CapabilityField} CapabilityField */

/**
 * Generic in the tag so a caller gets the element it actually asked for —
 * `el("input", …)` is an `HTMLInputElement`, and setting `.type` on it stays
 * checked rather than being waved through on a bare `HTMLElement`.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string | null} [className]
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const MAGNIFIER =
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" ` +
  `stroke="currentColor" stroke-width="3" aria-hidden="true">` +
  `<circle cx="10" cy="10" r="7"/>` +
  `<path d="M15 15l6 6" stroke-linecap="round"/></svg>`;

const ARROW =
  `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" ` +
  `stroke="currentColor" stroke-width="3" aria-hidden="true">` +
  `<path d="M14 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * A capability, as the window holds it: the collection, and the record form it
 * swaps to. The two never coexist, which is what makes a single window enough.
 *
 * @param {Capability} capability
 * @param {object} [opts]
 * @param {"feed"|"grid"} [opts.layout]
 * @returns {HTMLElement}
 */
export function renderCollection(capability, opts = {}) {
  const layout = opts.layout ?? "feed";
  const host = el("div", "collection-host");

  /** @param {CapabilityRecord | null} record */
  const showRecord = (record) =>
    host.replaceChildren(renderRecordView(capability, record, () => showList()));
  const showList = () => host.replaceChildren(renderList(capability, layout, showRecord));

  showList();
  return host;
}

/**
 * The collection, in the order the shell fixes.
 *
 *   1 · Search & action — the search input, the create action beside it
 *   2 · Count — what the collection holds, under the rail and above the first item
 *   3 · Records — the feed or grid, per the capability's declared layout
 *
 * The two things you can do to a collection share row 1; the count is a fact
 * about it rather than an action on it, so it gets its own line. Below 620px of
 * *window* — not viewport — each control in row 1 takes a full row.
 *
 * The count is live and updates on search, and a filtered count states both
 * numbers — how many matched and how many there are. A matched number alone
 * reads as the whole truth and is not, and nothing matched has to say so
 * beside a total that is not zero, or a filtered collection reads as an
 * empty one.
 *
 * @param {Capability} capability
 * @param {"feed"|"grid"} layout
 * @param {(record: CapabilityRecord | null) => void} onOpen
 * @returns {HTMLElement}
 */
function renderList(capability, layout, onOpen) {
  const root = el("div", "collection");

  /* Row 1 — search and the create action, the two things you can do to a collection. */
  const head = el("div", "collection__head");
  const search = el("div", "search");
  const glyph = el("span", "search__glyph");
  glyph.innerHTML = MAGNIFIER;
  const input = el("input", "search__input");
  input.type = "search";
  input.placeholder = `Search ${capability.label.toLowerCase()}…`;
  input.setAttribute("aria-label", `Search ${capability.label}`);
  search.append(glyph, input);
  const create = el("button", "btn btn--primary", "New record");
  create.type = "button";
  create.addEventListener("click", () => onOpen(null));
  head.append(search, create);

  /* Row 2 — what the collection holds. */
  const count = el("span", "collection__count caps");

  /* Row 3 — the records. */
  const list = el("div", `records records--${layout}`);

  /** @param {string} query */
  const paint = (query) => {
    const q = query.trim().toLowerCase();
    const rows = capability.records.filter(
      (r) => !q || r.title.toLowerCase().includes(q) || r.detail.toLowerCase().includes(q),
    );

    const total = capability.records.length;
    /* The capability's own record noun, the way every other piece of desk copy uses it.
       Both numbers while filtered, the plain total at rest — and the total governs the
       noun either way, because the noun belongs to the collection, not to the search. */
    const noun = total === 1 ? capability.noun : `${capability.noun}s`;
    count.textContent = q ? `${rows.length} of ${total} ${noun}` : `${total} ${noun}`;

    /*
     * Two states, two sentences. An empty collection and a search that found
     * nothing are different facts, and one string covering both tells a new
     * capability it has no matches for a search nobody ran.
     */
    const empty = q
      ? `No ${capability.noun}s match “${query.trim()}”.`
      : `Nothing here yet. Add your first ${capability.noun}.`;

    list.replaceChildren(
      ...(rows.length
        ? rows.map((record) => recordCard(record, onOpen))
        : [el("p", "records__empty sm", empty)]),
    );
  };

  input.addEventListener("input", () => paint(input.value));
  paint("");

  root.append(head, count, list);
  return root;
}

/**
 * A record is a button, because opening one is the only thing you can do with
 * it and a button is what the keyboard already knows how to reach.
 *
 * @param {CapabilityRecord} record
 * @param {(record: CapabilityRecord) => void} onOpen
 * @returns {HTMLElement}
 */
function recordCard(record, onOpen) {
  const card = el("button", "record");
  card.type = "button";
  const text = el("div", "record__text");
  text.append(el("b", "record__title", record.title), el("p", "record__detail", record.detail));
  const tone = STATE_TONE[record.state] ?? "wait";
  card.append(text, el("span", `pill pill--${tone}`, record.state));
  card.addEventListener("click", () => onOpen(record));
  return card;
}

/**
 * The record, filling the window the collection was in. Back is navigation and
 * sits above the form; Cancel is the form's own escape and does the same thing
 * from the other end. Both exist because the window is the whole surface — with
 * nothing behind it to click, there has to be a way out at the top.
 *
 * @param {Capability} capability
 * @param {CapabilityRecord | null} record the record, or null when creating
 * @param {() => void} onBack
 * @returns {HTMLElement}
 */
function renderRecordView(capability, record, onBack) {
  const view = el("div", "detail");

  const back = el("button", "detail__back");
  back.type = "button";
  const arrow = el("span", "detail__arrow");
  arrow.innerHTML = ARROW;
  back.append(arrow, el("span", null, capability.label));
  back.addEventListener("click", onBack);

  const bar = el("div", "detail__bar");
  bar.append(back, el("b", "detail__title", record ? record.title : `New ${capability.noun}`));

  view.append(bar, renderRecordForm(capability, { record, onDone: onBack }));
  return view;
}

/**
 * The record form.
 *
 * Field label in small caps above its control, guidance text below in subtle
 * ink, related short fields paired two-up, and an actions row separated by a
 * rule — save and cancel on the left, destructive isolated on the right.
 *
 * That separation is what keeps "close means put away" honest at the record
 * level too: destructive actions are never adjacent to routine ones. A record
 * being created has no Delete at all, because there is nothing to destroy yet.
 *
 * @param {Capability} capability
 * @param {object} [opts]
 * @param {CapabilityRecord | null} [opts.record] null when creating
 * @param {() => void} [opts.onDone] where Save and Cancel go
 * @returns {HTMLElement}
 */
export function renderRecordForm(capability, opts = {}) {
  const record = opts.record ?? null;
  const creating = opts.record === null;
  const form = el("div", "form");

  placeFields(form, capability.fields, (field, index) =>
    fieldValue(field, index, record, creating),
  );
  form.append(renderActions(creating, opts.onDone));
  return form;
}

/**
 * What a field shows. A record being created shows nothing at all, and the
 * first field carries the record's own name when there is one — the fixtures
 * have no per-record field values to draw from.
 *
 * @param {CapabilityField} field
 * @param {number} index
 * @param {CapabilityRecord | null} record
 * @param {boolean} creating
 * @returns {string}
 */
function fieldValue(field, index, record, creating) {
  if (creating) return "";
  if (index === 0 && record?.title) return record.title;
  return field.value;
}

/**
 * Lay the fields out. Short fields that belong together are paired two-up; a
 * full-width field closes any pair still open.
 *
 * @param {HTMLElement} form
 * @param {CapabilityField[]} fields
 * @param {(field: CapabilityField, index: number) => string} readValue
 */
function placeFields(form, fields, readValue) {
  /** @type {HTMLElement | null} */
  let pair = null;
  for (const [index, field] of fields.entries()) {
    const node = renderField(field, readValue(field, index));
    if (field.span !== 1) {
      pair = null;
      form.append(node);
      continue;
    }
    if (!pair) {
      pair = el("div", "form__pair");
      form.append(pair);
    }
    pair.append(node);
    if (pair.children.length === 2) pair = null;
  }
}

/**
 * Save and cancel on the left, destructive isolated on the right. A record
 * being created has no Delete at all, because there is nothing to destroy yet.
 *
 * @param {boolean} creating
 * @param {(() => void) | undefined} onDone
 * @returns {HTMLElement}
 */
function renderActions(creating, onDone) {
  const actions = el("div", "form__actions");
  const save = el("button", "btn btn--primary", creating ? "Add it" : "Save changes");
  save.type = "button";
  const cancel = el("button", "btn btn--outline", "Cancel");
  cancel.type = "button";
  actions.append(save, cancel);

  if (!creating) {
    const remove = el("button", "btn btn--danger", "Delete");
    remove.type = "button";
    actions.append(el("span", "form__spacer"), remove);
  }
  if (onDone) {
    for (const button of [save, cancel]) button.addEventListener("click", onDone);
  }
  return actions;
}

const CHEVRON =
  `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" ` +
  `stroke="currentColor" stroke-width="3" aria-hidden="true">` +
  `<path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * @param {CapabilityField} field
 * @param {string} [value] overrides the fixture's own, and may be empty
 * @returns {HTMLElement}
 */
function renderField(field, value) {
  const wrap = el("label", "field");
  wrap.append(el("span", "field__label caps", field.label));

  const control = el(
    "span",
    `field__control${field.type === "select" ? " field__control--select" : ""}`,
  );
  control.append(el("span", null, value ?? field.value));
  if (field.type === "select") {
    const chevron = el("span", "field__chevron");
    chevron.innerHTML = CHEVRON;
    control.append(chevron);
  }
  wrap.append(control);

  if (field.guidance) {
    wrap.append(el("span", "field__guidance", field.guidance));
  }
  return wrap;
}
