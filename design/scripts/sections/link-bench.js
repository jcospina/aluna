// @ts-check
/**
 * The Links specimen: one book's form whose Author field is walked through every state a link
 * gives it, and the collection once the books are linked. Everything stays live. The chain opens
 * its chooser, a pick connects after a moment, the linked field searches, the broken chain asks
 * before it disconnects. Nothing talks to a server: the lists are written here.
 */

import { mountListboxes } from "../controls/listbox.js";
import { OPEN_ICON, openRecordName } from "../controls/open-record.js";
import { onEveryPick, wireStates } from "./state-picker.js";

const AUTHORS = [
  "Ann Leckie",
  "Becky Chambers",
  "Brandon Sanderson",
  "Martha Wells",
  "N. K. Jemisin",
  "Neil Gaiman",
  "Octavia E. Butler",
  "Susanna Clarke",
  "Ted Chiang",
  "Terry Pratchett",
  "Ursula K. Le Guin",
];

/** @typedef {[group: string, options: [value: string, label: string, note: string][]][]} Targets */

const PUBLISHERS = /** @type {Targets[number]} */ ([
  "Publishers",
  [
    ["publishers.name", "Name", "Tor, Gollancz, Ace"],
    ["publishers.city", "City", "New York, London"],
  ],
]);
const CONTACTS = /** @type {Targets[number]} */ ([
  "Contacts",
  [["contacts.phone", "Phone", "+57 300 123 4567, +57 310 555 0199"]],
]);
const AUTHOR_NAMES = "Ursula K. Le Guin, Octavia E. Butler, Brandon Sanderson";

/** What each field's chooser offers: the likeliest target first, then each capability. */
const TARGETS = /** @type {Record<"title" | "author", Targets>} */ ({
  title: [
    [
      "Suggested",
      [["reading_log.title", "Reading Log · Title", "Piranesi, The Dispossessed, Kindred"]],
    ],
    [
      "Authors",
      [
        ["authors.name", "Name", AUTHOR_NAMES],
        ["authors.pen_name", "Pen name", "James Tiptree Jr."],
      ],
    ],
    PUBLISHERS,
    CONTACTS,
  ],
  author: [
    ["Suggested", [["authors.name", "Authors · Name", AUTHOR_NAMES]]],
    ["Authors", [["authors.pen_name", "Pen name", "James Tiptree Jr."]]],
    PUBLISHERS,
    CONTACTS,
  ],
});

const CONNECTING_MS = 2400;

const svg = (
  /** @type {number} */ size,
  /** @type {number} */ stroke,
  /** @type {string} */ paths,
) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const CHAIN = svg(
  14,
  2.25,
  '<path d="M10 13.5a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.15 1.15"></path>' +
    '<path d="M14 10.5a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.15-1.15"></path>',
);
const BROKEN_PATHS =
  '<path d="M15.6 12.9l2.9-2.9a4 4 0 1 0-5.66-5.66l-1.15 1.15"></path>' +
  '<path d="M8.4 11.1L5.5 14a4 4 0 1 0 5.66 5.66l1.15-1.15"></path>' +
  '<path d="M8 3v2.5M3 8h2.5M16 21v-2.5M21 16h-2.5"></path>';
const BROKEN = svg(14, 2.25, BROKEN_PATHS);
const CHEVRON = svg(12, 3, '<path d="M6 9l6 6 6-6"></path>');

/**
 * @typedef {"plain" | "chooser" | "empty" | "connecting" | "linked" | "unmatched" | "asking"} State
 * @typedef {{ record: "existing" | "new", state: State }} Shown
 */

/**
 * A single-line field with the chain inside it, and the chooser the chain opens.
 *
 * @param {{ id: string, label: string, noun: string, value: string, targets: Targets | null,
 *   disabled?: boolean }} field
 */
function chained({ id, label, noun, value, targets, disabled = false }) {
  const list = targets
    ? `<p class="link-control__line" id="${id}-line">Pick where every book’s ${noun} comes from.</p>
      </div>
      <div class="listbox__scroll" data-listbox-list aria-labelledby="${id}-heading" aria-describedby="${id}-line">
        ${targets.map(([group, options], g) => targetGroup(id, g, group, options)).join("")}
      </div>`
    : `</div>
      <div class="listbox__scroll" data-listbox-list aria-labelledby="${id}-heading"></div>
      <p class="listbox__empty" role="status">There’s nothing you can connect to yet.</p>`;
  return `<div class="field">
    <label class="field__label caps" for="${id}">${label}</label>
    <div class="listbox link-control" data-listbox>
      <span class="field__control"><input class="field__input" id="${id}" type="text" value="${value}"><button class="listbox__button link-control__button" type="button" aria-label="Connect every book’s ${noun}"${disabled ? " disabled" : ""}>${CHAIN}<span class="listbox__value" hidden></span></button></span>
      <div class="listbox__panel link-control__panel" hidden>
        <div class="link-control__head">
          <p class="link-control__heading" id="${id}-heading">Connect every book’s ${noun} to…</p>
          ${list}
      </div>
    </div>
  </div>`;
}

/**
 * @param {string} id
 * @param {number} index
 * @param {string} group
 * @param {Targets[number][1]} options
 */
function targetGroup(id, index, group, options) {
  const groupId = `${id}-group-${index}`;
  return `<div role="group" aria-labelledby="${groupId}">
    <div class="listbox__group caps" role="presentation" id="${groupId}">${group}</div>
    ${options
      .map(([value, label, note], at) => {
        const noteId = `${groupId}-note-${at}`;
        return `<div class="listbox__option" role="option" data-value="${value}" aria-describedby="${noteId}">${label}<span class="listbox__note" id="${noteId}" aria-hidden="true">${note}</span></div>`;
      })
      .join("")}
  </div>`;
}

/**
 * The Author field once linked: the target's records in a dropdown that searches, the broken
 * chain, and the open icon while it names a record.
 *
 * @param {{ picked: string, typed?: string, busy?: boolean }} field
 */
function linked({ picked, typed = "", busy = false }) {
  const unmatched = typed !== "";
  const options = AUTHORS.map(
    (name) =>
      `<div class="listbox__option" role="option" data-value="${name}"${name === picked ? ' aria-selected="true"' : ""}>${name}</div>`,
  ).join("");
  const opener = picked
    ? `<a class="linked-field__open" href="#link" aria-label="${openRecordName(picked)}">${OPEN_ICON}</a>`
    : "";
  return `<div class="field">
    <label class="field__label caps" id="link-author-label" for="link-author">Author</label>
    <div class="listbox linked-field" data-listbox${unmatched ? " data-listbox-unmatched" : ""}>
      <span class="field__control field__control--select"><input class="field__input" id="link-author" type="text" role="combobox" aria-expanded="false" autocomplete="off" spellcheck="false" placeholder="Choose the author…" value="${typed}"${unmatched ? ' aria-describedby="link-author-guidance"' : ""}><span class="linked-field__slot" aria-hidden="true"></span><span class="listbox__chevron">${CHEVRON}</span></span><button class="linked-field__unlink" type="button" aria-label="Disconnect every book’s author"${busy ? " disabled" : ""} data-link-unlink>${BROKEN}</button>${opener}
      <div class="listbox__panel" hidden>
        <div class="listbox__scroll" aria-labelledby="link-author-label">${options}</div>
      </div>
    </div>
    ${unmatched ? '<span class="field__guidance" id="link-author-guidance">I could not find this author, mind picking one?</span>' : ""}
  </div>`;
}

const QUESTION = `<div class="window__leaving">
  <div class="window__leaving-panel">
    <p class="window__leaving-lead" id="link-unlink-lead">Disconnect books from authors?</p>
    <p class="window__leaving-detail" id="link-unlink-detail">Books will still keep the author as text</p>
    <div class="window__leaving-actions">
      <button class="btn btn--outline" type="button" aria-describedby="link-unlink-lead link-unlink-detail" data-link-keep>Keep them connected</button><button class="btn btn--danger" type="button" aria-describedby="link-unlink-lead link-unlink-detail" data-link-disconnect>Disconnect</button>
    </div>
  </div>
</div>`;

/**
 * The Author field in the state shown: the chain and its chooser until a target is picked, the
 * linked dropdown after.
 *
 * @param {Shown} shown
 */
function authorField({ record, state }) {
  const author = record === "existing" ? "Brandon Sanderson" : "";
  if (state === "plain" || state === "chooser" || state === "empty") {
    const targets = state === "empty" ? null : TARGETS.author;
    return chained({ id: "link-author", label: "Author", noun: "author", value: author, targets });
  }
  if (state === "unmatched") return linked({ picked: "", typed: "Ursula Le Guin" });
  return linked({ picked: author, busy: state === "connecting" });
}

/**
 * @param {boolean} existing
 * @param {boolean} busy Save and Delete wait while Aluna connects
 */
function actions(existing, busy) {
  const off = busy ? " disabled" : "";
  const cancel = '<button class="btn btn--outline" type="button">Cancel</button>';
  return existing
    ? `<button class="btn btn--primary" type="button"${off}>Save</button>${cancel}<span class="form__spacer"></span><button class="btn btn--danger" type="button"${off}>Delete</button>`
    : `<button class="btn btn--primary" type="button"${off}>Add</button>${cancel}`;
}

/** @param {Shown} shown */
function form(shown) {
  const existing = shown.record === "existing";
  const busy = shown.state === "connecting";
  const title = chained({
    id: "link-title",
    label: "Title",
    noun: "title",
    value: existing ? "Mistborn" : "",
    targets: TARGETS.title,
    disabled: busy,
  });
  return `<div class="form" style="min-height: 31rem">
    ${busy ? '<p class="link-control__note" role="status">Connecting your books to authors…</p>' : ""}
    ${title}
    ${authorField(shown)}
    <div class="field">
      <label class="field__label caps" for="link-notes">Notes <span class="field__optional">optional</span></label>
      <span class="field__control field__control--area"><textarea class="field__textarea" id="link-notes" rows="2">${existing ? "Signed copy" : ""}</textarea></span>
    </div>
    <div class="form__actions">${actions(existing, busy)}</div>
  </div>
  ${shown.state === "asking" ? QUESTION : ""}`;
}

/**
 * The form specimen: a state picker, a record picker, and the window they redraw. A state the
 * form reaches by being used is shown in the picker without redrawing what was typed.
 *
 * @param {ParentNode} root
 */
function mountForm(root) {
  const host = root.querySelector("[data-link-form]");
  const states = root.querySelector("[data-link-states]");
  const records = root.querySelector("[data-link-records]");
  if (!(host instanceof HTMLElement) || !(states instanceof HTMLElement) || !records) return;
  const picker = mountListboxes(states.parentElement ?? states).find((l) => l.root === states);
  if (!picker) return;
  const win = /** @type {{ alunaWindow?: { setTitle(title: string): void } } | null} */ (
    host.closest("[data-window]")
  );
  /** @type {Shown["record"]} */
  let record = "existing";
  /** The state the form is drawn in. The question is laid over it, never drawn in its place. */
  let drawn = /** @type {State} */ ("plain");
  /** @type {import("../controls/listbox.js").Listbox[]} */
  let mounted = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pending;
  let quiet = false;

  const option = (/** @type {State} */ state) =>
    states.querySelector(`[role="option"][data-value="${state}"]`);
  const focus = (/** @type {string} */ selector) => {
    const target = host.querySelector(selector);
    if (target instanceof HTMLElement) target.focus();
  };
  /** Show `state` in the picker and leave the form as it is. */
  const mark = (/** @type {State} */ state) => {
    const chosen = option(state);
    if (!(chosen instanceof HTMLElement)) return;
    quiet = true;
    picker.select(chosen);
    quiet = false;
  };

  /** Connecting ends: the note goes, the faded controls come back, and nothing typed is lost. */
  const connected = () => {
    host.querySelector(".link-control__note")?.remove();
    for (const faded of host.querySelectorAll("[disabled]")) faded.removeAttribute("disabled");
    drawn = "linked";
    mark("linked");
  };

  /** What a state does once drawn: open its chooser, or connect after a moment. */
  const settle = (/** @type {State} */ state) => {
    if (state === "chooser" || state === "empty") {
      const chain = host.querySelector("#link-author ~ .link-control__button");
      if (chain instanceof HTMLElement) chain.click();
    } else if (state === "connecting") pending = setTimeout(connected, CONNECTING_MS);
  };

  const draw = (/** @type {State} */ state) => {
    clearTimeout(pending);
    for (const listbox of mounted) listbox.destroy();
    drawn = state;
    host.innerHTML = form({ record, state });
    win?.alunaWindow?.setTitle(record === "existing" ? "Mistborn" : "New book");
    mounted = mountListboxes(host);
    settle(state);
  };

  const ask = () => {
    if (drawn !== "linked" && drawn !== "unmatched") draw("linked");
    host.insertAdjacentHTML("beforeend", QUESTION);
    focus("[data-link-keep]");
  };

  const show = (/** @type {State} */ state) => (state === "asking" ? ask() : draw(state));

  /** Move to `state` as a pick in the picker would. */
  const go = (/** @type {State} */ state) => {
    const chosen = option(state);
    if (picker.value === state || !(chosen instanceof HTMLElement)) show(state);
    else picker.select(chosen);
  };

  host.addEventListener("listbox:change", (event) => {
    const { target } = event;
    const { value } = /** @type {CustomEvent<{ value: string | null }>} */ (event).detail;
    if (!(target instanceof Element)) return;
    if (target.matches(".link-control") && target.querySelector("#link-author")) {
      go("connecting");
      focus("#link-author");
    } else if (target.matches(".linked-field") && drawn === "unmatched" && value !== null) {
      drawn = "linked";
      mark("linked");
    }
  });
  host.addEventListener("click", (event) => {
    const { target } = event;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-link-unlink]")) go("asking");
    else if (target.closest("[data-link-keep]")) {
      host.querySelector(".window__leaving")?.remove();
      mark(drawn);
      focus("[data-link-unlink]");
    } else if (target.closest("[data-link-disconnect]")) {
      go("plain");
      focus("#link-author ~ .link-control__button");
    }
  });

  onEveryPick(states, (state) => {
    if (!quiet) show(/** @type {State} */ (state));
  });
  wireStates(records, (picked) => {
    record = picked === "new" ? "new" : "existing";
    option("unmatched")?.setAttribute("aria-disabled", String(record === "new"));
    if (record === "new" && picker.value === "unmatched") go("linked");
    else show(/** @type {State} */ (picker.value ?? "plain"));
  });
}

const BOOKS = [
  ["Mistborn", "Brandon Sanderson", "Brandon Sanderson"],
  ["The Left Hand of Darkness", "Ursula K. Le Guin", "Ursula K. Le Guin"],
  ["A Wizard of Earthsea", "Ursula Le Guin", "Ursula K. Le Guin"],
  ["Kindred", "Octavia E. Butler", "Octavia E. Butler"],
  ["Good Omens", "Pratchett and Gaiman", "Terry Pratchett"],
];

const SOME = {
  notice: "45 books found their author. 5 still need you to pick one.",
  marked: [2, 4],
};

/**
 * How the matching went, in the prompt bar's words, and which books it left unmatched.
 *
 * @type {Record<string, { notice: string, marked: number[] }>}
 */
const OUTCOMES = {
  some: SOME,
  all: { notice: "All 50 books found their author.", marked: [] },
  none: {
    notice: "No book found its author yet. All 50 need you to pick one.",
    marked: [0, 1, 2, 3, 4],
  },
};

const MARK = `<span class="link-mark" role="img" aria-label="Pick the author">${svg(12, 2.6, BROKEN_PATHS)}</span>`;

/** @param {ParentNode} root */
function mountAfter(root) {
  const list = root.querySelector("[data-link-after]");
  const notice = root.querySelector("[data-link-notice]");
  if (!(list instanceof HTMLElement) || !(notice instanceof HTMLElement)) return;
  wireStates(root.querySelector("[data-link-outcomes]"), (outcome) => {
    const { notice: said, marked } = OUTCOMES[outcome] ?? SOME;
    notice.textContent = said;
    list.innerHTML = BOOKS.map(([title, typed, found], index) => {
      const unmatched = marked.includes(index);
      return `<button class="record" type="button"><span class="record__text"><b class="record__title">${title}</b><span class="record__detail">${unmatched ? typed : found}</span></span>${unmatched ? MARK : ""}</button>`;
    }).join("");
  });
}

/** @param {ParentNode} root */
export function mountLinkBench(root) {
  mountForm(root);
  mountAfter(root);
}
