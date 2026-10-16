// @ts-check

/**
 * The Link control's chooser. The chain inside a single-line text field is the drawn listbox's
 * button, and its panel says what the field could come from: read whole each time it opens,
 * because those are other capabilities' fields and values, which move. A pick writes the
 * relation, and every copy of the field becomes a dropdown in place (`linked-field.js`) while the
 * names it held are matched (`link-matching.js`); the prompt bar then says how the matching went,
 * or why nothing was connected.
 */

import { watchArrivals } from "../core/dom-arrivals.js";
import { linkedCapabilityId, linkedRecordsUrl, linkUrlOfRecords } from "../core/routes.js";
import { onCreateFinished } from "../core/shell-dom.js";
import { refreshCommittedRecordsForMutation } from "../records/records-refresh.js";
import {
  ChoicePicker,
  closeOnPressOutside,
  MAX_PANEL_HEIGHT,
  watchPlacement,
} from "./choice-picker.js";
import { answerLines, fadeWhileMatching, holdWhileMatching } from "./link-matching.js";
import { bodyOf, CHOOSER_UNREAD, noticeIn, pageOf, report, say, withdraw } from "./link-notices.js";
import { CHAIN } from "./listbox-glyphs.js";

export { CHOOSER_UNREAD };

const CHOOSER_SELECTOR = "[data-link-control]";
const LINKED_SELECTOR = "[data-linked-field]";

/** Said on each copy of a field once it is unlinked, so the dropdown drawn in it lets go. */
export const FIELD_UNLINKED_EVENT = "aluna:field-unlinked";

export const PICK_UNWRITTEN = "I couldn’t connect that. Try again?";
/** A write whose connection was lost may have landed or not, and only a reload can say. */
export const PICK_UNKNOWN = "I can’t tell whether that connected. Reload the page to see.";

/**
 * The refusals that mean this field's chain is finished: it was linked meanwhile, so it becomes a
 * dropdown as a pick here would have made it, or it can no longer be linked and stays plain text.
 * @type {ReadonlyMap<string, "linked" | "plain">}
 */
const CHAIN_GONE = new Map([
  ["source_already_linked", "linked"],
  ["source_not_linkable", "plain"],
]);

/** One mounted chooser: the picker's keyboard and pointer, with a panel read on opening. */
export class LinkChooser extends ChoicePicker {
  /**
   * @param {HTMLElement} root the `[data-link-control]` wrapper
   * @param {Set<ChoicePicker>} open the panels standing open on this document
   */
  constructor(root, open) {
    super(root, open);
    const shell = root.querySelector(".field__control");
    if (!(shell instanceof HTMLElement)) throw new Error("A Link control needs its field's shell");
    this.shell = shell;
    /**
     * The chooser's heading, which arrives with the panel the first time it opens.
     * @type {HTMLElement | null}
     */
    this.head = null;
    /** A read in flight: it opens the panel when it lands unless it was let go first. */
    this.reading = false;
    this.wanted = false;
    this.control.addEventListener("keydown", (/** @type {KeyboardEvent} */ event) => {
      if (!this.open && (event.key === "Escape" || event.key === "Tab")) this.wanted = false;
    });
  }

  /** @override */
  get carries() {
    return false;
  }

  /**
   * The shell, as the design hangs it: a glyph button is too narrow to be what a list is under.
   * @override
   */
  controlBox() {
    return this.shell.getBoundingClientRect();
  }

  /**
   * The list keeps the listbox's own height, and the heading stands above it.
   * @override
   */
  get panelCap() {
    return MAX_PANEL_HEIGHT + (this.head?.offsetHeight ?? 0);
  }

  /**
   * A press in the field's own input closes the chooser: typing there is not choosing here.
   * @param {Node} node
   * @override
   */
  holds(node) {
    return this.control.contains(node) || this.panel.contains(node);
  }

  /**
   * Letting go while the panel is still being read keeps it from opening when the read lands.
   * @param {boolean} [refocus]
   * @override
   */
  hide(refocus = true) {
    this.wanted = false;
    this.openPickers.delete(this);
    super.hide(refocus);
  }

  /**
   * Opening reads the panel first. A refusal is said on the prompt bar and nothing opens. End asks
   * for the last option, which only the list just read can say.
   * @param {HTMLElement | null} [startAt] anything but `undefined` is End's request
   * @override
   */
  show(startAt) {
    // While its field's pick is being written there is nothing to choose: the chain stays shut.
    const writing = pageOf(this.root.ownerDocument).writing.has(this.root.dataset.linkUrl ?? "");
    if (this.open || writing || this.control.hasAttribute("disabled")) return;
    // Pressed again while a read it let go of is still out: that read opens it after all.
    if (this.reading) {
      this.wanted = true;
      this.openPickers.add(this);
      return;
    }
    this.reading = true;
    this.wanted = true;
    // Among the open ones while it reads, so a press elsewhere lets it go as it would close it.
    this.openPickers.add(this);
    this.read()
      .catch(() => this.refuse("", CHOOSER_UNREAD))
      .then((reveal) => {
        if (!reveal || !this.wanted || !this.root.isConnected) return;
        const last = [...this.scroll.querySelectorAll('[role="option"]')].at(-1);
        super.show(startAt !== undefined && last instanceof HTMLElement ? last : undefined);
        // The sentence back in, then the panel measured again with its line box in it.
        setTimeout(() => {
          reveal();
          if (this.open) this.anchor();
        }, 0);
      })
      .finally(() => {
        this.reading = false;
        if (!this.open) this.openPickers.delete(this);
      });
  }

  /**
   * Read the whole panel: its heading, then its list, or the sentence saying there is nothing.
   * @returns {Promise<(() => void) | null>} what to do once the panel shows, or null if none came
   */
  async read() {
    const url = `${this.root.dataset.linkUrl}?for=${encodeURIComponent(this.scroll.id)}`;
    const response = await fetch(url, { headers: { accept: "text/html" } }).catch(() => null);
    if (response === null) return this.refuse("", CHOOSER_UNREAD);
    if (!response.ok) return this.refuse(await bodyOf(response), CHOOSER_UNREAD);
    this.panel.innerHTML = await response.text();
    const scroll = this.panel.querySelector(".listbox__scroll");
    const head = this.panel.querySelector(".link-control__head");
    if (!(scroll instanceof HTMLElement) || !(head instanceof HTMLElement)) {
      return this.refuse("", CHOOSER_UNREAD);
    }
    this.scroll = scroll;
    this.head = head;
    // The picker hears its list scroll to tell a moving list from a moving hand; this list is new.
    scroll.addEventListener("scroll", () => {
      this.listMoved = true;
    });
    withdraw(this.root.ownerDocument);
    return emptySentence(this.panel);
  }

  /**
   * @param {HTMLElement | null} option
   * @override
   */
  select(option) {
    const press = option?.dataset.linkPress;
    const url = this.root.dataset.linkUrl ?? "";
    const { writing } = pageOf(this.root.ownerDocument);
    // A chain faded while another field's names are matched takes no pick from a panel left open.
    if (!press || writing.has(url) || this.control.hasAttribute("disabled")) return;
    writing.add(url);
    this.write(url, new URLSearchParams(press))
      .catch(() => this.refuse("", PICK_UNKNOWN, true))
      .finally(() => writing.delete(url));
  }

  /**
   * @param {string} url
   * @param {URLSearchParams} press
   */
  async write(url, press) {
    const doc = this.root.ownerDocument;
    const form = this.root.closest("form");
    const response = await fetch(url, { method: "POST", body: press }).catch(() => null);
    if (response === null) return this.refuse("", PICK_UNKNOWN, true);
    // A refusal's status already says nothing was written, whether or not its words arrive.
    if (!response.ok) return this.refuse(await bodyOf(response), PICK_UNWRITTEN, true);
    withdraw(doc);
    const line = answerLines(response);
    const note = await line();
    // An answer that opens on no note is none the route sends, and says nothing of what happened.
    if (typeof note?.note !== "string") return this.refuse("", PICK_UNKNOWN, true);
    for (const chooser of [...this.openPickers]) chooser.hide(false);
    this.linked();
    const release = holdWhileMatching(form, note.note, this.shell.querySelector("input"));
    const matched = await line();
    release();
    // The relation and its link rows are written together or not at all, and nothing said which.
    if (typeof matched?.report !== "string") return say(doc, PICK_UNKNOWN);
    if (matched.report !== "") report(doc, matched.report);
    // Written whole, so the press lets go of the field now: the broken chain that came back can
    // be pressed while the list is read again.
    void refreshMarks(doc, linkedCapabilityId(url));
  }

  /**
   * Say why nothing happened: the notice's own sentence, or `fallback` when the server sent none
   * or could not be asked. Said only to someone still waiting: an opening let go of says nothing.
   * A field that can take no new link gives up its chain, and focus stays in the field.
   *
   * @param {string} body
   * @param {string} fallback
   * @param {boolean} [picked] a pick is always answered, being a write the person asked for
   * @returns {null}
   */
  refuse(body, fallback, picked = false) {
    const doc = this.root.ownerDocument;
    const notice = noticeIn(doc, body);
    if (picked || this.wanted) say(doc, notice.sentence || fallback);
    const gone = CHAIN_GONE.get(notice.code);
    if (gone) {
      const held = replaceEverywhere(doc, this.root.dataset.linkUrl ?? "", gone, doc.activeElement);
      held?.focus();
    }
    return null;
  }

  /**
   * The field is linked, and every copy of it becomes a dropdown. Focus returns to the input only
   * if it was still on the chooser: a pick that waited behind a build must not pull the person
   * back from wherever they went meanwhile.
   */
  linked() {
    const { ownerDocument, dataset } = this.root;
    const active = ownerDocument.activeElement;
    const nowhere = active === null || active === ownerDocument.body;
    this.hide(false);
    const held = replaceEverywhere(ownerDocument, dataset.linkUrl ?? "", "linked", active);
    (held ?? (nowhere ? this.shell.querySelector("input") : null))?.focus();
  }
}

/**
 * Re-read the linked capability's records where its list is on the page, so each card carries the
 * mark its matching left, or none once it is unlinked, and a card that held focus holds it again.
 * A record that is open re-reads its list on the way out.
 *
 * @param {Document} doc
 * @param {string} capabilityId
 */
export async function refreshMarks(doc, capabilityId) {
  const create = [...doc.querySelectorAll("form[data-records-target-id]")].find(
    (form) => form.getAttribute("data-capability-id") === capabilityId,
  );
  if (!(create instanceof HTMLFormElement)) return;
  const region = doc.getElementById(create.getAttribute("data-records-target-id") ?? "");
  const focused = region?.contains(doc.activeElement) ? doc.activeElement?.id : "";
  const htmx = /** @type {Window & { htmx?: { process(node: Element): void } }} */ (doc.defaultView)
    ?.htmx;
  await refreshCommittedRecordsForMutation({
    form: create,
    process: (refreshed) => htmx?.process(refreshed),
  }).catch(() => null);
  // Only focus the refresh took: a person who went elsewhere meanwhile stays there.
  const free = doc.activeElement === null || doc.activeElement === doc.body;
  if (focused && free) doc.getElementById(focused)?.focus();
}

/**
 * The sentence saying there is nothing to pick, taken out and handed back to be put in again once
 * the panel shows: a live region filled in the turn it appeared is not one a reader is watching.
 * @param {HTMLElement} panel
 * @returns {() => void}
 */
function emptySentence(panel) {
  const slot = panel.querySelector(".listbox__empty");
  if (!slot) return () => {};
  const sentence = slot.textContent ?? "";
  slot.textContent = "";
  return () => {
    slot.textContent = sentence;
  };
}

/**
 * Every copy of a field's chain goes, this one and the others: the other form and each record's
 * Edit template were drawn before the link, and a press on their chain would be refused.
 *
 * @param {Document} doc
 * @param {string} url
 * @param {"linked" | "plain"} next what each copy becomes: a dropdown, or a plain text field
 * @param {Element | null} [active] where focus stands, so a copy holding it can hand it on
 * @returns {HTMLElement | null} the input of the copy that held focus, which is where it goes now
 */
function replaceEverywhere(doc, url, next, active = null) {
  /** @type {HTMLElement | null} */
  let held = null;
  const pickUrl = next === "linked" ? linkedRecordsUrl(url) : null;
  for (const wrapper of copiesOf(doc, CHOOSER_SELECTOR, "data-link-url", url)) {
    const input = wrapper.querySelector(".field__control input");
    if (active && wrapper.contains(active) && input instanceof HTMLElement) held = input;
    unwrap(doc, wrapper, pickUrl);
  }
  return held;
}

/**
 * Every copy of one field's wrapper, on the page and in every record's template: those `selector`
 * finds whose `attribute` names `url`.
 * @param {Document} doc
 * @param {string} selector
 * @param {string} attribute
 * @param {string} url
 */
function copiesOf(doc, selector, attribute, url) {
  const roots = [doc, ...[...doc.querySelectorAll("template")].map((template) => template.content)];
  return roots.flatMap((root) =>
    [...root.querySelectorAll(selector)].filter(
      (wrapper) => wrapper.getAttribute(attribute) === url,
    ),
  );
}

/**
 * The way back from `unwrap`: every copy of a linked field is the plain text field it was, with
 * its chain. Each dropdown drawn for it lets go of it, and a copy none was drawn in, a record's
 * template, gives up its wrapper. Focus that was on the broken chain, or nowhere after `pressed`,
 * moves to the chain that replaces it; focus in the field's input stays there.
 *
 * @param {Document} doc
 * @param {string} pickUrl the field's pick route, which its linked copies carry
 * @param {string} connect the chain's accessible name
 * @param {Element | null} [pressed] the broken chain pressed, which focus may have left meanwhile
 */
export function unlinkedEverywhere(doc, pickUrl, connect, pressed = null) {
  const url = linkUrlOfRecords(pickUrl);
  const anchor = focusIsNowhere(doc) ? pressed : doc.activeElement;
  const copies = copiesOf(doc, LINKED_SELECTOR, "data-pick-url", pickUrl).map((wrapper) => ({
    wrapper,
    shell: wrapper.querySelector(":scope > .field__control"),
  }));
  const holding = copies.find(({ wrapper }) => anchor !== null && wrapper.contains(anchor));
  for (const { wrapper } of copies) wrapper.dispatchEvent(new CustomEvent(FIELD_UNLINKED_EVENT));
  /** @type {HTMLElement | null} */
  let held = null;
  for (const copy of copies) {
    const chain = chainedAgain(doc, copy, url, connect);
    if (copy === holding) held = chain;
  }
  if (holding !== undefined && focusIsNowhere(doc))
    focusAfterUnlinking(anchor, holding.shell, held);
}

/**
 * Where focus goes in the copy that held it: the input is the field's own and comes back, so it
 * keeps focus; the broken chain does not, so the chain that replaced it takes focus, or the input
 * while names are matched and the chain is faded.
 *
 * @param {Element | null} anchor
 * @param {Element | null} shell
 * @param {HTMLElement | null} chain
 */
function focusAfterUnlinking(anchor, shell, chain) {
  if (anchor instanceof HTMLElement && anchor.isConnected) return anchor.focus();
  const faded = chain instanceof HTMLButtonElement && chain.disabled;
  const input = shell?.querySelector("input");
  (faded && input instanceof HTMLElement ? input : chain)?.focus();
}

/**
 * One copy of a linked field as the plain text field with its chain, its dropdown already let go,
 * faded at once if names are being matched.
 *
 * @param {Document} doc
 * @param {{ wrapper: Element, shell: Element | null }} copy
 * @param {string} url
 * @param {string} connect
 */
function chainedAgain(doc, { wrapper, shell }, url, connect) {
  if (!(shell instanceof HTMLElement)) return null;
  if (shell.parentNode === wrapper) wrapper.replaceWith(shell);
  const chain = chainAround(doc, shell, url, connect);
  fadeWhileMatching(chain);
  return chain;
}

/** Whether focus rests on nothing a person put it on: the page itself. */
export function focusIsNowhere(/** @type {Document} */ doc) {
  return doc.activeElement === null || doc.activeElement === doc.body;
}

/**
 * The chain and its chooser around a field's shell, as the server draws a field that can be
 * connected (`linkableShell`), so this control mounts on it as on any other.
 *
 * @param {Document} doc
 * @param {HTMLElement} shell
 * @param {string} url
 * @param {string} connect
 * @returns {HTMLElement} the chain
 */
function chainAround(doc, shell, url, connect) {
  const list = `${shell.querySelector("input")?.id ?? ""}-link-list`;
  const control = doc.createElement("div");
  control.className = "listbox link-control";
  control.setAttribute("data-link-control", "");
  control.setAttribute("data-link-url", url);
  const template = doc.createElement("template");
  template.innerHTML =
    `<button class="listbox__button link-control__button" type="button" aria-haspopup="listbox"` +
    ` aria-expanded="false">${CHAIN}<span class="listbox__value" hidden></span></button>`;
  const chain = /** @type {HTMLElement} */ (template.content.firstElementChild);
  chain.setAttribute("aria-label", connect);
  chain.setAttribute("aria-controls", list);
  const panel = doc.createElement("div");
  panel.className = "listbox__panel link-control__panel";
  panel.hidden = true;
  const scroll = doc.createElement("div");
  scroll.className = "listbox__scroll";
  scroll.id = list;
  panel.append(scroll);
  shell.append(chain);
  shell.replaceWith(control);
  control.append(shell, panel);
  return chain;
}

/**
 * Put a field's shell where its chooser stood: the chain and the panel go with the wrapper. A
 * linked field's shell goes into the wrapper `linked-field.js` draws its dropdown in, as the
 * server draws one.
 *
 * @param {Document} doc
 * @param {Element} wrapper
 * @param {string | null} pickUrl where the dropdown reads its records, when the field is linked
 */
function unwrap(doc, wrapper, pickUrl) {
  const shell = wrapper.querySelector(".field__control");
  if (!shell) return;
  shell.querySelector(".link-control__button")?.remove();
  if (pickUrl === null) return wrapper.replaceWith(shell);
  const linked = doc.createElement("div");
  linked.className = "listbox linked-field";
  linked.setAttribute("data-linked-field", "");
  linked.setAttribute("data-pick-url", pickUrl);
  linked.append(shell);
  wrapper.replaceWith(linked);
}

/**
 * Mount every chooser under `root` that is not already mounted.
 *
 * @param {Document | Element} root
 * @param {Set<ChoicePicker>} open
 * @returns {LinkChooser[]}
 */
export function mountLinkChoosers(root, open) {
  const found = [...root.querySelectorAll(CHOOSER_SELECTOR)];
  if (root instanceof Element && root.matches(CHOOSER_SELECTOR)) found.unshift(root);
  return found
    .filter((el) => el instanceof HTMLElement)
    .filter((el) => !el.dataset.linkChooserMounted)
    .map((el) => {
      const chooser = new LinkChooser(el, open);
      el.dataset.linkChooserMounted = "true";
      return chooser;
    });
}

/**
 * Wire the Link control onto a document. Forms arrive long after page load, by swap and by a
 * record template's clone, so mounting repeats on every arrival.
 *
 * @param {Document} root
 */
export function startLinkControls(root) {
  /** @type {Set<ChoicePicker>} */
  const open = new Set();
  const arrived = (/** @type {readonly (Document | Element)[]} */ nodes) => {
    for (const node of nodes) {
      mountLinkChoosers(node, open);
      fadeWhileMatching(node);
    }
  };
  arrived([root]);
  watchArrivals(root, arrived);
  watchPlacement(root, open);
  closeOnPressOutside(root, open);
  // A create form put down or saved takes its open chooser with it.
  onCreateFinished(root, (form) => {
    for (const chooser of [...open]) {
      if (chooser.root.closest("form") === form) chooser.hide(false);
    }
  });
}

if (typeof document !== "undefined") startLinkControls(document);
