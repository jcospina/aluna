// @ts-check

/**
 * Unlink: the broken chain inside a linked field asks once, over the window, as a form with
 * unsaved changes asks. On a yes the relation and every pick the field made go in one write. Every
 * copy of the field on the page is then the plain text field it was before, holding the text it
 * shows, with its chain back.
 */

import { linkedCapabilityId, linkUrlOfRecords, unlinkFieldUrl } from "../../core/routes.js";
import { PLACES_ITS_OWN_FOCUS } from "../../core/shell-dom.js";
import { askOverTheWindow } from "../../desk/leaving-a-run.js";
import { veilAsking } from "../../desk/leaving-unsaved-changes.js";
import { focusIsNowhere, refreshMarks, unlinkedEverywhere } from "../link-control.js";
import { fadeWhileMatching } from "../link-matching.js";
import { bodyOf, noticeIn, pageOf, say, UNLINKED, withdraw } from "../link-notices.js";

/** The question's two answers: the one focus lands on keeps the link. */
export const KEEP_CONNECTED = "Keep them connected";
export const DISCONNECT = "Disconnect";

export const UNLINK_UNWRITTEN = "I couldn’t disconnect that. Try again?";
/** A write whose connection was lost may have landed or not, and only a reload can say. */
export const UNLINK_UNKNOWN = "I can’t tell whether that disconnected. Reload the page to see.";

const LEAD_ID = "window-leaving-unlink-lead";
const DETAIL_ID = "window-leaving-unlink-detail";

/**
 * What the pick route says the broken chain asks, the accessible name of the chain that replaces
 * it, and the press it posts.
 *
 * @typedef {{ lead: string, detail: string, connect: string, press: Record<string, string> }} Unlinking
 */

/**
 * Ask over the window before unlinking the field `button` sits in, and unlink it on a yes. While a
 * write for the field is out, nothing is asked, and the bar says so.
 *
 * @param {HTMLElement} button the broken chain
 * @param {string} pickUrl the field's pick route, which names the field
 * @param {Unlinking} unlinking what the field's list said when it was read last
 * @param {() => unknown} reread reads the list again, for a press refused as stale to be made anew
 * @returns {boolean} whether it is being asked
 */
export function askToUnlink(button, pickUrl, unlinking, reread) {
  const doc = button.ownerDocument;
  if (pageOf(doc).writing.has(linkUrlOfRecords(pickUrl))) {
    say(doc, UNLINK_UNWRITTEN);
    return false;
  }
  const draw = veilAsking({
    lines: [
      { id: LEAD_ID, text: unlinking.lead, className: "window__leaving-lead" },
      { id: DETAIL_ID, text: unlinking.detail, className: "window__leaving-detail" },
    ],
    back: [KEEP_CONNECTED, "btn--outline"],
    go: [DISCONNECT, "btn--danger"],
  });
  const form = button.closest("form");
  const go = () => {
    // A read while the question stood found the field unlinked already and gave its chain back.
    if (button.isConnected) void unlink(doc, pickUrl, unlinking, reread, button);
    else chainIn(form, linkUrlOfRecords(pickUrl))?.focus();
    return PLACES_ITS_OWN_FOCUS;
  };
  return askOverTheWindow(button.closest(".window"), go, form ?? button, { draw, pressed: button });
}

/**
 * The chain `form` holds for the field at `url`, once it is plain text again.
 * @param {Element | null} form
 * @param {string} url
 * @returns {HTMLElement | null}
 */
function chainIn(form, url) {
  const control = [...(form?.querySelectorAll("[data-link-control]") ?? [])].find(
    (wrapper) => wrapper.getAttribute("data-link-url") === url,
  );
  const chain = control?.querySelector(".link-control__button");
  return chain instanceof HTMLElement ? chain : null;
}

/**
 * @param {Document} doc
 * @param {string} pickUrl
 * @param {Unlinking} unlinking
 * @param {() => unknown} reread
 * @param {HTMLElement} pressed the broken chain the question was asked from
 */
async function unlink(doc, pickUrl, unlinking, reread, pressed) {
  const linkUrl = linkUrlOfRecords(pickUrl);
  const { writing } = pageOf(doc);
  // A yes is always answered: one that cannot go out says so rather than closing on nothing.
  if (writing.has(linkUrl)) return say(doc, UNLINK_UNWRITTEN);
  writing.add(linkUrl);
  const giveBack = holdChains(doc, pickUrl, pressed);
  const answer = await written(doc, linkUrl, unlinking.press);
  writing.delete(linkUrl);
  giveBack();
  if (answer === null) return say(doc, UNLINK_UNKNOWN);
  if (answer.notice) say(doc, answer.notice.sentence || UNLINK_UNWRITTEN);
  else withdraw(doc);
  if (answer.notice && answer.notice.code !== UNLINKED) return void reread();
  unlinkedEverywhere(doc, pickUrl, answer.notice?.connect || unlinking.connect, pressed);
  await refreshMarks(doc, linkedCapabilityId(linkUrl));
}

/**
 * The press, posted: its refusal's notice, none once the field is unlinked, or null when the
 * connection was lost before an answer came.
 *
 * @param {Document} doc
 * @param {string} linkUrl
 * @param {Record<string, string>} press
 */
async function written(doc, linkUrl, press) {
  const body = new URLSearchParams(press);
  const response = await fetch(unlinkFieldUrl(linkUrl), { method: "POST", body }).catch(() => null);
  if (response === null) return null;
  return { notice: response.ok ? null : noticeIn(doc, await bodyOf(response)) };
}

/**
 * Hold every copy's broken chain still while the field's Unlink is out, so a second press cannot
 * ask again for nothing. What it returns gives back the chains it held that are still on the page,
 * and they fade again if names are being matched meanwhile. Focus the hold took off `pressed`
 * goes back to it, unless the person has gone elsewhere.
 *
 * @param {Document} doc
 * @param {string} pickUrl
 * @param {HTMLElement} pressed
 * @returns {() => void}
 */
function holdChains(doc, pickUrl, pressed) {
  const chains = [...doc.querySelectorAll("[data-linked-field]")]
    .filter((wrapper) => wrapper.getAttribute("data-pick-url") === pickUrl)
    .map((wrapper) => wrapper.querySelector(".linked-field__unlink"))
    .filter((chain) => chain instanceof HTMLButtonElement && !chain.disabled);
  for (const chain of chains) {
    if (!(chain instanceof HTMLButtonElement)) continue;
    chain.disabled = true;
  }
  return () => {
    for (const chain of chains) {
      if (!(chain instanceof HTMLButtonElement) || !chain.isConnected) continue;
      chain.disabled = false;
      fadeWhileMatching(chain);
    }
    if (focusIsNowhere(doc) && pressed instanceof HTMLButtonElement && !pressed.disabled) {
      pressed.focus();
    }
  };
}
