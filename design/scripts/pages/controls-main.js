// @ts-check
/**
 * Bootstrap for the controls page.
 *
 * The sibling of `main.js`, and deliberately not the same file: the desk page
 * boots a window manager and three benches this page has no use for, and a
 * bootstrap that guards its way through half a page it is not on is a bootstrap
 * nobody trusts. What the two share — the section lamps, the ink system, the
 * window itself — they share by importing it.
 *
 * Every control on this page is the real one: the fields take text, the listboxes
 * open and search, the textarea grows. Uploads and the microphone run on stand-ins,
 * and a state picker walks a specimen to a state that cannot be reached by hand.
 */

import { mountListRows, wireListRows } from "../controls/list-rows.js";
import { mountListboxes } from "../controls/listbox.js";
import { OPEN_ICON, openRecordName } from "../controls/open-record.js";
import { dressGrounds } from "../desk/wallpaper.js";
import { mountAllInk, startInk } from "../ink/ink.js";
import { mountFileBench } from "../sections/file-bench.js";
import { mountLinkBench } from "../sections/link-bench.js";
import { mountRecorderBench, mountRecorderStates } from "../sections/recorder-bench.js";
import { wireSectionWindows } from "../sections/section-window.js";
import { swapStates, wireStates } from "../sections/state-picker.js";
import { mountWindows } from "../window/window.js";

/* ── The textarea, growing ──────────────────────────────────────────────────
 *
 * A textarea's own resize grip is three diagonal lines drawn by the operating
 * system in the bottom-right corner. It cannot be styled, it cannot be drawn,
 * and it is the only mark on this page that would not be ours. So the control
 * has no grip: it grows with what is typed until it reaches its ceiling, then
 * scrolls.
 *
 * That is also the better behaviour. Dragging a box to fit text you have
 * already written is work the box can do for you, and a field that is exactly
 * as tall as its content is a field you can read at a glance.
 *
 * The ink follows for free — `ink.js` watches every drawn element with a
 * ResizeObserver, so a field that grows is redrawn without this knowing the ink
 * system exists.
 */

/** @param {HTMLTextAreaElement} area */
function grow(area) {
  const max = Number(area.dataset.growMax ?? 0);
  area.style.height = "auto";
  const wanted = area.scrollHeight;
  const capped = max > 0 ? Math.min(wanted, max) : wanted;
  area.style.height = `${capped}px`;
  area.style.overflowY = capped < wanted ? "auto" : "hidden";
}

/**
 * Seed and wire every growing textarea.
 *
 * Sample text arrives as `data-sample` rather than as the element's content,
 * which looks like an affectation and is not: a textarea's content is
 * whitespace-significant, and an HTML formatter reflows it. Written inline, a
 * one-line sample comes back indented across two lines and fifty characters
 * longer — which the character counter below dutifully reports as being over
 * its limit before anyone has typed anything.
 *
 * @param {Document | Element} root
 */
function mountTextareas(root) {
  for (const area of root.querySelectorAll("textarea[data-grow]")) {
    if (!(area instanceof HTMLTextAreaElement)) continue;
    if (area.dataset.sample && area.value.trim() === "") area.value = area.dataset.sample;
    area.addEventListener("input", () => grow(area));
    grow(area);
  }
}

/* ── The counter ────────────────────────────────────────────────────────────
 *
 * A remaining-characters count, in the guidance slot under the field, because
 * that is where a field already says things about itself. It turns to signal
 * only once the limit is actually passed — a counter that is red for the last
 * twenty characters trains you to ignore it.
 */

/** @param {Document | Element} root */
function mountCounters(root) {
  for (const area of root.querySelectorAll("textarea[data-count-into]")) {
    if (!(area instanceof HTMLTextAreaElement)) continue;
    const selector = area.dataset.countInto;
    const out = selector ? root.querySelector(selector) : null;
    if (!(out instanceof HTMLElement)) continue;

    const limit = Number(area.dataset.countLimit ?? 0);
    const paint = () => {
      const left = limit - area.value.length;
      // "1 characters left" is wrong wherever it is drawn. The product's own copy of these words
      // is `public/fields/character-count.js`, which this bench cannot import, so a test pins the two.
      out.textContent =
        left >= 0 ? `${left} character${left === 1 ? "" : "s"} left` : `${-left} over the limit`;
      out.classList.toggle("is-over", left < 0);
    };
    area.addEventListener("input", paint);
    paint();
  }
}

/* ── The benches ────────────────────────────────────────────────────────────
 *
 * Each sets an attribute and asks the ink to redraw; nothing here knows what the
 * stylesheet does with it.
 */

/**
 * A pressed/unpressed pair of buttons, both of which say what they will do
 * rather than what state they are in.
 *
 * @param {HTMLElement} root
 * @param {string} selector the `[data-…]` control
 * @param {(on: boolean) => void} apply
 */
function toggleBench(root, selector, apply) {
  const button = root.querySelector(selector);
  if (!(button instanceof HTMLButtonElement)) return;
  button.addEventListener("click", () => {
    const on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    apply(on);
  });
}

/** @param {HTMLElement} root */
function mountBenches(root) {
  /* Every control at once, so a disabled row can be read as a row. */
  const states = root.querySelector("[data-state-bench]");
  toggleBench(root, "[data-disable-toggle]", (off) => {
    if (!(states instanceof HTMLElement)) return;
    for (const el of states.querySelectorAll("input, textarea, select, button")) {
      if (el instanceof HTMLElement && "disabled" in el) {
        /** @type {{ disabled: boolean }} */ (/** @type {unknown} */ (el)).disabled = off;
      }
    }
    states.classList.toggle("is-disabled", off);
  });
}

/* ── The chosen value, echoed ───────────────────────────────────────────────
 *
 * The listbox reports through a bubbling event rather than by being read, so
 * this is the whole of what a consumer has to write.
 */

/** @param {HTMLElement} root */
function mountEcho(root) {
  root.addEventListener("listbox:change", (event) => {
    const { detail, target } = /** @type {CustomEvent<{ value: string | null }>} */ (event);
    const echo = root.querySelector("[data-listbox-echo]");
    if (!(echo instanceof HTMLElement) || !(target instanceof Element)) return;
    if (target.contains(echo)) echo.textContent = detail.value ?? "nothing";
  });
}

/**
 * A name that matched no record keeps its line until a record is picked, as it
 * does on the desk.
 *
 * @param {HTMLElement} root
 */
function mountUnmatched(root) {
  root.addEventListener("listbox:change", (event) => {
    const { target } = event;
    if (!(target instanceof HTMLElement) || !target.matches("[data-listbox-unmatched]")) return;
    const input = target.querySelector('[role="combobox"]');
    const said = input?.getAttribute("aria-describedby");
    const line = said ? document.getElementById(said) : null;
    if (!line) return;
    line.hidden = true;
    /* A hidden line still named in the description would still be read out. */
    input?.removeAttribute("aria-describedby");
  });
}

/**
 * The open icon a live linked field draws on its first pick, before its list's panel.
 * @param {HTMLElement} field
 */
function drawOpener(field) {
  const opener = document.createElement("a");
  opener.className = "linked-field__open";
  opener.innerHTML = OPEN_ICON;
  field.querySelector(":scope > .listbox__panel")?.before(opener);
  return opener;
}

/**
 * The open icon in a live linked field follows its pick, as it does on the desk: a pick shows
 * it, naming the record picked, and an emptied field hides it with no address and no name. On
 * this page its address is the section that says what it does.
 *
 * @param {HTMLElement} root
 */
function mountOpeners(root) {
  root.addEventListener("listbox:change", (event) => {
    const { target } = event;
    if (!(target instanceof HTMLElement) || !target.matches(".linked-field")) return;
    const { label } = /** @type {CustomEvent<{ label: string }>} */ (event).detail;
    const found = target.querySelector(":scope > .linked-field__open");
    if (!(found instanceof HTMLElement) && label === "") return;
    const opener = found instanceof HTMLElement ? found : drawOpener(target);
    opener.hidden = label === "";
    if (label === "") {
      opener.removeAttribute("href");
      opener.removeAttribute("aria-label");
      return;
    }
    opener.setAttribute("href", "#link");
    opener.setAttribute("aria-label", openRecordName(label));
  });
}

/**
 * One kind of file at a time: the picker shows its group and hides the others.
 *
 * @param {ParentNode} root
 */
function mountFileKinds(root) {
  const groups = [...root.querySelectorAll("[data-file-group]")];
  wireStates(root.querySelector("[data-file-kinds]"), (kind) => {
    for (const group of groups) {
      if (group instanceof HTMLElement) group.hidden = group.dataset.fileGroup !== kind;
    }
  });
}

/* ── The question before leaving ───────────────────────────────────────────── */

/**
 * @param {string} body what the window holds
 * @param {string} said the question
 * @param {[string, string]} answers the one that changes nothing, then the one that leaves
 * @param {{ detail?: string, leaveKind?: string }} [destroys] set when leaving destroys something:
 *   the question leads in the display face, the line under it says what goes, and leaving is red
 */
function asking(body, said, [stay, leave], destroys) {
  const shown = document.createElement("div");
  const question = destroys
    ? `<h3 class="window__leaving-question" id="leaving-said" tabindex="-1">${said}</h3><p class="window__leaving-detail">${destroys.detail ?? ""}</p>`
    : `<p id="leaving-said">${said}</p>`;
  const leaveKind = destroys?.leaveKind ?? "btn--outline";
  const described = destroys ? "" : ' aria-describedby="leaving-said"';
  shown.innerHTML = `${body}<div class="window__leaving"><div class="window__leaving-panel">${question}<div class="window__leaving-actions"><button class="btn btn--warm" type="button"${described}>${stay}</button><button class="btn ${leaveKind}" type="button"${described}>${leave}</button></div></div></div>`;
  shown.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".window__leaving-actions .btn")) {
      shown.querySelector(".window__leaving")?.remove();
    }
  });
  return shown;
}

const LEAVING = {
  form: {
    title: "Expenses",
    body: '<div class="form" style="min-height: 15rem"><label class="field"><span class="field__label caps">Merchant</span><span class="field__control"><input class="field__input" type="text" value="Corner Café"></span></label><p class="field__label caps">Receipt</p><p class="sm">receipt-march.jpg · 2.4 MB</p></div>',
    said: "You have unsaved changes, are you sure you want to leave?",
    answers: /** @type {[string, string]} */ (["Keep editing", "Leave without saving"]),
  },
  run: {
    title: "Building…",
    body: '<div style="min-height: 15rem"><p class="sm">Setting up a place for your expenses.</p><p class="sm">Adding a field for the receipt.</p></div>',
    said: "If you leave now, I’ll stop making this. Nothing you already have will change.",
    answers: /** @type {[string, string]} */ (["Keep making it", "Stop and leave"]),
  },
  delete: {
    title: "Expenses",
    body: '<div class="collection" style="min-height: 15rem" inert><p class="collection__count caps">3 expenses</p><ul class="records records--feed"><li><button class="record" type="button"><span class="record__text"><span class="record__title">Corner Café</span><p class="record__detail">12 March · 4.80</p></span></button></li><li><button class="record" type="button"><span class="record__text"><span class="record__title">Night bus</span><p class="record__detail">9 March · 2.10</p></span></button></li><li><button class="record" type="button"><span class="record__text"><span class="record__title">Hardware store</span><p class="record__detail">2 March · 31.75</p></span></button></li></ul></div>',
    said: "Delete Expenses permanently?",
    answers: /** @type {[string, string]} */ (["Keep it", "Delete permanently"]),
    destroys: {
      detail: "Its 3 expenses go with it. You can’t undo this.",
      leaveKind: "btn--danger",
    },
  },
};

/**
 * One window and the question each kind of leaving asks over it. Picking a state asks it and puts
 * focus where the desk does, on the answer that changes nothing or on Delete's question; answering
 * takes the question away and hands focus back to the picker. Picking the state again asks again.
 *
 * @param {ParentNode} root
 */
function mountLeaving(root) {
  const host = root.querySelector("[data-leaving]");
  const picker = root.querySelector("[data-leaving-states]");
  const win = /** @type {{ alunaWindow?: { setTitle(title: string): void } } | null} */ (
    host?.closest("[data-window]") ?? null
  );
  host?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".window__leaving-actions"))
      return;
    const pressed = picker?.querySelector('[aria-pressed="true"]');
    if (pressed instanceof HTMLElement) pressed.focus();
  });
  picker?.addEventListener("click", () => {
    const first =
      host?.querySelector(".window__leaving-question") ??
      host?.querySelector(".window__leaving-actions .btn");
    if (first instanceof HTMLElement) first.focus();
  });
  swapStates(
    picker,
    host,
    Object.fromEntries(
      Object.entries(LEAVING).map(([state, entry]) => [
        state,
        () => {
          win?.alunaWindow?.setTitle(entry.title);
          return asking(
            entry.body,
            entry.said,
            entry.answers,
            "destroys" in entry ? entry.destroys : undefined,
          );
        },
      ]),
    ),
  );
}

function boot() {
  wireSectionWindows(mountWindows(document));
  dressGrounds();

  /* Before the page's own listboxes, so the Links bench mounts and keeps its state picker. */
  mountLinkBench(document);
  mountListboxes(document);
  /* The rows the repeatable list is typed into. Delegated, because a row added by a
     press has to behave the same as one that shipped in the markup. */
  mountListRows(document);
  wireListRows(document);
  mountTextareas(document);
  mountCounters(document);
  mountBenches(document.body);
  mountEcho(document.body);
  mountUnmatched(document.body);
  mountOpeners(document.body);
  mountRecorderBench(document.body);
  mountRecorderStates(document.body);
  mountFileBench(document.body);
  mountFileKinds(document);
  mountLeaving(document);

  /*
   * Last, once the document has stopped being rearranged — mounting a window
   * moves its contents into a body. From here the ink system watches the
   * document, so anything added later arrives drawn without being told.
   */
  startInk();

  /*
   * The listbox panels are `hidden` at boot, so they measure 0×0 and are not
   * worth drawing yet. They are mounted all the same, and the ResizeObserver
   * draws each one the first time it opens.
   */
  mountAllInk(document);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
