// @ts-check

/**
 * What the Link control and a linked field say on the prompt bar: a refusal, taken back once a
 * retry works so "Try again?" never stands after the try has worked, and how a link's matching went.
 */

import { PROMPT_BAR_MESSAGE_EVENT, PROMPT_NOTICE_ID } from "../desk/prompt-bar.js";

/** What the bar says when a list could not be read, or was refused without a notice. */
export const CHOOSER_UNREAD = "I couldn’t open that list. Try again?";

/** The refusal of a field holding no relation that still holds: it is plain text again. */
export const NOT_LINKED = "field_not_linked";
/** The refusal of a field holding no relation at all, which takes its chain back. */
export const UNLINKED = "field_unlinked";

/** The refusal a notice carries, when the server sent one. */
const NOTICE_SELECTOR = '[data-role="error"][data-error-code]';

/** The fields a press is being written for, by Link control address, and who waits on each. */
class Writing extends Set {
  /** @type {Map<string, (() => void)[]>} */
  waiting = new Map();

  /**
   * @param {string} url
   * @override
   */
  delete(url) {
    const had = super.delete(url);
    for (const resume of this.waiting.get(url) ?? []) resume();
    this.waiting.delete(url);
    return had;
  }

  /**
   * Once the press written for `url` lets go of its field, or now when none is.
   * @param {string} url
   * @returns {Promise<void>}
   */
  letGo(url) {
    if (!this.has(url)) return Promise.resolve();
    return new Promise((resume) =>
      this.waiting.set(url, [...(this.waiting.get(url) ?? []), resume]),
    );
  }
}

/**
 * Per document: the pick being written for each field, so two copies of one field cannot both
 * send one, and the refusal said last.
 * @type {WeakMap<Document, { writing: Writing, standing: string | null }>}
 */
const pages = new WeakMap();

/** @param {Document} doc */
export function pageOf(doc) {
  let page = pages.get(doc);
  if (!page) {
    page = { writing: new Writing(), standing: null };
    pages.set(doc, page);
  }
  return page;
}

/**
 * The refusal in a failed answer's body: its code and its sentence, either empty when none came,
 * and the name of the chain a field that takes it back carries.
 * @param {Document} doc
 * @param {string} body
 */
export function noticeIn(doc, body) {
  const template = doc.createElement("template");
  template.innerHTML = body;
  const notice = template.content.querySelector(NOTICE_SELECTOR);
  return {
    code: notice?.getAttribute("data-error-code") ?? "",
    sentence: notice?.textContent?.trim() ?? "",
    connect: notice?.getAttribute("data-connect-name") ?? "",
  };
}

/**
 * A failed answer's words, or none when they never arrived.
 * @param {Response} response
 */
export function bodyOf(response) {
  return response.text().catch(() => "");
}

/**
 * @param {Document} doc
 * @param {string} sentence
 */
export function say(doc, sentence) {
  pageOf(doc).standing = sentence;
  doc.dispatchEvent(
    new CustomEvent(PROMPT_BAR_MESSAGE_EVENT, { detail: { sentence, refused: true } }),
  );
}

/**
 * Say how something went, with no refusal's cue.
 * @param {Document} doc
 * @param {string} sentence
 */
export function report(doc, sentence) {
  doc.dispatchEvent(
    new CustomEvent(PROMPT_BAR_MESSAGE_EVENT, { detail: { sentence, refused: false } }),
  );
}

/**
 * Take back the refusal said last, once a retry has worked, if the bar still says it. Anything the
 * bar says now in its place, however it got there, stays.
 * @param {Document} doc
 */
export function withdraw(doc) {
  const page = pageOf(doc);
  const standing = page.standing;
  page.standing = null;
  const slot = doc.getElementById(PROMPT_NOTICE_ID);
  if (standing === null || slot?.textContent?.trim() !== standing) return;
  doc.dispatchEvent(new CustomEvent(PROMPT_BAR_MESSAGE_EVENT, { detail: { sentence: "" } }));
}
