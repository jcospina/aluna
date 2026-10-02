// Deleting a record whose open form holds an upload (Module 7 PLAN decision 19): the record view's
// real swap and mutation rules on a photos record, the form's photo field mounted over the real
// upload transfer, and the upload handed back once the deleted record's view is off the page.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { FILE_FIELD_HOOKS as HOOKS, mountFileFields, pickInto } from "#design/files/file-field.js";
import { uploadTransfer, wireFileFields } from "#shell/controls/file-field.js";
import { heldUploads } from "#shell/controls/held-uploads.js";
import { releaseRegionContent, startRegionScopes } from "#shell/core/region-scope.js";
import { capabilityActionUrl } from "#shell/core/routes.js";
import { mintFileKey } from "../../../../platform/files/store/ledger.ts";
import { photoSpec } from "../../../../registry/fields/file.test-support.ts";
import { renderableFromSpec } from "../../../fields/renderable-capability.ts";
import { named } from "../../../records/collection/collection-page.test-support.ts";
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
import { Doc, type El, parseHtml } from "../../double/choice-picker.test-support.ts";
import { hooked } from "../file-field.test-support.ts";
import { UploadDouble } from "./held-uploads.test-support.ts";

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

/** What the page's removal observer is told; a case tells it what the browser would. */
let observers: ((records: { removedNodes: unknown[] }[]) => void)[] = [];
const hadObserver = Reflect.getOwnPropertyDescriptor(globalThis, "MutationObserver");
beforeEach(() => {
  observers = [];
  class ObserverDouble {
    constructor(tell: (records: { removedNodes: unknown[] }[]) => void) {
      observers.push(tell);
    }
    observe() {}
  }
  Object.defineProperty(globalThis, "MutationObserver", {
    value: ObserverDouble,
    configurable: true,
  });
});
afterEach(() => {
  if (hadObserver) Object.defineProperty(globalThis, "MutationObserver", hadObserver);
  else Reflect.deleteProperty(globalThis, "MutationObserver");
});

/** The browser telling the page that `removed` left the document. */
const removed = (node: unknown) => {
  for (const tell of observers) tell([{ removedNodes: [node] }]);
};

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
afterEach(() => fetchSpy.mockRestore());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The photos record open on a desk, a new photo uploaded into its form, and the question asked. */
async function holdingAnUpload() {
  const desk = await recordDesk(COLLECTION, {
    capabilityId: CAPABILITY.id,
    modules: ["records/record-view.js", "records/record-mutations.js"],
  });
  desk.press(desk.doc.getElementById(itemElementIdForTemplate(TEMPLATE_ID)) as El);
  await desk.settled();
  const view = desk.doc.querySelector(`[${RECORD_VIEW_ATTR}]`) as El;
  startRegionScopes(desk.doc.body as never);
  // The drawn control listens on the page's window for a file dragged outside a field.
  Object.assign(standingWindow(), { addEventListener: () => {} });
  wireFileFields(desk.doc as never);
  const upload = new UploadDouble();
  mountFileFields(
    desk.doc as never,
    uploadTransfer(() => upload as never),
  );
  const field = view.querySelector(hooked(HOOKS.field)) as El;
  const file = new File([new Uint8Array(10)], "dusk.jpg", { type: "image/jpeg" });
  pickInto(field as never, { name: "dusk.jpg", type: "image/jpeg", size: 10, file });
  const key = mintFileKey();
  upload.admit(key, "dusk.jpg");
  await flush();
  const question = view.querySelector(
    `form[hx-post="${capabilityActionUrl(CAPABILITY.id, "delete")}"]`,
  ) as El;
  desk.press(named(view, "button", "Delete"));
  desk.doc.fire("htmx:beforeRequest", question, { detail: { elt: question } });
  /** The delete's answer, as htmx hands it to the page. */
  const answered = (successful: boolean, status: number) =>
    desk.doc.fire("htmx:afterRequest", question, {
      detail: { elt: question, successful, xhr: { status } },
    });
  return { desk, view, question, key, answered };
}

/** Every key the pending-only route was handed, once the requests have gone. */
async function discarded(): Promise<string[]> {
  await flush();
  return given.flat();
}

describe("deleting a record whose form holds an upload", () => {
  let desk: Awaited<ReturnType<typeof recordDesk>> | undefined;
  afterEach(() => {
    if (desk) heldUploads.claimed(desk.doc as never);
    desk?.restore();
  });

  test("hands the upload back once the deleted record's view leaves the page", async () => {
    const scene = await holdingAnUpload();
    desk = scene.desk;
    expect(heldUploads.holdsUpload(scene.view as never)).toBe(true);

    scene.answered(true, 200);
    expect(await discarded()).toEqual([]);

    scene.desk.region.replaceChildren(...parseHtml(COLLECTION, new Doc()).children);
    removed(scene.view);
    expect(await discarded()).toEqual([scene.key]);
    expect(heldUploads.holdsUpload(scene.view as never)).toBe(false);
  });

  test("keeps the upload while a refused delete leaves the record standing", async () => {
    const scene = await holdingAnUpload();
    desk = scene.desk;
    scene.answered(false, 409);
    releaseRegionContent(scene.view as never);
    removed(scene.question);
    expect(await discarded()).toEqual([]);
    expect(heldUploads.holdsUpload(scene.view as never)).toBe(true);
  });
});
