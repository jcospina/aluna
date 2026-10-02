// The exits a form has that are not the window's own, wired as the page wires them: the record and
// the create panel the server draws, open in a framed window, the press listeners standing before
// the record view's own, and the question's answers and Escape on the document.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { buildCancelUrl } from "#shell/core/routes.js";
import { saveHeldByTheQuestion, startLeavingAForm } from "#shell/desk/leaving-a-form.js";
import { backOutOfLeaving, startLeavingGuard } from "#shell/desk/leaving-a-run.js";
import {
  UNSAVED_LEAVING_BACK_SELECTOR,
  UNSAVED_LEAVING_GO_SELECTOR,
  UNSAVED_LEAVING_SELECTOR,
} from "#shell/desk/leaving-unsaved-changes.js";
import { startUnsavedChanges } from "#shell/records/unsaved-changes.js";
import { photoSpec } from "../../../registry/fields/file.test-support.ts";
import {
  RUN_LEAVING_ATTRIBUTE,
  renderBuildSubscriber,
} from "../../../server/http/fragments/fragments.ts";
import { installDomGlobals } from "../../controls/double/choice-picker.fixture.test-support.ts";
import type { El } from "../../controls/double/choice-picker.test-support.ts";
import { parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import { renderableFromSpec } from "../../fields/renderable-capability.ts";
import {
  itemElementIdForTemplate,
  renderCollection,
  renderItemWrapper,
} from "../collection/list-container.ts";
import { recordDesk, standingWindow } from "../record-view/record-view.test-support.ts";
import { RECORD_VIEW_ATTR, renderRecordViewTemplate } from "../record-view/record-view.ts";

const CAPABILITY = { ...renderableFromSpec(photoSpec()), incarnationId: "inc" };
const RECORD = {
  id: "photo-1",
  created_at: "2026-10-01T00:00:00.000Z",
  caption: "Dawn",
  photo: null,
};
const TEMPLATE_ID = "record-photos-photo-1";
const COLLECTION = renderCollection({
  capability: CAPABILITY,
  items:
    renderItemWrapper(`<span>${RECORD.caption}</span>`, RECORD, { templateId: TEMPLATE_ID }) +
    renderRecordViewTemplate(TEMPLATE_ID, CAPABILITY, RECORD),
});

installDomGlobals();

let desk: Awaited<ReturnType<typeof recordDesk>> | undefined;
afterEach(() => {
  backOutOfLeaving();
  desk?.restore();
  desk = undefined;
});

/** The photos collection in a framed window, every exit wired the way the page wires it. */
async function wiredDesk() {
  desk = await recordDesk(COLLECTION, {
    capabilityId: CAPABILITY.id,
    modules: ["records/record-view.js"],
    framed: true,
  });
  const { doc } = desk;
  const pageWindow = { addEventListener: doc.addEventListener.bind(doc) };
  startLeavingAForm(pageWindow as never, doc as never);
  startLeavingGuard(doc as never);
  startUnsavedChanges(doc as never);
  /** Start on `field` and change it, as typing into it does. */
  const type = (field: El, text: string) => {
    doc.fire("focusin", field);
    (field as El & { value: string }).value = text;
  };
  const question = () => doc.querySelector(UNSAVED_LEAVING_SELECTOR);
  const answer = (selector: string) => desk?.press(question()?.querySelector(selector) as El);
  return { doc, type, question, answer, reads: desk.asked.requests, press: desk.press };
}

/** The record open in the window, its caption changed. */
async function changedRecord() {
  const scene = await wiredDesk();
  scene.press(scene.doc.getElementById(itemElementIdForTemplate(TEMPLATE_ID)) as El);
  await desk?.settled();
  const view = scene.doc.querySelector(`[${RECORD_VIEW_ATTR}]`) as El;
  scene.type(view.querySelector('[name="caption"]') as El, "Dusk");
  return { ...scene, view };
}

describe("a record with unsaved changes", () => {
  test("holds its Back before the record view hears it, and a yes goes back", async () => {
    const scene = await changedRecord();
    scene.press(scene.view.querySelector("[data-record-back]") as El);
    expect(scene.question()).not.toBeNull();
    expect(scene.reads).toEqual([]);
    scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(scene.question()).toBeNull();
    expect(scene.reads).toHaveLength(1);
  });

  test("keeps the form when the back-out is pressed, or Escape", async () => {
    const scene = await changedRecord();
    const cancel = scene.view.querySelector("[data-record-cancel]") as El;
    scene.press(cancel);
    scene.answer(UNSAVED_LEAVING_BACK_SELECTOR);
    expect(scene.question()).toBeNull();
    scene.press(cancel);
    scene.doc.fire("keydown", scene.doc as never, { key: "Escape" });
    expect(scene.question()).toBeNull();
    expect(scene.reads).toEqual([]);
    expect(scene.doc.querySelector(`[${RECORD_VIEW_ATTR}]`)).toBe(scene.view);
  });

  test("cannot be saved while the question stands", async () => {
    const scene = await changedRecord();
    const form = scene.view.querySelector("form[data-record-edit-form]") as El;
    expect(saveHeldByTheQuestion(form as never)).toBe(false);
    scene.press(scene.view.querySelector("[data-record-back]") as El);
    const { prevented } = scene.doc.fire("submit", form);
    expect(prevented).toBe(true);
    scene.answer(UNSAVED_LEAVING_BACK_SELECTOR);
    expect(saveHeldByTheQuestion(form as never)).toBe(false);
  });

  test("lets an unchanged record go back without asking", async () => {
    const scene = await wiredDesk();
    scene.press(scene.doc.getElementById(itemElementIdForTemplate(TEMPLATE_ID)) as El);
    await desk?.settled();
    scene.press(scene.doc.querySelector("[data-record-back]") as El);
    expect(scene.question()).toBeNull();
    expect(scene.reads).toHaveLength(1);
  });
});

describe("the create panel with unsaved changes", () => {
  test("asks on its Cancel, which would put the form back", async () => {
    const scene = await wiredDesk();
    const panel = scene.doc.querySelector(".capability-collection__create") as El;
    scene.type(panel.querySelector('[name="caption"]') as El, "Picnic");
    scene.press(panel.querySelector("[data-create-cancel]") as El);
    expect(scene.question()).not.toBeNull();
  });

  test("asks on its own Back too, and a yes puts the form down with its Cancel", async () => {
    const scene = await wiredDesk();
    const panel = scene.doc.querySelector(".capability-collection__create") as El;
    const cancelled: string[] = [];
    panel.querySelector("[data-create-cancel]")?.addEventListener("click", () => {
      cancelled.push("cancel");
    });
    scene.type(panel.querySelector('[name="caption"]') as El, "Picnic");
    scene.press(panel.querySelector("[data-record-form-back]") as El);
    expect(scene.question()).not.toBeNull();
    expect(cancelled).toEqual([]);
    scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(cancelled).toEqual(["cancel"]);
  });

  test("lets its own Back go without asking when nothing in it changed", async () => {
    const scene = await wiredDesk();
    const panel = scene.doc.querySelector(".capability-collection__create") as El;
    scene.doc.fire("focusin", panel.querySelector('[name="caption"]') as El);
    scene.press(panel.querySelector("[data-record-form-back]") as El);
    expect(scene.question()).toBeNull();
  });
});

describe("a prompt still being worked out over a record", () => {
  /** A sentence sent from the bar, its run appended to the window and nothing drawn yet. */
  const sendPrompt = (scene: Awaited<ReturnType<typeof wiredDesk>>) =>
    parseHtml(
      renderBuildSubscriber("build-9"),
      scene.doc.querySelector("[data-content-region]") as El,
    );

  test("a form with changes asks its own question, and a yes stops the run before it goes", async () => {
    const scene = await changedRecord();
    sendPrompt(scene);
    const swapped: unknown[] = [];
    Object.assign((standingWindow() as { htmx: object }).htmx, {
      // What htmx's outerHTML swap with nothing does: the run's story leaves the page.
      swap: (node: El) => {
        swapped.push(node);
        node.remove();
      },
    });
    const posted = spyOn(globalThis, "fetch").mockImplementation(
      (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    );
    scene.press(scene.view.querySelector("[data-record-back]") as El);
    expect(scene.question()).not.toBeNull();
    scene.answer(UNSAVED_LEAVING_GO_SELECTOR);
    expect(posted.mock.calls.map(([url]) => String(url))).toEqual([buildCancelUrl("build-9")]);
    expect(swapped).toHaveLength(1);
    expect(scene.reads).toHaveLength(1);
    posted.mockRestore();
  });

  test("an unchanged form asks the run's own question, since leaving would stop it", async () => {
    const scene = await wiredDesk();
    scene.press(scene.doc.getElementById(itemElementIdForTemplate(TEMPLATE_ID)) as El);
    await desk?.settled();
    sendPrompt(scene);
    scene.press(scene.doc.querySelector("[data-record-back]") as El);
    expect(scene.question()).toBeNull();
    expect(scene.doc.querySelector(`[${RUN_LEAVING_ATTRIBUTE}]`)?.hasAttribute("hidden")).toBe(
      false,
    );
    expect(scene.reads).toEqual([]);
  });
});
