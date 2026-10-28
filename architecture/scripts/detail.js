// @ts-check
/**
 * More on one part of the platform, in a second window beside the build, the way the developer
 * panel stands beside the desk. A link on a plate opens it with the matching `template[data-more]`;
 * its clay lamp, its Close button or Escape put it away, and the link gets the keyboard back. Its
 * leaf lamp widens it over the build.
 */

import { AlunaWindow } from "../../design/scripts/window/window.js";

/** @typedef {import("./controls.js").Closable} Closable */

/**
 * @param {Document} doc
 * @param {HTMLElement} el the window's element
 * @returns {Closable & { closeQuietly: () => void }}
 */
export function bindDetail(doc, el) {
  const win = new AlunaWindow(el, { title: "" });
  win.titleEl.id = "more-window-title";
  const page = doc.createElement("div");
  page.className = "more";
  page.tabIndex = -1;
  page.setAttribute("role", "region");
  page.setAttribute("aria-labelledby", win.titleEl.id);
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "btn btn--outline more__close";
  close.textContent = "Close";
  /** @type {HTMLElement | null} */
  let opener = null;

  const closeQuietly = () => {
    el.hidden = true;
    opener = null;
  };
  const shut = () => {
    const back = opener;
    closeQuietly();
    back?.focus({ preventScroll: true });
  };

  /** @param {HTMLElement} link */
  const open = (link) => {
    const template = doc.querySelector(`template[data-more="${link.dataset.moreOpen}"]`);
    if (!(template instanceof HTMLTemplateElement)) return;
    opener = link;
    win.setTitle(template.dataset.title ?? "");
    page.replaceChildren(template.content.cloneNode(true), close);
    win.body.replaceChildren(page);
    el.hidden = false;
    win.body.scrollTop = 0;
    page.focus({ preventScroll: true });
  };

  doc.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("[data-more-open]") : null;
    if (link instanceof HTMLElement) open(link);
  });
  close.addEventListener("click", shut);
  el.addEventListener("window:lamp", (event) => {
    const action = event instanceof CustomEvent ? event.detail?.action : null;
    if (action === "putaway") shut();
    if (action === "maximise") el.classList.toggle("is-maximised");
  });

  return { isOpen: () => !el.hidden, close: shut, closeQuietly };
}
