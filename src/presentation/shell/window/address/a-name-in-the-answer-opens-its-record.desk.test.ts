// A name pressed in the answer, run on the desk as the page starts it: the answer window and the
// capability window on one document, the press taking the record address's own path (ADR-0010,
// PLAN decision 48). The answer window's half alone is `a-name-opens-its-record.test.ts`.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { CONTENT_REGION_SELECTOR } from "#shell/core/region-scope.js";
import { recordAddress } from "#shell/core/routes.js";
import { PLACES_ITS_OWN_FOCUS } from "#shell/core/shell-dom.js";
import { takeRecordAddress } from "#shell/desk/desk-address.js";
import { backOutOfLeaving, goAheadAndLeave } from "#shell/desk/leaving-a-run.js";
import {
  UNSAVED_LEAVING_BACK_SELECTOR,
  UNSAVED_LEAVING_SELECTOR,
} from "#shell/desk/leaving-unsaved-changes.js";
import { ANSWER_WINDOW_SELECTOR } from "#shell/desk/window/desk-answer-window.js";
import { capabilityAddress, DESK_ADDRESS } from "#shell/desk/window/desk-window.js";
import { startUnsavedChanges } from "#shell/records/unsaved-changes.js";
import {
  RUN_LEAVING_ATTRIBUTE,
  renderBuildSubscriber,
} from "../../../../server/http/fragments/fragments.ts";
import { startedOn } from "../../../controls/double/started-module.test-support.ts";
import { type El, pressLamp } from "../standing-desk.test-support.ts";
import { deskNodes } from "../viewport-desk.test-support.ts";
import {
  askedFrom,
  deskAnswering,
  type Ending,
  gate,
  RECORD,
  restoreDesk,
  settled,
} from "./record-address-desk.test-support.ts";
import { tabHistory } from "./tab-history.test-support.ts";

type AnswerWindowModule = typeof import("#shell/desk/window/desk-answer-window.js");

let answer: AnswerWindowModule | undefined;
afterEach(() => {
  answer?.dismissAnswerWindow();
  answer = undefined;
  restoreDesk();
});

const NAME = "Buy figs";

/** The desk loaded at `pathname`, an answer standing on it that names `record` in `capability`. */
async function answeredDesk(
  pathname: string,
  endings: readonly (Ending | number)[],
  record = RECORD,
  capability = "notes",
) {
  const desk = await deskAnswering(pathname, endings);
  answer = await startedOn<AnswerWindowModule>("desk/window/desk-answer-window.js", desk.desk.doc);
  const opened = answer.openAnswerWindow(desk.desk.doc, "what is left to do?", "");
  answer.sayInAnswerWindow([{ text: "Still to do:\n" }, { name: NAME, capability, record }]);
  const link = () => opened.body.querySelector("a") as unknown as El;
  const press = async (more: Record<string, unknown> = {}) => {
    const event = { type: "click", target: link(), button: 0, ...more };
    const allowed = link().dispatchEvent(event as never);
    await settled();
    return allowed;
  };
  const capabilityWindow = () =>
    desk.desk.windows().find((el) => !el.matches(ANSWER_WINDOW_SELECTOR));
  const answerEl = opened.el as unknown as El;
  const inFront = () => desk.desk.windows().find((el) => el.classList.contains("is-focused"));
  const recordField = () => capabilityWindow()?.querySelector('[name="text"]') as El;
  return { ...desk, answerEl, link, press, capabilityWindow, inFront, recordField };
}

describe("a plain press", () => {
  test("pushes the record address and opens the record in front, the answer standing behind", async () => {
    const desk = await answeredDesk(DESK_ADDRESS, [200]);
    expect(await desk.press()).toBe(false);
    expect(desk.written()).toEqual([`push ${recordAddress("notes", RECORD)}`]);
    expect(desk.asked()).toEqual([recordAddress("notes", RECORD)]);
    expect(desk.capabilityWindow()?.querySelector("h2")?.textContent).toBe("Notes");
    expect(desk.capabilityWindow()?.querySelector("[data-record-view]")).not.toBeNull();
    // The record is what the press asked to see: its window comes forward and its first field
    // takes the focus the link lets go of.
    expect(desk.inFront()).toBe(desk.capabilityWindow());
    expect(desk.desk.windows()).toContain(desk.answerEl);
    expect(desk.desk.doc.activeElement).toBe(desk.recordField());
    // And the next question's answer comes on top of the record it opened.
    answer?.openAnswerWindow(desk.desk.doc, "what else is left?", "");
    expect(desk.inFront()).toBe(desk.answerEl);
  });

  test("on a phone, brings the record's window forward", async () => {
    const desk = await answeredDesk(DESK_ADDRESS, [200]);
    desk.setPhone(true);
    await desk.press();
    expect(desk.inFront()).toBe(desk.capabilityWindow());
    expect(desk.desk.windows()).toContain(desk.answerEl);
  });

  test("Back puts the window back to what it held before", async () => {
    const desk = await answeredDesk(capabilityAddress("recipes"), [200, 200, 200]);
    await desk.press();
    expect(desk.written()).toEqual([`push ${recordAddress("notes", RECORD)}`]);
    await desk.travelTo(capabilityAddress("recipes"));
    expect(desk.asked()).toEqual([
      capabilityAddress("recipes"),
      recordAddress("notes", RECORD),
      capabilityAddress("recipes"),
    ]);
    expect(desk.capabilityWindow()?.querySelector("h2")?.textContent).toBe("Recipes");
    expect(desk.desk.windows()).toContain(desk.answerEl);
  });

  test("Back from a bare desk takes the capability window away and leaves the answer", async () => {
    const desk = await answeredDesk(DESK_ADDRESS, [200]);
    await desk.press();
    await desk.travelTo(DESK_ADDRESS);
    expect(desk.desk.windows()).toEqual([desk.answerEl]);
  });

  test("on the record already open, asks nothing and brings it forward with the focus", async () => {
    const desk = await answeredDesk(recordAddress("notes", RECORD), [200]);
    expect(desk.inFront()).toBe(desk.answerEl);
    desk.link().focus();
    await desk.press();
    expect(desk.asked()).toEqual([recordAddress("notes", RECORD)]);
    expect(desk.written()).toEqual([]);
    expect(desk.inFront()).toBe(desk.capabilityWindow());
    expect(desk.desk.doc.activeElement).toBe(desk.recordField());
  });

  test("into a capability no longer on the desk, leaves the desk alone and unlinks the name", async () => {
    const desk = await answeredDesk(capabilityAddress("recipes"), [200], RECORD, "ghosts");
    expect(await desk.press()).toBe(false);
    expect(desk.asked()).toEqual([capabilityAddress("recipes")]);
    expect(desk.written()).toEqual([]);
    expect(desk.capabilityWindow()?.querySelector("h2")?.textContent).toBe("Recipes");
    expect(desk.answerEl.querySelector("a")).toBeNull();
    expect(desk.answerEl.textContent).toContain(NAME);
    // The bar says what it says of any record that is not there, and takes the focus beside it.
    expect(desk.desk.doc.activeElement).toBe(desk.desk.bar.querySelector("input") as El);
  });

  test("over unsaved changes, asks first, and a yes opens the record", async () => {
    const other = randomUUID();
    const desk = await answeredDesk(recordAddress("notes", other), [200, 200]);
    startUnsavedChanges(desk.desk.doc as never);
    const field = desk.capabilityWindow()?.querySelector('[name="text"]') as El;
    field.dispatchEvent({ type: "focusin", target: field } as never);
    (field as El & { value: string }).value = "Buy plums";
    await desk.press();
    expect(desk.capabilityWindow()?.querySelector(UNSAVED_LEAVING_SELECTOR)).not.toBeNull();
    expect(desk.inFront()).toBe(desk.capabilityWindow());
    expect(desk.written()).toEqual([]);
    expect(desk.asked()).toEqual([recordAddress("notes", other)]);
    // A second press while it stands is dropped, and the question is brought back in front.
    desk.answerEl.dispatchEvent({ type: "pointerdown", target: desk.answerEl, button: 0 } as never);
    await desk.press();
    expect(desk.inFront()).toBe(desk.capabilityWindow());
    expect(desk.written()).toEqual([]);
    goAheadAndLeave(desk.desk.doc as never);
    await settled();
    expect(desk.written()).toEqual([`push ${recordAddress("notes", RECORD)}`]);
    expect(desk.asked()).toEqual([recordAddress("notes", other), recordAddress("notes", RECORD)]);
    expect(desk.inFront()).toBe(desk.capabilityWindow());
  });

  test("on a record deleted since the answer, opens its collection under the bar's notice", async () => {
    const gone = randomUUID();
    const desk = await answeredDesk(DESK_ADDRESS, [404, 200], gone);
    await desk.press();
    expect(desk.asked()).toEqual([recordAddress("notes", gone), capabilityAddress("notes")]);
    // The record was asked from the desk, so its 404 speaks on the prompt bar (`public/app.js`),
    // and the collection from inside the window, which leaves that notice standing.
    expect(askedFrom()).toEqual([false, true]);
    expect(desk.written()).toEqual([
      `push ${recordAddress("notes", gone)}`,
      `replace ${capabilityAddress("notes")}`,
    ]);
    const region = desk.capabilityWindow()?.querySelector('[data-active-capability-id="notes"]');
    expect(region).not.toBeNull();
    expect(desk.inFront()).toBe(desk.capabilityWindow());
  });

  test("on a record deleted since, whose 404 is slow, leaves the front to what the person chose", async () => {
    const slow = gate();
    const desk = await answeredDesk(DESK_ADDRESS, [{ status: 404, gate: slow.opened }, 200]);
    await desk.press();
    // The person brings the answer back while the record is still being asked for.
    desk.answerEl.dispatchEvent({ type: "pointerdown", target: desk.answerEl, button: 0 } as never);
    slow.open();
    await settled();
    expect(desk.asked()).toEqual([recordAddress("notes", RECORD), capabilityAddress("notes")]);
    // The collection lands in the window already open, which is not raised over the answer again.
    expect(desk.inFront()).toBe(desk.answerEl);
  });
});

describe("where focus goes", () => {
  test("not into the record being left while the pressed one is still coming", async () => {
    const other = randomUUID();
    const slow = gate();
    const desk = await answeredDesk(recordAddress("notes", other), [
      200,
      { status: 200, gate: slow.opened },
    ]);
    const leaving = desk.recordField();
    await desk.press();
    expect(desk.desk.doc.activeElement).not.toBe(leaving);
    slow.open();
    await settled();
    expect(desk.desk.doc.activeElement).toBe(desk.recordField());
    expect(desk.recordField()).not.toBe(leaving);
  });

  test("not into a window the person put behind before the record landed", async () => {
    const slow = gate();
    const desk = await answeredDesk(DESK_ADDRESS, [{ status: 200, gate: slow.opened }]);
    await desk.press();
    desk.answerEl.dispatchEvent({ type: "pointerdown", target: desk.answerEl, button: 0 } as never);
    slow.open();
    await settled();
    expect(desk.inFront()).toBe(desk.answerEl);
    expect(desk.capabilityWindow()?.contains(desk.desk.doc.activeElement as El)).toBe(false);
  });

  test("away from the bar, where a browser that does not focus a link left it", async () => {
    const desk = await answeredDesk(DESK_ADDRESS, [200]);
    const field = desk.desk.bar.querySelector("input") as El;
    field.focus();
    await desk.press();
    expect(desk.desk.doc.activeElement).toBe(desk.recordField());
  });

  test("back into the form that was kept, when the person keeps editing", async () => {
    const other = randomUUID();
    const desk = await answeredDesk(recordAddress("notes", other), [200]);
    startUnsavedChanges(desk.desk.doc as never);
    const field = desk.recordField();
    field.dispatchEvent({ type: "focusin", target: field } as never);
    (field as El & { value: string }).value = "Buy plums";
    await desk.press();
    expect(desk.capabilityWindow()?.querySelector(UNSAVED_LEAVING_SELECTOR)).not.toBeNull();
    backOutOfLeaving();
    expect(desk.desk.doc.activeElement).toBe(field);
    expect(desk.written()).toEqual([]);
  });

  test("into the pressed record after a yes, as when there was nothing to ask", async () => {
    const other = randomUUID();
    const desk = await answeredDesk(recordAddress("notes", other), [200, 200]);
    startUnsavedChanges(desk.desk.doc as never);
    const left = desk.recordField();
    left.dispatchEvent({ type: "focusin", target: left } as never);
    (left as El & { value: string }).value = "Buy plums";
    await desk.press();
    goAheadAndLeave(desk.desk.doc as never);
    await settled();
    expect(desk.desk.doc.activeElement).toBe(desk.recordField());
    expect(desk.recordField()).not.toBe(left);
  });

  test("into the pressed record after a yes that ends a run, the run's question asked", async () => {
    const other = randomUUID();
    const desk = await answeredDesk(recordAddress("notes", other), [200, 200]);
    const region = desk.capabilityWindow()?.querySelector(CONTENT_REGION_SELECTOR) as El;
    region.append(...(deskNodes(renderBuildSubscriber("build-9")) as El[]));
    await desk.press();
    expect(desk.written()).toEqual([]);
    const swap = (node: El) => node.remove();
    goAheadAndLeave(desk.desk.doc as never, { api: { swap } as never, post: () => {} });
    await settled();
    expect(desk.written()).toEqual([`push ${recordAddress("notes", RECORD)}`]);
    expect(desk.desk.doc.activeElement).toBe(desk.recordField());
  });
});

describe("where focus goes when nothing new lands", () => {
  test("onto the bar beside its notice, on a name whose record was deleted since", async () => {
    const desk = await answeredDesk(DESK_ADDRESS, [404, 200], randomUUID());
    await desk.press();
    expect(desk.desk.doc.activeElement).toBe(desk.desk.bar.querySelector("input") as El);
  });

  test("onto the bar, where a refused record leaves the collection the person was reading", async () => {
    const desk = await answeredDesk(capabilityAddress("notes"), [200, 500]);
    await desk.press();
    expect(
      desk.capabilityWindow()?.querySelector('[data-active-capability-id="notes"]'),
    ).not.toBeNull();
    expect(desk.desk.doc.activeElement).toBe(desk.desk.bar.querySelector("input") as El);
  });

  test("onto the bar too, when a yes leads to a record deleted since", async () => {
    const other = randomUUID();
    const desk = await answeredDesk(recordAddress("notes", other), [200, 404, 200], randomUUID());
    startUnsavedChanges(desk.desk.doc as never);
    const left = desk.recordField();
    left.dispatchEvent({ type: "focusin", target: left } as never);
    (left as El & { value: string }).value = "Buy plums";
    await desk.press();
    goAheadAndLeave(desk.desk.doc as never);
    await settled();
    expect(desk.desk.doc.activeElement).toBe(desk.desk.bar.querySelector("input") as El);
  });

  test("into the record already open, its changes kept and nothing asked", async () => {
    const desk = await answeredDesk(recordAddress("notes", RECORD), [200]);
    startUnsavedChanges(desk.desk.doc as never);
    const field = desk.recordField();
    field.dispatchEvent({ type: "focusin", target: field } as never);
    (field as El & { value: string }).value = "Buy plums";
    await desk.press();
    expect(desk.capabilityWindow()?.querySelector(UNSAVED_LEAVING_SELECTOR)).toBeNull();
    expect(desk.written()).toEqual([]);
    expect(desk.inFront()).toBe(desk.capabilityWindow());
    expect(desk.recordField()).toBe(field);
    expect((field as El & { value: string }).value).toBe("Buy plums");
    expect(desk.desk.doc.activeElement).toBe(field);
  });

  test("on the record already open while a question stands, back to the question", async () => {
    const desk = await answeredDesk(recordAddress("notes", RECORD), [200]);
    startUnsavedChanges(desk.desk.doc as never);
    const field = desk.recordField();
    field.dispatchEvent({ type: "focusin", target: field } as never);
    (field as El & { value: string }).value = "Buy plums";
    pressLamp(desk.capabilityWindow() as El, "putaway");
    const question = desk.capabilityWindow()?.querySelector(UNSAVED_LEAVING_SELECTOR);
    expect(question).not.toBeNull();
    await desk.press();
    expect(desk.capabilityWindow()?.querySelector(UNSAVED_LEAVING_SELECTOR)).toBe(question);
    const back = desk.capabilityWindow()?.querySelector(UNSAVED_LEAVING_BACK_SELECTOR);
    expect(desk.desk.doc.activeElement).toBe(back as El);
  });

  test("on the record already open under a live run, asks about the run", async () => {
    const desk = await answeredDesk(recordAddress("notes", RECORD), [200, 200]);
    const region = desk.capabilityWindow()?.querySelector(CONTENT_REGION_SELECTOR) as El;
    region.append(...(deskNodes(renderBuildSubscriber("build-9")) as El[]));
    await desk.press();
    expect(
      desk.capabilityWindow()?.querySelector(`[${RUN_LEAVING_ATTRIBUTE}]:not([hidden])`),
    ).not.toBeNull();
  });
});

describe("any other press is the browser's", () => {
  const presses: Record<string, Record<string, unknown>> = {
    "a Cmd-press": { metaKey: true },
    "a Ctrl-press": { ctrlKey: true },
    "a Shift-press": { shiftKey: true },
    "an Alt-press": { altKey: true },
    "a middle press": { button: 1 },
  };
  for (const [what, more] of Object.entries(presses)) {
    test(`${what} is left to open the record address in a new tab`, async () => {
      const desk = await answeredDesk(DESK_ADDRESS, [200]);
      expect(await desk.press(more)).toBe(true);
      expect(desk.asked()).toEqual([]);
      expect(desk.written()).toEqual([]);
      expect((desk.link() as unknown as { href: string }).href).toBe(
        recordAddress("notes", RECORD),
      );
    });
  }
});

describe("the press stands where a Back would", () => {
  /** A bar on the notes collection, and a desk that holds every navigation until told to go. */
  function heldDesk() {
    const tab = tabHistory(capabilityAddress("notes"), () => {});
    const rendered: string[] = [];
    const held: (() => unknown)[] = [];
    const hold = (go: () => unknown) => held.push(go) > 0;
    const brought: string[] = [];
    const desk = {
      render: (at: string) => rendered.push(at),
      hold,
      knows: (id: string) => id === "notes",
      bring: () => brought.push(tab.location.pathname),
    };
    return { tab, rendered, held, brought, desk };
  }

  test("nothing moves while the desk asks, and a yes pushes, opens and brings it forward", () => {
    const { tab, rendered, held, brought, desk } = heldDesk();
    expect(takeRecordAddress("notes", RECORD.toUpperCase(), desk, tab)).toBe("held");
    // The window holding the question comes forward, and the record's once a yes opens it.
    expect([tab.entries(), rendered]).toEqual([[capabilityAddress("notes")], []]);
    expect(brought).toEqual([capabilityAddress("notes")]);
    // A yes leaves the focus to the record, which takes it as it lands.
    expect(held[0]?.()).toBe(PLACES_ITS_OWN_FOCUS);
    expect(tab.entries()).toEqual([capabilityAddress("notes"), recordAddress("notes", RECORD)]);
    expect(rendered).toEqual([recordAddress("notes", RECORD)]);
    expect(brought).toEqual([capabilityAddress("notes"), recordAddress("notes", RECORD)]);
  });

  test("with nothing to ask, it opens at once", () => {
    const { tab, rendered, desk } = heldDesk();
    expect(takeRecordAddress("notes", RECORD, { ...desk, hold: () => false }, tab)).toBe("opened");
    expect(rendered).toEqual([recordAddress("notes", RECORD)]);
  });

  test("a capability gone from the desk is neither asked about nor opened", () => {
    const { tab, rendered, held, desk } = heldDesk();
    expect(takeRecordAddress("ghosts", RECORD, desk, tab)).toBe("gone");
    expect([held, rendered, tab.entries()]).toEqual([[], [], [capabilityAddress("notes")]]);
  });

  test("ids no record address can carry ask nothing and open nothing", () => {
    const { tab, rendered, held, desk } = heldDesk();
    const wrong: [unknown, unknown][] = [
      ["Notes", RECORD],
      ["../notes", RECORD],
      ["notes", "not-a-record"],
      ["notes", `${RECORD}/edit`],
      [7, RECORD],
      ["notes", null],
    ];
    for (const [capability, record] of wrong) {
      expect(takeRecordAddress(capability, record, desk, tab)).toBeNull();
    }
    expect([held, rendered, tab.entries()]).toEqual([[], [], [capabilityAddress("notes")]]);
  });
});
