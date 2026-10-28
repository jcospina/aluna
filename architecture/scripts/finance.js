// @ts-check
/**
 * The Finance tracker as its window shows it, in the design system's collection and form. v1 has
 * a date, a description, an amount and a category. v2 adds Type, and every transaction saved before
 * it existed holds nothing there. The views are pictures of the app: the window that shows them
 * makes them inert.
 */

import { LABEL } from "./build.js";

/** @typedef {{ date: string, description: string, amount: string, category: string }} Transaction */

/** @type {Transaction[]} */
const SAVED = [
  {
    date: "2026-10-15",
    description: "Dinner with Ana",
    amount: "38.50",
    category: "Food & dining",
  },
  {
    date: "2026-10-12",
    description: "Monthly bus pass",
    amount: "45.00",
    category: "Transportation",
  },
  {
    date: "2026-10-09",
    description: "Electricity bill",
    amount: "72.15",
    category: "Bills & utilities",
  },
  { date: "2026-10-05", description: "October salary", amount: "4,200.00", category: "Salary" },
  {
    date: "2026-10-03",
    description: "Groceries at the market",
    amount: "86.40",
    category: "Food & dining",
  },
  { date: "2026-10-01", description: "Rent", amount: "1,450.00", category: "Housing" },
];

const MAGNIFIER =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="3" aria-hidden="true"><circle cx="10" cy="10" r="7"/>' +
  '<path d="M15 15l6 6" stroke-linecap="round"/></svg>';

const BACK =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
  'stroke-width="3" aria-hidden="true"><path d="M14 6l-6 6 6 6" stroke-linecap="round" ' +
  'stroke-linejoin="round"/></svg>';

const CHEVRON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
  'stroke-width="3" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke-linecap="round" ' +
  'stroke-linejoin="round"/></svg>';

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string | null} [className]
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {string} text
 * @param {string | null} [className]
 */
function button(text, className = null) {
  const node = el("button", className, text);
  node.type = "button";
  return node;
}

/**
 * @param {string} text
 * @param {string} tone
 */
const chip = (text, tone) => el("span", `pill pill--${tone}`, text);

/**
 * One transaction's card. v2's card shows Type too.
 *
 * @param {Transaction} saved
 * @param {1 | 2} version
 */
function card(saved, version) {
  const record = el("div", "record finance-card");
  const top = el("div", "finance-card__top");
  const says = el("div", "finance-card__says");
  says.append(
    el("span", "finance-card__date", saved.date),
    el("span", "finance-card__title", saved.description),
  );
  top.append(says, el("span", "finance-card__amount", saved.amount));
  const chips = el("div", "finance-card__chips");
  // Every transaction here was saved before Type existed, so v2's card finds nothing in it.
  if (version === 2) chips.append(chip("No type", "none"));
  chips.append(el("span", "finance-card__category caps", saved.category));
  record.append(top, chips);
  return record;
}

/**
 * The collection: search and New beside it, the count, then the transactions, newest first.
 *
 * @param {1 | 2} version
 * @param {boolean} saved whether the weeks of use have filled it
 */
export function collection(version, saved) {
  const root = el("div", "collection finance");
  root.dataset.version = String(version);
  const head = el("div", "collection__head");
  const search = el("div", "search");
  const glyph = el("span", "search__glyph");
  glyph.innerHTML = MAGNIFIER;
  const input = el("input", "search__input");
  input.type = "search";
  input.placeholder = `Search ${LABEL}`;
  input.setAttribute("aria-label", `Search ${LABEL}`);
  search.append(glyph, input);
  head.append(search, button(`New ${LABEL}`, "btn btn--primary"));
  root.append(head);

  const rows = saved ? SAVED : [];
  if (rows.length === 0) {
    root.append(
      el("p", "records__empty sm", "Nothing here yet — add your first transaction above."),
    );
    return root;
  }
  root.append(el("span", "collection__count caps", `${rows.length} transactions`));
  const list = el("div", "records records--feed");
  list.append(...rows.map((each) => card(each, version)));
  root.append(list);
  return root;
}

/**
 * @param {string} label
 * @param {Node} control
 */
function field(label, control) {
  const wrap = el("div", "field");
  wrap.append(el("span", "field__label caps", label), control);
  return wrap;
}

/** @param {string} value */
function shown(value) {
  const control = el("span", "field__control");
  control.append(el("span", null, value));
  return control;
}

/**
 * The oldest transaction, opened in v2: every field it was saved with, and Type with neither
 * choice pressed, because the column was added after it was saved.
 */
export function olderRecord() {
  const rent = SAVED.at(-1) ?? SAVED[0];
  const view = el("div", "detail finance");
  const bar = el("div", "detail__bar");
  const back = el("button", "detail__back");
  back.type = "button";
  const arrow = el("span", "detail__arrow");
  arrow.innerHTML = BACK;
  back.append(arrow, el("span", null, LABEL));
  bar.append(back);

  const form = el("div", "form");
  const pair = el("div", "form__pair");
  pair.append(field("Date", shown(rent?.date ?? "")), field("Amount", shown(rent?.amount ?? "")));
  const category = el("span", "field__control field__control--select");
  const chevron = el("span", "field__chevron");
  chevron.innerHTML = CHEVRON;
  category.append(el("span", null, rent?.category ?? ""), chevron);
  const type = el("span", "segmented");
  type.setAttribute("role", "group");
  type.setAttribute("aria-label", "Type");
  for (const choice of ["Expense", "Income"]) {
    const press = button(choice);
    press.setAttribute("aria-pressed", "false");
    type.append(press);
  }
  const actions = el("div", "form__actions");
  actions.append(
    button("Save", "btn btn--primary"),
    button("Cancel", "btn btn--outline"),
    button("Delete", "btn btn--danger"),
  );
  form.append(
    pair,
    field("Description", shown(rent?.description ?? "")),
    field("Category", category),
    field("Type", type),
    actions,
  );
  view.append(bar, form);
  return view;
}
