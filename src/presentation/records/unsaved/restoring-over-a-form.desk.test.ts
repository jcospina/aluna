// What a prompt's run puts back when it ends, over a record still open in the window: the
// real `public/app.js` closing the run's stream on the desk's own document, with the unsaved-changes
// question, the leaving guard and the form bookkeeping started beside it as the page starts them. A
// run that never drew left the form live, so what was typed since the prompt was sent is asked about.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROMPT_FIELD_ID, PROMPT_FORM_ID } from "#shell/core/shell-dom.js";
import { startLeavingAForm } from "#shell/desk/leaving-a-form.js";
import { backOutOfLeaving, startLeavingGuard } from "#shell/desk/leaving-a-run.js";
import {
  UNSAVED_LEAVING_BACK_SELECTOR,
  UNSAVED_LEAVING_GO_SELECTOR,
  UNSAVED_LEAVING_SELECTOR,
} from "#shell/desk/leaving-unsaved-changes.js";
import { NAME_THE_WINDOW_EVENT } from "#shell/desk/window/desk-window.js";
import { startUnsavedChanges } from "#shell/records/unsaved-changes.js";
import {
  renderBuildSubscriber,
  renderCapabilitySurface,
  renderPromptNotice,
} from "../../../server/http/fragments/fragments.ts";
import { installDomGlobals } from "../../controls/double/choice-picker.fixture.test-support.ts";
import { type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import { NOTHING_TO_CONNECT } from "../../controls/link/link-copy.ts";
import { renderCollection } from "../collection/list-container.ts";
import {
  CAPABILITY,
  RECORD,
  recordDesk,
  standingWindow,
} from "../record-view/record-view.test-support.ts";
import { RECORD_VIEW_ATTR, renderRecordView } from "../record-view/record-view.ts";

installDomGlobals();

/** What the run puts back: Notes as the registry now draws it, its collection. */
const RESTORED = `<div data-build-restoration="capability">${renderCapabilitySurface(
  { id: CAPABILITY.id, incarnation_id: "incarnation-1", version: 1 },
  renderCollection({ capability: CAPABILITY, items: "" }),
)}</div>`;

let desk: Awaited<ReturnType<typeof recordDesk>> | undefined;
afterEach(() => {
  backOutOfLeaving();
  desk?.restore();
  desk = undefined;
});

/** A real event, aimed at a node of the desk, the way htmx sends its own. */
function send(node: El, type: string, detail: unknown): boolean {
  return node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, cancelable: true }));
}

/** `public/app.js` on the desk's document as the page runs it, its shell component started. */
function startTheGlue(doc: El, frames: (() => void)[]) {
  const globals = globalThis as Record<string, unknown>;
  const page = standingWindow() as unknown as Record<string, unknown>;
  let shell: (() => { init(): void }) | undefined;
  page.Alpine = { data: (_name: string, factory: () => { init(): void }) => (shell = factory) };
  const glue = readFileSync(resolve("public/app.js"), "utf8");
  const names = ["HTMLInputElement", "HTMLFormElement", "HTMLElement", "Element"];
  Function(
    "document",
    "window",
    "requestAnimationFrame",
    ...names,
    "HTMLTemplateElement",
    "Node",
    glue,
  )(
    doc,
    page,
    (frame: () => void) => frames.push(frame),
    ...names.map((name) => globals[name]),
    globals.HTMLTemplateElement,
    { TEXT_NODE: 3 },
  );
  send(doc, "alpine:init", null);
  shell?.().init();
}

/**
 * Notes' record open in a framed window, the prompt bar beside it, and the page's rules started on
 * it in the page's order: the glue first, then the modules. `typed` is changed before the prompt is
 * sent, which the yes to the question asked then gave up.
 */
async function deskWithARecord(typed?: string) {
  desk = await recordDesk(renderRecordView(CAPABILITY, RECORD), {
    capabilityId: CAPABILITY.id,
    framed: true,
  });
  const { doc } = desk;
  parseHtml(`<form id="${PROMPT_FORM_ID}"><input id="${PROMPT_FIELD_ID}"></form>`, doc);
  const frames: (() => void)[] = [];
  startTheGlue(doc, frames);
  startLeavingAForm({ addEventListener: doc.addEventListener.bind(doc) } as never, doc as never);
  startLeavingGuard(doc as never);
  startUnsavedChanges(doc as never);
  const field = () => doc.querySelector('[name="text"]') as El & { value: string };
  const type = (text: string) => {
    doc.fire("focusin", field());
    field().value = text;
  };
  if (typed !== undefined) type(typed);
  /* The sentence sent from the bar: its run appended to the window, its stream open. */
  send(doc.getElementById(PROMPT_FORM_ID) as El, "htmx:beforeSend", {
    elt: doc.getElementById(PROMPT_FORM_ID),
  });
  parseHtml(renderBuildSubscriber("build-9"), desk.region);
  const run = doc.querySelector(".build-stream") as El;
  const surface = run.querySelector(".build-stream__fragment") as El;
  send(surface, "htmx:sseOpen", null);
  /** Every name the window was given back or called, in order. */
  const namings: unknown[] = [];
  doc.addEventListener(NAME_THE_WINDOW_EVENT, (event) => {
    namings.push((event as unknown as CustomEvent<{ title: unknown }>).detail.title);
  });
  /** The run ending: what it puts back arrives, htmx places it in the run, and the stream closes. */
  const end = (raw = RESTORED) => {
    if (send(surface, "htmx:sseBeforeMessage", { data: raw })) parseHtml(raw, surface);
    send(surface, "htmx:sseClose", { type: "message" });
    for (const frame of frames.splice(0)) frame();
  };
  const question = () => doc.querySelector(UNSAVED_LEAVING_SELECTOR);
  const backOut = () => question()?.querySelector(UNSAVED_LEAVING_BACK_SELECTOR) as El;
  const answer = (selector: string) => desk?.press(question()?.querySelector(selector) as El);
  /** What the window shows, beside the run's own surface, which is not on screen. */
  const shows = () => {
    const children = desk?.region.children ?? [];
    const shown = children.filter((child) => !child.matches(".build-stream"));
    const holds = (selector: string) => shown.some((child) => child.querySelector(selector));
    return {
      record: holds(`[${RECORD_VIEW_ATTR}]`),
      collection: holds(".capability-collection"),
      run: shown.length < children.length,
    };
  };
  const press = (selector: string) => desk?.press(doc.querySelector(selector) as El);
  return { doc, run, type, field, end, question, backOut, answer, shows, press, namings };
}

describe("a run that never drew, ending over a record changed since the prompt was sent", () => {
  test("asks before it draws the window again, keeping what was typed and the keyboard", async () => {
    const scene = await deskWithARecord();
    scene.type("Dusk");
    scene.end();

    expect(scene.question()).not.toBeNull();
    expect(scene.field().value).toBe("Dusk");
    expect(scene.shows()).toStrictEqual({ record: true, collection: false, run: true });
    expect(scene.doc.activeElement).toBe(scene.backOut());
    // The run is over, so the window gets back its own name while the question stands.
    expect(scene.namings).toStrictEqual([null]);
  });

  test("a yes draws the window again from what the run put back", async () => {
    const scene = await deskWithARecord();
    scene.type("Dusk");
    scene.end();
    scene.answer(UNSAVED_LEAVING_GO_SELECTOR);

    expect(scene.question()).toBeNull();
    expect(scene.shows()).toStrictEqual({ record: false, collection: true, run: false });
  });

  test("keeping on editing keeps the record and what was typed, and lets the run go", async () => {
    const scene = await deskWithARecord();
    scene.type("Dusk");
    scene.end();
    scene.answer(UNSAVED_LEAVING_BACK_SELECTOR);

    expect(scene.question()).toBeNull();
    expect(scene.field().value).toBe("Dusk");
    expect(scene.shows()).toStrictEqual({ record: true, collection: false, run: false });
  });

  test("a sentence sent while it asks waits behind the question, as any leave does", async () => {
    const scene = await deskWithARecord();
    scene.type("Dusk");
    scene.end();
    const bar = scene.doc.getElementById(PROMPT_FORM_ID) as El;
    (scene.doc.getElementById(PROMPT_FIELD_ID) as El & { value: string }).value = "add a year";

    expect(scene.doc.fire("submit", bar).prevented).toBe(true);
    expect(scene.doc.activeElement).toBe(scene.backOut());
  });

  test("a question already standing keeps the record under it, and lets the run go", async () => {
    const scene = await deskWithARecord();
    scene.type("Dusk");
    scene.press("[data-record-back]");
    scene.end();

    expect(scene.doc.querySelectorAll(UNSAVED_LEAVING_SELECTOR)).toHaveLength(1);
    expect(scene.field().value).toBe("Dusk");
    expect(scene.shows()).toStrictEqual({ record: true, collection: false, run: false });
  });

  test("a save still on its way is asked about too, rather than cut off by the swap", async () => {
    const scene = await deskWithARecord();
    const form = scene.doc.querySelector("form[data-record-edit-form]") as El;
    send(form, "htmx:beforeSend", { elt: form });
    form.setAttribute("aria-busy", "true");
    scene.end();

    expect(scene.question()).not.toBeNull();
    expect(scene.shows()).toStrictEqual({ record: true, collection: false, run: true });
  });

  test("a save the run's build refused leaves what was typed to be asked about", async () => {
    const scene = await deskWithARecord();
    scene.type("Dusk");
    const form = scene.doc.querySelector("form[data-record-edit-form]") as El;
    send(form, "htmx:beforeSend", { elt: form });
    scene.end();

    expect(scene.question()).not.toBeNull();
    expect(scene.field().value).toBe("Dusk");
  });
});

describe("a run whose ending costs the open record nothing draws the window again at once", () => {
  test("a record left as it was", async () => {
    const scene = await deskWithARecord();
    scene.end();

    expect(scene.question()).toBeNull();
    expect(scene.shows()).toStrictEqual({ record: false, collection: true, run: false });
    expect(scene.namings).toStrictEqual([null]);
  });

  test("changes standing when the prompt was sent, given up by its yes, and untouched since", async () => {
    const scene = await deskWithARecord("Dusk");
    scene.doc.fire("pointerdown", scene.doc.getElementById(PROMPT_FIELD_ID) as El);
    scene.end();

    expect(scene.question()).toBeNull();
    expect(scene.shows()).toStrictEqual({ record: false, collection: true, run: false });
  });

  test("an ending that puts nothing back, which leaves the record and what was typed as they were", async () => {
    const scene = await deskWithARecord();
    scene.type("Dusk");
    scene.end(renderPromptNotice(NOTHING_TO_CONNECT, "refusal"));

    expect(scene.question()).toBeNull();
    expect(scene.field().value).toBe("Dusk");
    expect(scene.shows()).toStrictEqual({ record: true, collection: false, run: false });
  });

  test("a run that drew, which had hidden the record", async () => {
    const scene = await deskWithARecord();
    scene.type("Dusk");
    parseHtml("<p></p>", scene.run.querySelector(".build-stream__narration") as El);
    scene.end();

    expect(scene.question()).toBeNull();
    expect(scene.shows()).toStrictEqual({ record: false, collection: true, run: false });
  });
});
