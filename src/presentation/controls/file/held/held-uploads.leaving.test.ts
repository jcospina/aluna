// Leaving a record whose form has unsaved changes (Module 7 PLAN decision 32): the photos record
// open in a framed window, its photo field mounted over the real upload transfer, and the leaving
// question the desk's navigations and the form's own exits stand behind.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { FILE_FIELD_HOOKS as HOOKS, mountFileFields, pickInto } from "#design/files/file-field.js";
import { uploadTransfer, wireFileFields } from "#shell/controls/file-field.js";
import { heldUploads, holdsUpload } from "#shell/controls/held-uploads.js";
import { releaseRegionContent, startRegionScopes } from "#shell/core/region-scope.js";
import { capabilityUrl } from "#shell/core/routes.js";
import { exitPressed, holdExit } from "#shell/desk/leaving-a-form.js";
import {
  askBeforeLeaving,
  backOutOfLeaving,
  goAheadAndLeave,
  leavingIsBeingAsked,
} from "#shell/desk/leaving-a-run.js";
import {
  LEAVING_UNSAVED_BACK_OUT,
  LEAVING_UNSAVED_QUESTION,
  UNSAVED_LEAVING_SELECTOR,
} from "#shell/desk/leaving-unsaved-changes.js";
import { startUnsavedChanges } from "#shell/records/unsaved-changes.js";
import { mintFileKey } from "../../../../platform/files/store/ledger.ts";
import { photoSpec } from "../../../../registry/fields/file.test-support.ts";
import { renderableFromSpec } from "../../../fields/renderable-capability.ts";
import {
  itemElementIdForTemplate,
  renderCollection,
  renderItemWrapper,
} from "../../../records/collection/list-container.ts";
import {
  recordDesk,
  standingWindow,
} from "../../../records/record-view/record-view.test-support.ts";
import {
  RECORD_VIEW_ATTR,
  renderRecordViewTemplate,
} from "../../../records/record-view/record-view.ts";
import { installDomGlobals } from "../../double/choice-picker.fixture.test-support.ts";
import type { El } from "../../double/choice-picker.test-support.ts";
import { hooked } from "../file-field.test-support.ts";
import { installRemovalObserver, UploadDouble } from "./held-uploads.test-support.ts";

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
const removed = installRemovalObserver();

let given: string[][] = [];
let fetchSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  given = [];
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    given.push((JSON.parse(String(init?.body)) as { keys: string[] }).keys);
    return new Response(null, { status: 204 });
  }) as typeof fetch);
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every key the pending-only route was handed, once the requests have gone. */
async function discarded(): Promise<string[]> {
  await flush();
  return given.flat();
}

let desk: Awaited<ReturnType<typeof recordDesk>> | undefined;
afterEach(() => {
  backOutOfLeaving();
  if (desk) heldUploads.claimed(desk.doc as never);
  desk?.restore();
  desk = undefined;
  fetchSpy.mockRestore();
});

/** The photos record open in its window, with its photo field mounted and nothing picked yet. */
async function openRecord() {
  desk = await recordDesk(COLLECTION, {
    capabilityId: CAPABILITY.id,
    modules: ["records/record-view.js", "records/record-mutations.js"],
    framed: true,
  });
  desk.press(desk.doc.getElementById(itemElementIdForTemplate(TEMPLATE_ID)) as El);
  await desk.settled();
  const view = desk.doc.querySelector(`[${RECORD_VIEW_ATTR}]`) as El;
  startRegionScopes(desk.doc.body as never);
  Object.assign(standingWindow(), { addEventListener: () => {} });
  wireFileFields(desk.doc as never);
  startUnsavedChanges(desk.doc as never);
  const uploads: UploadDouble[] = [];
  mountFileFields(
    desk.doc as never,
    uploadTransfer(() => {
      const upload = new UploadDouble();
      uploads.push(upload);
      return upload as never;
    }),
  );
  const field = view.querySelector(hooked(HOOKS.field)) as El;
  const pick = (name: string) => {
    const file = new File([new Uint8Array(10)], name, { type: "image/jpeg" });
    pickInto(field as never, { name, type: "image/jpeg", size: 10, file });
    return uploads.at(-1) as UploadDouble;
  };
  const win = desk.doc.querySelector(".window") as El;
  const veil = () => win.querySelector(UNSAVED_LEAVING_SELECTOR);
  const form = view.querySelector("form") as El;
  return { doc: desk.doc, view, form, field, win, pick, veil, reads: desk.asked.requests };
}

/** The record with a photo picked into it and admitted under a fresh key. */
async function holdingAPhoto() {
  const scene = await openRecord();
  const key = mintFileKey();
  scene.pick("dusk.jpg").admit(key, "dusk.jpg");
  await flush();
  return { ...scene, key };
}

describe("a navigation that would take a form with unsaved changes", () => {
  test("asks over the window, with focus on the answer that keeps it", async () => {
    const scene = await holdingAPhoto();
    let left = 0;
    expect(askBeforeLeaving(scene.win as never, () => (left += 1))).toBe(true);
    const veil = scene.veil() as El;
    expect(veil.parentElement).toBe(scene.win.querySelector(".window__body"));
    expect(veil.textContent).toContain(LEAVING_UNSAVED_QUESTION);
    expect(scene.doc.activeElement?.textContent).toBe(LEAVING_UNSAVED_BACK_OUT);
    expect(left).toBe(0);
  });

  test("backing out changes nothing: the question goes and the photo stays held", async () => {
    const scene = await holdingAPhoto();
    askBeforeLeaving(scene.win as never, () => {});
    expect(backOutOfLeaving()).toBe(true);
    expect(scene.veil()).toBeNull();
    expect(holdsUpload(scene.view as never)).toBe(true);
    expect(await discarded()).toEqual([]);
  });

  test("confirming hands the held key to the route, then leaves", async () => {
    const scene = await holdingAPhoto();
    const order: string[] = [];
    askBeforeLeaving(scene.win as never, () => {
      order.push(holdsUpload(scene.view as never) ? "left holding" : "left");
    });
    expect(goAheadAndLeave(scene.doc as never)).toBe(true);
    expect(order).toEqual(["left"]);
    expect(scene.veil()).toBeNull();
    expect(leavingIsBeingAsked()).toBe(false);
    expect(await discarded()).toEqual([scene.key]);
  });

  test("confirming stops a photo still uploading before it leaves", async () => {
    const scene = await openRecord();
    const upload = scene.pick("dusk.jpg");
    askBeforeLeaving(scene.win as never, () => {});
    goAheadAndLeave(scene.doc as never);
    expect(upload.aborted).toBe(true);
    expect(holdsUpload(scene.view as never)).toBe(false);
  });

  test("a second navigation while it stands is dropped, and focus goes back to it", async () => {
    const scene = await holdingAPhoto();
    let second = 0;
    askBeforeLeaving(scene.win as never, () => {});
    (scene.doc.querySelector("[data-record-back]") as El).focus();
    expect(askBeforeLeaving(scene.win as never, () => (second += 1))).toBe(true);
    expect(scene.doc.activeElement?.textContent).toBe(LEAVING_UNSAVED_BACK_OUT);
    goAheadAndLeave(scene.doc as never);
    expect(second).toBe(0);
  });

  test("a field typed into asks too, and one put back the way it was does not", async () => {
    const scene = await openRecord();
    const caption = scene.form.querySelector('[name="caption"]') as El & { value: string };
    scene.doc.fire("focusin", caption);
    const drawn = caption.value;
    caption.value = `${drawn} at dusk`;
    expect(askBeforeLeaving(scene.win as never, () => {})).toBe(true);
    backOutOfLeaving();
    caption.value = drawn;
    expect(askBeforeLeaving(scene.win as never, () => {})).toBe(false);
    expect(scene.veil()).toBeNull();
  });
});

describe("the form's own close", () => {
  test("asks, and a yes makes the same press, which goes back to the collection", async () => {
    const scene = await holdingAPhoto();
    const back = scene.view.querySelector("[data-record-back]") as El;
    expect(holdExit(exitPressed(back as never, scene.doc as never))).toBe(true);
    expect(scene.reads).toEqual([]);
    goAheadAndLeave(scene.doc as never);
    expect(scene.reads.map(({ path }) => path)).toEqual([capabilityUrl(CAPABILITY.id)]);
    expect(await discarded()).toEqual([scene.key]);
  });

  test("its Cancel asks too, and only about this form", async () => {
    const scene = await holdingAPhoto();
    const cancel = scene.view.querySelector("[data-record-cancel]") as El;
    const exit = exitPressed(cancel as never, scene.doc as never);
    expect(exit?.scope).toBe(scene.view);
    expect(holdExit(exit)).toBe(true);
  });

  test("closes without asking when nothing in the form changed", async () => {
    const scene = await openRecord();
    scene.doc.fire("focusin", scene.form.querySelector('[name="caption"]') as El);
    const back = scene.view.querySelector("[data-record-back]") as El;
    expect(holdExit(exitPressed(back as never, scene.doc as never))).toBe(false);
  });
});

describe("a save on its way", () => {
  /** The record's save sent, as htmx tells the page. */
  const send = (scene: Awaited<ReturnType<typeof holdingAPhoto>>) =>
    scene.doc.fire("htmx:beforeSend", scene.form, { detail: { elt: scene.form } });
  const answer = (
    scene: Awaited<ReturnType<typeof holdingAPhoto>>,
    successful: boolean,
    status: number,
  ) =>
    scene.doc.fire("htmx:afterRequest", scene.form, {
      detail: { elt: scene.form, successful, xhr: { status } },
    });

  test("carries the photo, so leaving asks nothing and gives the save's key to no one", async () => {
    const scene = await holdingAPhoto();
    send(scene);
    expect(askBeforeLeaving(scene.win as never, () => {})).toBe(false);
    releaseRegionContent(scene.view as never);
    answer(scene, false, 0);
    removed(scene.view);
    expect(await discarded()).toEqual([]);
  });

  test("hands the photo back to the form when the save is refused", async () => {
    const scene = await holdingAPhoto();
    send(scene);
    answer(scene, false, 422);
    expect(askBeforeLeaving(scene.win as never, () => {})).toBe(true);
  });

  test("hands it back too when the answer never came and the form still stands", async () => {
    const scene = await holdingAPhoto();
    send(scene);
    answer(scene, false, 0);
    expect(holdsUpload(scene.view as never)).toBe(true);
  });

  test("is the record form's own: another form's request carries nothing", async () => {
    const scene = await holdingAPhoto();
    const deleting = scene.view.querySelector("[data-record-delete-form]") as El;
    scene.doc.fire("htmx:beforeSend", deleting, { detail: { elt: deleting } });
    expect(holdsUpload(scene.view as never)).toBe(true);
  });

  test("leaves the photo the record's once it is saved", async () => {
    const scene = await holdingAPhoto();
    send(scene);
    answer(scene, true, 200);
    expect(holdsUpload(scene.view as never)).toBe(false);
    expect(await discarded()).toEqual([]);
  });
});
