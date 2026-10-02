// What a form's file controls hand back, in the product's own path: the field and the list the
// server draws, mounted, sending through the real upload transfer over a request double, with the
// page's one bookkeeping (`public/controls/held-uploads.js`) reporting to the pending-only route.

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { FILE_FIELD_HOOKS as HOOKS, mountFileFields, pickInto } from "#design/files/file-field.js";
import { mountFileLists, pickIntoList } from "#design/files/file-list.js";
import { keepSavedFileFields, uploadTransfer, wireFileFields } from "#shell/controls/file-field.js";
import { heldUploads, holdsUpload } from "#shell/controls/held-uploads.js";
import {
  CREATE_CANCELLED_EVENT,
  FILE_DISCARD_PATH,
  RECORD_CREATED_EVENT,
} from "#shell/core/shell-dom.js";
import { FILE_URL_PREFIX } from "../../../../platform/files/file-url.ts";
import { mintFileKey } from "../../../../platform/files/store/ledger.ts";
import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  photoSpec,
} from "../../../../registry/fields/file.test-support.ts";
import { renderCreateForm, renderEditForm } from "../../../fields/field-renderer.ts";
import { renderableFromSpec } from "../../../fields/renderable-capability.ts";
import { installDomGlobals } from "../../double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../../double/choice-picker.test-support.ts";
import { hooked } from "../file-field.test-support.ts";
import { UploadDouble } from "./held-uploads.test-support.ts";

installDomGlobals();
const had = Reflect.getOwnPropertyDescriptor(globalThis, "document");
afterAll(() => {
  if (had) Object.defineProperty(globalThis, "document", had);
  else Reflect.deleteProperty(globalThis, "document");
});

let discards: { path: string; init: RequestInit | undefined; keys: string[] }[] = [];
let fetchSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  discards = [];
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const { keys } = JSON.parse(String(init?.body)) as { keys: string[] };
    discards.push({ path: String(input), init, keys });
    return new Response(null, { status: 204 });
  }) as typeof fetch);
});
/** Every scene's document, forgotten after its case so the page's one bookkeeping starts empty. */
const scenes: Doc[] = [];
afterEach(() => {
  for (const doc of scenes.splice(0)) heldUploads.claimed(doc as never);
  fetchSpy.mockRestore();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every key sent to the pending-only route so far, once its requests have gone. */
async function given(): Promise<string[]> {
  await flush();
  return discards.flatMap(({ keys }) => keys);
}

const owned = () => {
  const key = mintFileKey();
  const photo = {
    url: `${FILE_URL_PREFIX}${key}`,
    name: "a.jpg",
    kind: "image",
    mime: "image/jpeg",
    size: 3,
  };
  return { key, photo };
};

/** A form the server drew, mounted and wired as the product mounts and wires it. */
function formScene(options: { record?: Record<string, unknown>; list?: boolean } = {}) {
  const doc = new Doc();
  scenes.push(doc);
  const fields = options.list ? [CAPTION_FIELD, ALBUM_FIELD] : undefined;
  const capability = { ...renderableFromSpec(photoSpec(fields)), incarnationId: "inc" };
  const { record } = options;
  parseHtml(record ? renderEditForm(capability, record) : renderCreateForm(capability), doc);
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  wireFileFields(doc as never);
  const uploads: UploadDouble[] = [];
  const transfer = uploadTransfer(() => {
    const upload = new UploadDouble();
    uploads.push(upload);
    return upload as never;
  });
  if (options.list) mountFileLists(doc as never, transfer);
  else mountFileFields(doc as never, transfer);
  const host = doc.querySelector(hooked(options.list ? HOOKS.list : HOOKS.field)) as El;
  const pick = (name: string) => {
    const file = new File([new Uint8Array(10)], name, { type: "image/jpeg" });
    const picked = { name, type: "image/jpeg", size: 10, file };
    if (options.list) pickIntoList(host as never, [picked]);
    else pickInto(host as never, picked);
    return uploads.at(-1) as UploadDouble;
  };
  /** Pick `name` and have the route admit it under a fresh key. */
  const land = async (name: string) => {
    const key = mintFileKey();
    pick(name).admit(key, name);
    await flush();
    return key;
  };
  return { doc, host, form: doc.querySelector("form") as El, pick, land };
}

describe("a photo picked and then replaced before the save", () => {
  test("goes to the pending-only route as soon as the next one lands", async () => {
    const scene = formScene();
    const first = await scene.land("dawn.jpg");
    expect(await given()).toEqual([]);
    const second = await scene.land("dusk.jpg");
    expect(await given()).toEqual([first]);
    expect(discards[0]?.path).toBe(FILE_DISCARD_PATH);
    expect(discards[0]?.init).toMatchObject({ method: "POST", keepalive: true });
    expect(await given()).not.toContain(second);
  });

  test("a pick replaced while it travels is stopped, and the one that lands is held", async () => {
    const scene = formScene();
    const late = scene.pick("dawn.jpg");
    const kept = await scene.land("dusk.jpg");
    expect(late.aborted).toBe(true);
    expect(await given()).toEqual([]);
    expect(holdsUpload(scene.form as never)).toBe(true);
    scene.doc.fire("click", scene.host.querySelector("[data-file-clear]") as El);
    expect(await given()).toEqual([kept]);
  });
});

describe("an unsaved upload the form stops holding", () => {
  test("goes back when the field is cleared", async () => {
    const scene = formScene();
    const key = await scene.land("dawn.jpg");
    expect(await given()).toEqual([]);
    scene.doc.fire("click", scene.host.querySelector("[data-file-clear]") as El);
    expect(await given()).toEqual([key]);
  });

  test("goes back when a create is put down, and stays when a create saves it", async () => {
    const cancelled = formScene();
    const dropped = await cancelled.land("dawn.jpg");
    expect(await given()).toEqual([]);
    cancelled.doc.fire(CREATE_CANCELLED_EVENT, cancelled.form);
    expect(await given()).toEqual([dropped]);

    const saved = formScene();
    await saved.land("dusk.jpg");
    saved.doc.fire(RECORD_CREATED_EVENT, saved.form);
    expect(await given()).toEqual([dropped]);
    expect(holdsUpload(saved.form as never)).toBe(false);
  });

  test("goes back when a list drops it, and a list's other files stay", async () => {
    const scene = formScene({ list: true });
    const dropped = await scene.land("one.jpg");
    const kept = await scene.land("two.jpg");
    expect(await given()).toEqual([]);
    scene.doc.fire("click", scene.host.querySelector("[data-file-list-remove]") as El);
    expect(await given()).toEqual([dropped]);
    expect(await given()).not.toContain(kept);
  });
});

describe("a key the record holds", () => {
  test("never goes to the route, whether drawn with the form or kept by its save", async () => {
    const drawn = owned();
    const scene = formScene({ record: { id: "r1", caption: "Dawn", photo: drawn.photo } });
    await scene.land("dusk.jpg");
    expect(holdsUpload(scene.form as never)).toBe(true);
    keepSavedFileFields(scene.form as never);
    expect(holdsUpload(scene.form as never)).toBe(false);
    scene.doc.fire("click", scene.host.querySelector("[data-file-clear]") as El);
    expect(await given()).toEqual([]);
  });

  test("never goes to the route from a list whose create saved it", async () => {
    const scene = formScene({ list: true });
    await scene.land("one.jpg");
    await scene.land("two.jpg");
    scene.doc.fire(RECORD_CREATED_EVENT, scene.form);
    expect(await given()).toEqual([]);
    expect(holdsUpload(scene.form as never)).toBe(false);
  });
});

describe("an answer the field never takes", () => {
  test("because its pick was replaced first, goes back once it has been heard", async () => {
    const scene = formScene();
    const late = scene.pick("dawn.jpg");
    const kept = await scene.land("dusk.jpg");
    const unheld = mintFileKey();
    late.admit(unheld, "dawn.jpg");
    expect(await given()).toEqual([unheld]);
    expect(await given()).not.toContain(kept);
  });
});
