// @ts-check

/**
 * A linked field: a dropdown of the target's records,
 * searched by typing into the field itself. The server draws the field's own text input inside a
 * `[data-linked-field]` wrapper, and so does the Link control the moment a field is linked, which
 * is how a field becomes a dropdown in place. This draws the listbox around that input and reads
 * the records, with every sentence the field says, from the pick route. A pick fills the field with
 * the target's text, which posts as any text field's does, and posts the record's id beside it, so
 * the save remembers which record it was. An Edit form's field starts on the record it picked
 * before. Typing only searches, and leaving without a pick puts the text back.
 */

import { keyIsNotOurs } from "../../design/scripts/controls/listbox-search.js";
import { watchArrivals } from "../core/dom-arrivals.js";
import { linkUrlOfRecords } from "../core/routes.js";
import { matchKey, sameText } from "../core/same-text.js";
import {
  LINK_FIELD,
  linkFieldValue,
  NAMED_PICK_ATTRIBUTE,
  onCreateFinished,
  PICKED_RECORD_ATTRIBUTE,
} from "../core/shell-dom.js";
import { ChoicePicker, closeOnPressOutside, watchPlacement } from "./choice-picker.js";
import { FIELD_UNLINKED_EVENT, unlinkedEverywhere } from "./link-control.js";
import { fadeWhileMatching } from "./link-matching.js";
import {
  bodyOf,
  CHOOSER_UNREAD,
  NOT_LINKED,
  noticeIn,
  pageOf,
  say,
  UNLINKED,
  withdraw,
} from "./link-notices.js";
import { BROKEN_CHAIN, CHEVRON } from "./listbox-glyphs.js";
import { askToUnlink } from "./unlink/unlink-field.js";

const LINKED_SELECTOR = "[data-linked-field]";

/** What the input carries as a text field, and gives up while it only searches. */
const TEXT_ATTRIBUTES = [
  "name",
  "required",
  "maxlength",
  "data-length-limit",
  "data-length-counter",
  "aria-describedby",
];

/** What the input carries while it only searches. */
const SEARCH_ATTRIBUTES = [
  "role",
  "aria-autocomplete",
  "aria-expanded",
  "aria-controls",
  "aria-activedescendant",
  "aria-required",
  "aria-describedby",
  "autocomplete",
  "spellcheck",
  "placeholder",
];

/**
 * @typedef {{ id: string, text: string }} PickRecord
 * @typedef {import("./unlink/unlink-field.js").Unlinking} Unlinking
 * @typedef {{ placeholder: string, unmatched: string, disconnect: string, unlinking: Unlinking,
 *   records: PickRecord[] }} PickList
 */

/**
 * Draw the listbox around a linked field's input. The input becomes the search, a hidden carrier
 * posts the text under the field's name, and the broken chain, the chevron, the panel and the line
 * asking for a pick join it. The counter goes, since nothing is typed into the value.
 *
 * @param {HTMLElement} root the `[data-linked-field]` wrapper
 * @returns {() => void} what puts the plain text field back, should the link turn out to be gone
 */
export function drawDropdown(root) {
  const doc = root.ownerDocument;
  const shell = root.querySelector(".field__control");
  const input = shell?.querySelector("input");
  const field = root.closest(".field");
  if (!(shell instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !field) {
    throw new Error("A linked field needs its text input in a .field__control, inside a .field");
  }
  const kept = new Map(TEXT_ATTRIBUTES.map((name) => [name, input.getAttribute(name)]));
  const counter = field.querySelector(".field__guidance--count");
  const counterNext = counter?.nextElementSibling ?? null;
  const carrier = carrierFor(doc, input);
  const pick = doc.createElement("input");
  pick.setAttribute("type", "hidden");
  pick.setAttribute("name", LINK_FIELD);
  pick.value = linkFieldValue(input.getAttribute("name") ?? "", "");
  pick.setAttribute(NAMED_PICK_ATTRIBUTE, "");
  const line = lineFor(doc, input);
  root.dataset.choiceInitial = input.getAttribute("value") ?? "";
  searchFrom(input, counter?.id);
  shell.classList.add("field__control--select");
  shell.append(
    ...parts(doc, `<span class="linked-field__slot" aria-hidden="true"></span>${CHEVRON}`),
  );
  const unlink = `<button class="linked-field__unlink" type="button" disabled>${BROKEN_CHAIN}</button>`;
  root.append(carrier, pick, ...parts(doc, unlink), panelFor(doc, input, field));
  root.after(line);
  counter?.remove();

  const place = { field, counter, counterNext };
  return () => plainAgain({ root, shell, input, kept, carrier, line, place });
}

/**
 * Put the plain text field back where its dropdown was drawn: the input as it was, holding the
 * text the field holds now, and the counter where it stood, after the guidance slot.
 *
 * @param {{ root: HTMLElement, shell: HTMLElement, input: HTMLInputElement,
 *   kept: Map<string, string | null>, carrier: HTMLInputElement, line: HTMLElement,
 *   place: { field: Element, counter: Element | null, counterNext: Element | null } }} drawn
 */
function plainAgain({ root, shell, input, kept, carrier, line, place }) {
  // Moving the field takes focus off it, and the person may be typing there.
  const focused = input.ownerDocument.activeElement === input;
  for (const name of SEARCH_ATTRIBUTES) input.removeAttribute(name);
  for (const [name, value] of kept) if (value !== null) input.setAttribute(name, value);
  input.value = carrier.value;
  shell.classList.remove("field__control--select");
  for (const part of shell.querySelectorAll(".linked-field__slot, .listbox__chevron"))
    part.remove();
  line.remove();
  root.replaceWith(shell);
  if (focused) input.focus();
  const { field, counter, counterNext } = place;
  if (counter && counterNext?.parentElement === field) counterNext.before(counter);
  else if (counter) field.append(counter);
}

/**
 * Name the line under the field in what the field is described by while it shows, and only then:
 * a reader would announce a hidden line the description still names.
 *
 * @param {HTMLInputElement} input
 * @param {string} id
 * @param {boolean} shows
 */
function describedBy(input, id, shows) {
  const ids = (input.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter((one) => one !== "" && one !== id);
  if (shows) ids.push(id);
  if (ids.length > 0) input.setAttribute("aria-describedby", ids.join(" "));
  else input.removeAttribute("aria-describedby");
}

/**
 * The hidden input that posts the field's text, so what is typed into the search never does.
 * @param {Document} doc
 * @param {HTMLInputElement} input
 */
function carrierFor(doc, input) {
  const carrier = doc.createElement("input");
  carrier.setAttribute("type", "hidden");
  carrier.setAttribute("name", input.getAttribute("name") ?? "");
  carrier.value = input.value;
  carrier.setAttribute("data-choice-value", "");
  if (input.hasAttribute("required")) carrier.setAttribute("data-choice-required", "");
  return carrier;
}

/**
 * The line under the field asking for a pick, empty and hidden until the records say it should show.
 * @param {Document} doc
 * @param {HTMLInputElement} input
 */
function lineFor(doc, input) {
  const line = doc.createElement("p");
  line.className = "field__guidance";
  line.id = `${input.id}-unmatched`;
  line.hidden = true;
  return line;
}

/**
 * The panel the records are read into, its list named by the field's label.
 * @param {Document} doc
 * @param {HTMLInputElement} input
 * @param {Element} field
 */
function panelFor(doc, input, field) {
  const panel = doc.createElement("div");
  panel.className = "listbox__panel";
  panel.hidden = true;
  const list = doc.createElement("div");
  list.className = "listbox__scroll";
  list.id = `${input.id}-list`;
  list.setAttribute("role", "listbox");
  list.setAttribute("tabindex", "-1");
  const label = field.querySelector(".field__label");
  if (label && !label.id) label.id = `${input.id}-label`;
  if (label) list.setAttribute("aria-labelledby", label.id);
  panel.append(list);
  return panel;
}

/**
 * @param {HTMLInputElement} input
 * @param {string | undefined} counterId
 */
function searchFrom(input, counterId) {
  const required = input.hasAttribute("required");
  const described = (input.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter((id) => id !== "" && id !== counterId);
  for (const name of TEXT_ATTRIBUTES) input.removeAttribute(name);
  if (described.length > 0) input.setAttribute("aria-describedby", described.join(" "));
  if (required) input.setAttribute("aria-required", "true");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", `${input.id}-list`);
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
}

/**
 * @param {Document} doc
 * @param {string} html markup this module wrote, never anything read
 */
function parts(doc, html) {
  const template = doc.createElement("template");
  template.innerHTML = html;
  return [...template.content.children];
}

/** One mounted linked field: the picker's search and keyboard over the records it reads. */
export class LinkedDropdown extends ChoicePicker {
  /**
   * @param {HTMLElement} root the `[data-linked-field]` wrapper, already drawn
   * @param {Set<ChoicePicker>} open the panels standing open on this document
   * @param {() => void} undraw
   */
  constructor(root, open, undraw) {
    super(root, open);
    this.undraw = undraw;
    this.pickUrl = root.dataset.pickUrl ?? "";
    const pick = root.querySelector(`input[name="${LINK_FIELD}"]`);
    if (!(pick instanceof HTMLInputElement)) throw new Error("A linked field posts its pick");
    /** What posts the record the field picked, or no record while it picks none. */
    this.pick = pick;
    /** The record the field picked when it was drawn, which putting it back picks again. */
    this.pickedInitially = root.getAttribute(PICKED_RECORD_ATTRIBUTE) ?? "";
    this.picked = this.pickedInitially;
    const line = root.nextElementSibling;
    /** The line under the field asking for a pick. */
    this.line = line instanceof HTMLElement && line.id.endsWith("-unmatched") ? line : null;
    const unlink = root.querySelector(".linked-field__unlink");
    /** The broken chain, which can be pressed once the records say what it asks and posts. */
    this.unlink = unlink instanceof HTMLButtonElement ? unlink : null;
    /** @type {Unlinking | null} */
    this.unlinking = null;
    /** Whether the records have been read, and so whether the field's text names one of them. */
    this.loaded = false;
    /** @type {Promise<void> | null} */
    this.reading = null;
    /** An opening waiting on the records' first read, which a press elsewhere lets go of. */
    this.wanted = false;
    /** Whether the bar says a refusal this field said, for a read that works to take back. */
    this.said = false;
    /** Whether the field is plain text again, and this answers for it no longer. */
    this.retired = false;
    // Escape while the first read is out lets go of the opening it was waiting to make. Tab
    // leaves the field, which `leave()` answers as it answers any other way out.
    const letGo = (/** @type {KeyboardEvent} */ event) => {
      if (this.open || keyIsNotOurs(event)) return;
      if (event.key === "Escape") this.hide(false);
    };
    this.control.addEventListener("keydown", letGo, { signal: this.wiring.signal });
    this.unlink?.addEventListener("click", () => this.askToUnlink(), {
      signal: this.wiring.signal,
    });
    // Unlinked from this copy or another, the field is plain text again, its chain back.
    root.addEventListener(FIELD_UNLINKED_EVENT, () => this.becomePlain(), {
      signal: this.wiring.signal,
    });
    // A refused save reads the list again: a pick whose record went is then one the field's text
    // no longer names, and the next save does not post it again.
    root.closest("form")?.addEventListener(
      "htmx:afterRequest",
      (event) => {
        const answer = /** @type {CustomEvent<{ xhr?: XMLHttpRequest }>} */ (event).detail;
        if ((answer?.xhr?.status ?? 0) >= 400) this.read();
      },
      { signal: this.wiring.signal },
    );
    this.mark();
    this.read();
  }

  /**
   * The field's text, which is what it posts, whether or not a record holds it.
   * @override
   */
  get value() {
    return this.field?.value ?? null;
  }

  /** @override */
  shownLabel() {
    return this.field?.value ?? "";
  }

  /**
   * A record, which another holding the same text is not.
   * @param {HTMLElement} option
   * @override
   */
  identity(option) {
    return option.dataset.record;
  }

  /** @returns {HTMLElement[]} */
  options() {
    return [...this.scroll.querySelectorAll('[role="option"]')].filter(
      (option) => option instanceof HTMLElement,
    );
  }

  /**
   * A pick fills the field with the record's text, and says so as any field's change does.
   * @param {HTMLElement | null} option
   * @override
   */
  select(option) {
    if (!option || !this.field) return;
    const text = option.dataset.value ?? "";
    const changed = text !== this.field.value || option.dataset.record !== this.picked;
    this.field.value = text;
    this.picked = option.dataset.record ?? "";
    this.mark();
    this.paint();
    if (changed) this.field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /** @override */
  clear() {
    if (!this.field) return;
    const changed = this.field.value !== "";
    this.field.value = "";
    this.picked = "";
    this.mark();
    this.paint();
    if (changed) this.field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /** @override */
  restore() {
    if (this.retired) return;
    if (this.field) this.field.value = this.root.dataset.choiceInitial ?? "";
    this.picked = this.pickedInitially;
    super.restore();
    this.mark();
  }

  /**
   * The record the field picked, or else the one record its text names, chosen in the list; the
   * line asking for a pick under text that names none, or names several; and the pick the save
   * posts, which is the named record, as the matching scan links it. Nothing is said before the
   * records are read.
   */
  mark() {
    const text = this.field?.value ?? "";
    const spoken = this.namedBy(text);
    const named = this.picked === "" ? spoken : this.recordOption(this.picked);
    this.post(this.picked === "" ? (spoken?.dataset.record ?? "") : this.picked, spoken);
    for (const option of this.options()) {
      option.setAttribute("aria-selected", String(option === named));
    }
    if (!this.line || !this.input) return;
    const shows = this.loaded && matchKey(text) !== "" && !named;
    this.line.hidden = !shows;
    describedBy(this.input, this.line.id, shows);
  }

  /**
   * Post `record` as the field's pick, or the marker with no record, which tells the save the form
   * drew the field linked. The record the form was drawn on, and the one the text names, post
   * whether or not they are pressed and however late the list arrives, so neither is a change of
   * the person's, and neither is posting no record.
   *
   * @param {string} record
   * @param {HTMLElement | undefined} spoken the option the field's text names
   */
  post(record, spoken) {
    this.pick.value = linkFieldValue(this.field?.getAttribute("name") ?? "", record);
    // What the form posts untouched: the record it was drawn on, else the one its text names.
    const standing = record === "" || record === (this.pickedInitially || spoken?.dataset.record);
    if (standing) this.pick.setAttribute(NAMED_PICK_ATTRIBUTE, "");
    else this.pick.removeAttribute(NAMED_PICK_ATTRIBUTE);
  }

  /**
   * The one record `text` names. Text two records share names neither, as the matching scan links
   * neither, and text with nothing in it to match names none.
   *
   * @param {string} text
   */
  namedBy(text) {
    if (matchKey(text) === "") return undefined;
    const matching = this.options().filter((option) => sameText(option.dataset.value ?? "", text));
    return matching.length === 1 ? matching[0] : undefined;
  }

  /** @param {string} record */
  recordOption(record) {
    return this.options().find((option) => option.dataset.record === record);
  }

  /**
   * Opening reads the records again, as the desk is now. The first opening waits for them; later
   * ones show what was read last and take the new list in when it lands.
   * @param {HTMLElement | null} [startAt]
   * @override
   */
  show(startAt) {
    if (this.open || this.retired) return;
    const reading = this.read();
    if (this.loaded) return super.show(startAt);
    this.wanted = true;
    this.openPickers.add(this);
    reading.then(() => {
      if (this.wanted && this.loaded && !this.open && this.root.isConnected)
        this.showTyped(startAt);
      if (!this.open) this.openPickers.delete(this);
    });
  }

  /**
   * Open on what was typed while the records were still being read.
   * @param {HTMLElement | null} [startAt]
   */
  showTyped(startAt) {
    super.show(startAt);
    if (!this.input || this.input.value === this.shownLabel()) return;
    this.query = this.input.value;
    this.relist();
  }

  /**
   * @param {boolean} [refocus]
   * @override
   */
  hide(refocus = true) {
    this.wanted = false;
    if (!this.open) this.openPickers.delete(this);
    super.hide(refocus);
  }

  /** One read at a time: an opening while one is out shares its answer. */
  read() {
    if (this.retired) return Promise.resolve();
    this.reading ??= this.fetchList().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  async fetchList() {
    const request = { headers: { accept: "application/json" } };
    const response = await fetch(this.pickUrl, request).catch(() => null);
    if (response === null) return this.refuse("");
    if (!response.ok) return this.refuse(await bodyOf(response));
    const list = await response.json().catch(() => null);
    if (!isPickList(list)) return this.refuse("");
    if (this.retired) return;
    this.fill(list);
    if (this.said) withdraw(this.root.ownerDocument);
    this.said = false;
  }

  /**
   * A refused read is said only to someone waiting to open the list. A field whose link is gone
   * is plain text again, so it can be typed into.
   * @param {string} body
   */
  refuse(body) {
    // A field taken off the page meanwhile has nothing left to say or to draw plain.
    if (this.retired || !this.root.isConnected) return;
    const doc = this.root.ownerDocument;
    const notice = noticeIn(doc, body);
    const linking = this.readOnceLinked(notice);
    if (linking) return linking;
    // A list standing open keeps what it read last, so only one that goes for good says why.
    const gone = notice.code === NOT_LINKED || notice.code === UNLINKED;
    const waiting = this.wanted || (gone && this.open);
    if (gone) this.unlinked(notice);
    if (!waiting) return;
    this.said = true;
    say(doc, notice.sentence || CHOOSER_UNREAD);
  }

  /**
   * A list read while this page was still linking the field is read again once the press lets go
   * of it: the press's note comes before its relation lands, so a read in between finds none. The
   * read in flight stands until then, so an opening waiting on it opens on the list.
   * @param {{ code: string }} notice
   * @returns {Promise<void> | null}
   */
  readOnceLinked(notice) {
    const { writing } = pageOf(this.root.ownerDocument);
    const url = linkUrlOfRecords(this.pickUrl);
    if (notice.code !== UNLINKED || !writing.has(url)) return null;
    return writing.letGo(url).then(() => (this.retired ? undefined : this.fetchList()));
  }

  /**
   * The field is no dropdown: plain text, and when it holds no relation at all, unlinked from
   * another tab, every copy of it takes its chain back.
   * @param {{ code: string, connect: string }} notice
   */
  unlinked(notice) {
    const connect = notice.connect || this.unlinking?.connect || "";
    if (notice.code !== UNLINKED || connect === "") return this.becomePlain();
    unlinkedEverywhere(this.root.ownerDocument, this.pickUrl, connect);
  }

  /** The field is plain text again: this lets go of it, every listener with it, and undraws. */
  becomePlain() {
    if (this.retired) return;
    this.retired = true;
    this.retire();
    this.undraw();
  }

  /** The broken chain closes the list, then asks before it unlinks the field. */
  askToUnlink() {
    if (this.retired || !this.unlink || this.unlink.disabled || !this.unlinking) return;
    this.hide(false);
    askToUnlink(this.unlink, this.pickUrl, this.unlinking, () => this.read());
  }

  /** @param {PickList} list */
  fill(list) {
    const doc = this.root.ownerDocument;
    // The row the keyboard is on, so a list read while it stood open keeps it where it was.
    const keep = this.open && this.active ? this.identity(this.active) : undefined;
    this.input?.setAttribute("placeholder", list.placeholder);
    if (this.line) this.line.textContent = list.unmatched;
    this.unlinking = list.unlinking;
    if (this.unlink) {
      this.unlink.setAttribute("aria-label", list.disconnect);
      // Held still until the list gives it a name and a press; it then fades only while names are
      // being matched.
      if (!this.loaded) this.unlink.disabled = false;
      fadeWhileMatching(this.unlink);
    }
    const prefix = this.scroll.id;
    this.scroll.replaceChildren(
      ...list.records.map((record, index) => {
        const option = doc.createElement("div");
        option.className = "listbox__option";
        option.id = `${prefix}-option-${index + 1}`;
        option.setAttribute("role", "option");
        option.dataset.value = record.text;
        option.dataset.record = record.id;
        option.textContent = record.text;
        return option;
      }),
    );
    this.loaded = true;
    this.mark();
    this.relist(keep);
  }
}

/** @param {unknown} list @returns {list is PickList} */
function isPickList(list) {
  if (typeof list !== "object" || list === null) return false;
  const { placeholder, unmatched, disconnect, unlinking, records } =
    /** @type {Record<string, unknown>} */ (list);
  return (
    [placeholder, unmatched, disconnect].every((words) => typeof words === "string") &&
    isUnlinking(unlinking) &&
    Array.isArray(records) &&
    records.every(
      (record) =>
        typeof record === "object" &&
        record !== null &&
        typeof record.id === "string" &&
        typeof record.text === "string",
    )
  );
}

/** @param {unknown} unlinking @returns {unlinking is Unlinking} */
function isUnlinking(unlinking) {
  if (typeof unlinking !== "object" || unlinking === null) return false;
  const { lead, detail, connect, press } = /** @type {Record<string, unknown>} */ (unlinking);
  return (
    [lead, detail, connect].every((words) => typeof words === "string") &&
    typeof press === "object" &&
    press !== null &&
    Object.values(press).every((value) => typeof value === "string")
  );
}

/**
 * Mount every linked field under `root` that is not already mounted.
 *
 * @param {Document | Element} root
 * @param {Set<ChoicePicker>} open
 * @returns {LinkedDropdown[]}
 */
export function mountLinkedFields(root, open) {
  const found = [...root.querySelectorAll(LINKED_SELECTOR)];
  if (root instanceof Element && root.matches(LINKED_SELECTOR)) found.unshift(root);
  return found
    .filter((el) => el instanceof HTMLElement)
    .filter((el) => !el.dataset.linkedFieldMounted)
    .map((el) => {
      const dropdown = new LinkedDropdown(el, open, drawDropdown(el));
      el.dataset.linkedFieldMounted = "true";
      return dropdown;
    });
}

/**
 * Wire linked fields onto a document. Forms arrive long after page load, by swap, by a record
 * template's clone, and by a field linked in place, so mounting repeats on every arrival.
 *
 * @param {Document} root
 */
export function startLinkedFields(root) {
  /** @type {Set<ChoicePicker>} */
  const open = new Set();
  /** @type {LinkedDropdown[]} */
  const mounted = [];
  // A dropdown whose form was swapped away is closed on the way out, which lets its subtree go.
  const prune = () => {
    for (let index = mounted.length - 1; index >= 0; index--) {
      const dropdown = mounted[index];
      if (dropdown?.root.isConnected) continue;
      dropdown?.hide(false);
      mounted.splice(index, 1);
    }
  };
  const arrived = (/** @type {readonly (Document | Element)[]} */ nodes) => {
    prune();
    // A field that refuses says so after every field beside it has its script.
    /** @type {unknown} */
    let refusal;
    for (const node of nodes) {
      try {
        mounted.push(...mountLinkedFields(node, open));
      } catch (error) {
        refusal ??= error;
      }
    }
    if (refusal !== undefined) throw refusal;
  };
  arrived([root]);
  watchArrivals(root, arrived);
  watchPlacement(root, open);
  closeOnPressOutside(root, open);
  // A create form put down or saved takes its open dropdown with it, and its text back.
  onCreateFinished(root, (form) => {
    for (const dropdown of mounted) if (dropdown.root.closest("form") === form) dropdown.restore();
  });
}

if (typeof document !== "undefined") startLinkedFields(document);
