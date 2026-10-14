// @ts-check

/**
 * The Link control's chooser. The chain inside a single-line text
 * field is the drawn listbox's button, and its panel says what the field could come from: read whole
 * each time it opens, because those are other capabilities' fields and values, which move. A pick
 * writes the relation; the prompt bar says nothing on success and speaks only a refusal.
 */

import { watchArrivals } from "../core/dom-arrivals.js";
import { onCreateFinished } from "../core/shell-dom.js";
import { PROMPT_BAR_MESSAGE_EVENT, PROMPT_NOTICE_ID } from "../desk/prompt-bar.js";
import {
  ChoicePicker,
  closeOnPressOutside,
  MAX_PANEL_HEIGHT,
  watchPlacement,
} from "./choice-picker.js";

const CHOOSER_SELECTOR = "[data-link-control]";

/** What the bar says when the server could not be asked, or answered without a notice. */
export const CHOOSER_UNREAD = "I couldn’t open that list. Try again?";
export const PICK_UNWRITTEN = "I couldn’t connect that. Try again?";
/** A write whose connection was lost may have landed or not, and only a reload can say. */
export const PICK_UNKNOWN = "I can’t tell whether that connected. Reload the page to see.";

/** The refusal a notice carries, when the server sent one. */
const NOTICE_SELECTOR = '[data-role="error"][data-error-code]';
/** The refusals that mean this field's chain is finished: linked already, or no longer linkable. */
const CHAIN_GONE = new Set(["source_already_linked", "source_not_linkable"]);

/**
 * Per document: the pick being written for each field, so two copies of one field cannot both
 * send one, and the refusal a chooser said last.
 * @type {WeakMap<Document, { writing: Set<string>, standing: string | null }>}
 */
const pages = new WeakMap();

/** @param {Document} doc */
function pageOf(doc) {
  let page = pages.get(doc);
  if (!page) {
    page = { writing: new Set(), standing: null };
    pages.set(doc, page);
  }
  return page;
}

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
    this.button.addEventListener("keydown", (event) => {
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
    return this.button.contains(node) || this.panel.contains(node);
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
    if (this.open || writing) return;
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
    if (!press || writing.has(url)) return;
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
    const response = await fetch(url, { method: "POST", body: press }).catch(() => null);
    if (response === null) return this.refuse("", PICK_UNKNOWN, true);
    // A refusal's status already says nothing was written, whether or not its words arrive.
    if (!response.ok) return this.refuse(await bodyOf(response), PICK_UNWRITTEN, true);
    withdraw(doc);
    this.linked();
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
    const template = doc.createElement("template");
    template.innerHTML = body;
    const notice = template.content.querySelector(NOTICE_SELECTOR);
    if (picked || this.wanted) say(doc, notice?.textContent?.trim() || fallback);
    if (CHAIN_GONE.has(notice?.getAttribute("data-error-code") ?? "")) {
      const held = unwrapEverywhere(doc, this.root.dataset.linkUrl ?? "", doc.activeElement);
      held?.focus();
    }
    return null;
  }

  /**
   * The field is linked: the chain goes, and the text input stays until the field is drawn as
   * a dropdown. Focus returns to the input only if it was still on the chooser: a pick that waited
   * behind a build must not pull the person back from wherever they went meanwhile.
   */
  linked() {
    const { ownerDocument, dataset } = this.root;
    const active = ownerDocument.activeElement;
    const nowhere = active === null || active === ownerDocument.body;
    this.hide(false);
    const held = unwrapEverywhere(ownerDocument, dataset.linkUrl ?? "", active);
    (held ?? (nowhere ? this.shell.querySelector("input") : null))?.focus();
  }
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
 * @param {Document} doc
 * @param {string} sentence
 */
function say(doc, sentence) {
  pageOf(doc).standing = sentence;
  doc.dispatchEvent(
    new CustomEvent(PROMPT_BAR_MESSAGE_EVENT, { detail: { sentence, refused: true } }),
  );
}

/**
 * Take back the refusal a chooser said last, once a retry has worked, if the bar still says it:
 * "Try again?" left standing after the try worked is no longer true. Anything the bar says now in
 * its place, however it got there, stays.
 * @param {Document} doc
 */
function withdraw(doc) {
  const page = pageOf(doc);
  const standing = page.standing;
  page.standing = null;
  const slot = doc.getElementById(PROMPT_NOTICE_ID);
  if (standing === null || slot?.textContent?.trim() !== standing) return;
  doc.dispatchEvent(new CustomEvent(PROMPT_BAR_MESSAGE_EVENT, { detail: { sentence: "" } }));
}

/**
 * Every copy of a linked field's chain goes, this one and the others: the other form and each
 * record's Edit template were drawn before the link, and a press on their chain would be refused.
 *
 * @param {Document} doc
 * @param {string} url
 * @param {Element | null} [active] where focus stands, so a copy holding it can hand it on
 * @returns {HTMLElement | null} the input of the copy that held focus, which is where it goes now
 */
function unwrapEverywhere(doc, url, active = null) {
  /** @type {HTMLElement | null} */
  let held = null;
  const roots = [doc, ...[...doc.querySelectorAll("template")].map((template) => template.content)];
  for (const root of roots) {
    for (const wrapper of root.querySelectorAll(CHOOSER_SELECTOR)) {
      if (wrapper.getAttribute("data-link-url") !== url) continue;
      const input = wrapper.querySelector(".field__control input");
      if (active && wrapper.contains(active) && input instanceof HTMLElement) held = input;
      unwrap(wrapper);
    }
  }
  return held;
}

/**
 * A failed answer's words, or none when they never arrived.
 * @param {Response} response
 */
function bodyOf(response) {
  return response.text().catch(() => "");
}

/**
 * Put a field's plain shell where its chooser stood: the chain and the panel go with the wrapper.
 * @param {Element} wrapper
 */
function unwrap(wrapper) {
  const shell = wrapper.querySelector(".field__control");
  if (!shell) return;
  shell.querySelector(".link-control__button")?.remove();
  wrapper.replaceWith(shell);
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
    for (const node of nodes) mountLinkChoosers(node, open);
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
