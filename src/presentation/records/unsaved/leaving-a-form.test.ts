// Which presses are exits that take a form out of the window (`public/desk/leaving-a-form.js`),
// and the question itself (`public/desk/leaving-unsaved-changes.js`), each run on a parsed desk
// with what counts as unsaved handed in.

import { afterAll, describe, expect, test } from "bun:test";
import { PROMPT_FIELD_ID, WINDOW_CONTENT_ID } from "#shell/core/shell-dom.js";
import { exitPressed, holdExit, promptExit } from "#shell/desk/leaving-a-form.js";
import {
  askBeforeLeaving,
  backOutOfLeaving,
  leavingIsBeingAsked,
  RUN_ID_ATTRIBUTE,
} from "#shell/desk/leaving-a-run.js";
import {
  LEAVING_UNSAVED_QUESTION,
  UNSAVED_LEAVING_SELECTOR,
  unsavedQuestionIn,
} from "#shell/desk/leaving-unsaved-changes.js";
import { PROMPT_FORM_ID } from "#shell/desk/prompt-bar.js";
import { startUnsavedChanges } from "#shell/records/unsaved-changes.js";
import { installDomGlobals } from "../../controls/double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import { windowWithRun } from "../../motion/leaving-a-run.test-support.ts";

installDomGlobals();
const had = Reflect.getOwnPropertyDescriptor(globalThis, "document");
afterAll(() => {
  if (had) Object.defineProperty(globalThis, "document", had);
  else Reflect.deleteProperty(globalThis, "document");
});

/** A desk with its window standing, a record in it, a logo's Delete and the prompt bar. */
function desk(prompt = "") {
  const doc = new Doc();
  parseHtml(
    `<section class="window"><div class="window__body"><div id="${WINDOW_CONTENT_ID}">` +
      `<div class="capability-collection__create"><form><button data-create-cancel>Cancel</button></form></div>` +
      `<button class="capability-item" data-record-view-template="record-1">Dawn</button>` +
      `<article class="capability-item">Dusk</article></div></div></section>` +
      `<button data-window-doorway data-capability-id="photos">Delete</button>` +
      `<form id="${PROMPT_FORM_ID}"><input id="${PROMPT_FIELD_ID}" value="${prompt}"><button>Make it</button></form>`,
    doc,
  );
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  const find = (selector: string) => doc.querySelector(selector) as El;
  return { doc, find, win: find(".window") };
}

describe("a press that takes the form out of the window", () => {
  test("is the create panel's Cancel, which takes only that panel", () => {
    const { doc, find } = desk();
    const exit = exitPressed(find("[data-create-cancel]") as never, doc as never);
    expect(exit?.scope).toBe(find(".capability-collection__create"));
  });

  test("is another record, or Delete on a logo's menu, which take the whole window", () => {
    const { doc, find, win } = desk();
    for (const pressed of [find(".capability-item"), find("[data-window-doorway]")]) {
      expect(exitPressed(pressed as never, doc as never)?.scope).toBe(win);
    }
  });

  test("is not a card that opens nothing, for a capability whose records cannot be changed", () => {
    const { doc, find } = desk();
    expect(exitPressed(find("article") as never, doc as never)).toBeNull();
  });

  test("is nothing when no window stands, or for a close outside it", () => {
    const { doc, find } = desk();
    const elsewhere = new Doc();
    parseHtml("<button data-record-back>Back</button>", elsewhere);
    expect(exitPressed(elsewhere.querySelector("button") as never, doc as never)).toBeNull();
    find(".window").remove();
    expect(exitPressed(find("[data-window-doorway]") as never, doc as never)).toBeNull();
  });

  test("from the desk is left to the prompt bar to refuse while a run holds the window", () => {
    const { el } = windowWithRun([]);
    const nothingUnsaved = { querySelectorAll: () => [], getAttribute: () => null };
    const exit = { el: el as never, scope: nothingUnsaved as never, again: () => {}, desk: true };
    expect(holdExit(exit)).toBe(false);
    expect(leavingIsBeingAsked()).toBe(false);
  });

  test("from the form asks the run's question while the run is still working out its sentence", () => {
    const { run, el, warning } = windowWithRun([]);
    expect(holdExit({ el: el as never, scope: run as never, again: () => {} })).toBe(true);
    expect(warning.hidden).toBe(false);
    backOutOfLeaving();
  });

  test("from the form cannot happen once the run has drawn, since the form is hidden", () => {
    const { run, el } = windowWithRun([], { committed: true });
    expect(holdExit({ el: el as never, scope: run as never, again: () => {} })).toBe(false);
  });
});

describe("a prompt about to be sent", () => {
  test("is an exit that sends itself again with the same button", () => {
    const { doc, find } = desk("make a reading list");
    const form = find(`#${PROMPT_FORM_ID}`) as El & { requestSubmit?: (by?: unknown) => void };
    const by: unknown[] = [];
    form.requestSubmit = (submitter) => by.push(submitter);
    const exit = promptExit(form as never, find("button"), doc as never);
    exit?.again();
    expect(by).toEqual([find("button")]);
  });

  test("asks only consent, and the sentence it sends again is not asked about twice", () => {
    const { doc, find } = desk("make a reading list");
    const form = find(`#${PROMPT_FORM_ID}`) as El & { requestSubmit?: (by?: unknown) => void };
    const asked: unknown[] = [];
    form.requestSubmit = () => asked.push(promptExit(form as never, null, doc as never));
    const exit = promptExit(form as never, null, doc as never);
    expect(exit?.keep).toBe(true);
    exit?.again();
    expect(asked).toEqual([null]);
  });

  test("is not one while a run the prompt bar refuses for holds the window", () => {
    const { doc, find } = desk("make a reading list");
    parseHtml(`<section ${RUN_ID_ATTRIBUTE}="build-7"></section>`, find(`#${WINDOW_CONTENT_ID}`));
    expect(promptExit(find(`#${PROMPT_FORM_ID}`) as never, null, doc as never)).toBeNull();
  });

  test("is not one when it is blank, which the prompt bar refuses, or from another form", () => {
    const { doc, find } = desk("  ");
    expect(promptExit(find(`#${PROMPT_FORM_ID}`) as never, null, doc as never)).toBeNull();
    expect(promptExit(find("form") as never, null, doc as never)).toBeNull();
  });
});

describe("the question", () => {
  const how = (unsaved: boolean) => ({ unsaved: () => unsaved, letGo: () => {}, revert: () => {} });

  test("is asked over the window body, in its own words", () => {
    const { win } = desk();
    unsavedQuestionIn(win as never, win as never, how(true))?.show(true);
    const veil = win.querySelector(UNSAVED_LEAVING_SELECTOR) as El;
    expect(veil.parentElement).toBe(win.querySelector(".window__body"));
    expect(veil.textContent).toContain(LEAVING_UNSAVED_QUESTION);
  });

  test("is not asked when nothing would be lost, or with no window body to ask over", () => {
    const { win, find } = desk();
    expect(unsavedQuestionIn(win as never, win as never, how(false))).toBeNull();
    find(".window__body").remove();
    expect(unsavedQuestionIn(win as never, win as never, how(true))).toBeNull();
  });

  test("puts the form's files back before it lets the uploads go, and comes down", () => {
    const { win } = desk();
    const done: string[] = [];
    const question = unsavedQuestionIn(win as never, win as never, {
      unsaved: () => true,
      revert: () => done.push("revert"),
      letGo: () => done.push("let go"),
    });
    question?.show(true);
    expect(question?.end()).toBe(true);
    expect(done).toEqual(["revert", "let go"]);
    expect(win.querySelector(UNSAVED_LEAVING_SELECTOR)).toBeNull();
  });

  test("stops standing once its window has gone from under it", () => {
    const { win } = desk();
    const question = unsavedQuestionIn(win as never, win as never, how(true));
    question?.show(true);
    expect(question?.stands()).toBe(true);
    win.remove();
    expect(question?.stands()).toBe(false);
  });

  test("comes to the front and makes what it covers inert, and gives both back when answered", () => {
    const { win } = desk();
    const raised: unknown[] = [];
    const question = unsavedQuestionIn(win as never, win as never, {
      ...how(true),
      raise: (el) => raised.push(el),
    });
    question?.show(true);
    const region = win.querySelector(`#${WINDOW_CONTENT_ID}`) as El & { inert: boolean };
    expect(raised).toEqual([win]);
    expect(region.inert).toBe(true);
    question?.show(false);
    expect(region.inert).toBe(false);
  });

  test("that keeps gives nothing up when it is answered", () => {
    const { win } = desk();
    const done: string[] = [];
    const question = unsavedQuestionIn(win as never, win as never, {
      unsaved: () => true,
      revert: () => done.push("revert"),
      letGo: () => done.push("let go"),
      keep: true,
    });
    question?.show(true);
    question?.end();
    expect(done).toEqual([]);
  });

  test("gives focus back to what was pressed when the person stays", () => {
    const { doc, win, find } = desk();
    const pressed = find(".capability-item");
    const question = unsavedQuestionIn(win as never, win as never, { ...how(true), pressed });
    question?.show(true);
    expect(doc.activeElement).not.toBe(pressed);
    question?.show(false);
    expect(doc.activeElement).toBe(pressed);
  });
});

describe("a question whose window went from under it", () => {
  test("is no longer answered, so Escape moves nothing", () => {
    const { doc, win, find } = desk();
    startUnsavedChanges(doc as never);
    const edit = doc.createElement("form");
    edit.setAttribute("data-record-edit-form", "");
    const caption = doc.createElement("input");
    caption.setAttribute("name", "caption");
    edit.append(caption);
    find(`#${WINDOW_CONTENT_ID}`).append(edit);
    doc.fire("focusin", caption);
    (caption as El & { value: string }).value = "Dusk";
    const pressed = find("[data-window-doorway]");
    expect(askBeforeLeaving(win as never, () => {}, win, { pressed })).toBe(true);
    win.remove();
    expect(backOutOfLeaving()).toBe(false);
    expect(doc.activeElement).not.toBe(pressed);
    expect(leavingIsBeingAsked()).toBe(false);
  });
});
