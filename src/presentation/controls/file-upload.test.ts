// The photo control's product half (`public/file-field.js`): the value a form posts for what the
// field holds, what each answer of the upload route means, and the transfer itself, driven through
// a request double, since what Bun lacks here is the browser, not the rules.

import { describe, expect, test } from "bun:test";

import { FILE_FIELD_CHANGE, FileRefusal } from "#design/file-field.js";
import {
  admittedKey,
  postedValue,
  settleUpload,
  uploadTransfer,
  wireFileFields,
} from "#shell/file-field.js";
import { setPending, thawFileFields } from "#shell/record-mutations.js";
import { regionScopeReport, releaseRegionContent } from "#shell/region-scope.js";
import { BUSY_LABEL_ATTRIBUTE, FILE_NAME_HEADER } from "#shell/shell-dom.js";
import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";
import { mintFileKey } from "../../platform/files/ledger.ts";
import {
  ADD_FILE_AGAIN_SENTENCE,
  NOT_ADMITTED_SENTENCES,
  oversizeSentence,
} from "../../platform/files/refusal-copy.ts";
import { photoSpec } from "../../registry/fields/file.test-support.ts";
import { renderCreateForm, renderEditForm } from "../fields/field-renderer.ts";
import { renderableFromSpec } from "../fields/renderable-capability.ts";
import { installDomGlobals } from "./choice-picker.fixture.test-support.ts";
import { Doc, El, parseHtml } from "./choice-picker.test-support.ts";

const CAP = 1024;
const LIMITS = { cap: CAP, oversize: oversizeSentence(CAP) };
const KEPT = { name: "kept.jpg", size: 3, url: "/files/kept" };
const TAKEN = { name: "taken.jpg", size: 3, url: "/files/taken" };
const DRAWN = { held: "kept-key", clear: "__clear" };

const keyOf = (held: object) => (held === TAKEN ? "taken-key" : undefined);

describe("what a photo field posts", () => {
  test("on a create: nothing until it takes a photo, then that photo's key, and nothing again", () => {
    const create = { held: "", clear: DRAWN.clear };
    expect(postedValue(null, create, keyOf)).toBe("");
    expect(postedValue(TAKEN, create, keyOf)).toBe("taken-key");
  });

  test("on an edit: the key it was drawn with, a replacement's, or the clear", () => {
    expect(postedValue(KEPT, DRAWN, keyOf)).toBe(DRAWN.held);
    expect(postedValue(TAKEN, DRAWN, keyOf)).toBe("taken-key");
    expect(postedValue(null, DRAWN, keyOf)).toBe(DRAWN.clear);
  });

  test("a file an upload answered for posts its key whatever the field was drawn holding", () => {
    expect(postedValue(TAKEN, { held: "", clear: DRAWN.clear }, keyOf)).toBe("taken-key");
    expect(postedValue(TAKEN, DRAWN, keyOf)).not.toBe(DRAWN.held);
  });
});

function refusalOf(run: () => unknown): FileRefusal {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FileRefusal);
    return error as FileRefusal;
  }
  throw new Error("nothing was refused");
}

describe("what the upload route's answer means", () => {
  test("an admitted file is held at the address it answered with, under its key", () => {
    const body = JSON.stringify({ key: "k1", url: "/files/k1", name: "dawn.jpg", size: 9 });
    expect(settleUpload(201, body, 9, LIMITS)).toEqual({
      held: { name: "dawn.jpg", size: 9, url: "/files/k1" },
      key: "k1",
    });
  });

  test("a refusal the route wrote is said in its own words", () => {
    const notAPhoto = JSON.stringify({
      refusal: "signature",
      message: NOT_ADMITTED_SENTENCES.image,
    });
    expect(refusalOf(() => settleUpload(415, notAPhoto, 9, LIMITS)).sentence).toBe(
      NOT_ADMITTED_SENTENCES.image,
    );
    const gone = JSON.stringify({ refusal: "gone", message: ADD_FILE_AGAIN_SENTENCE });
    expect(refusalOf(() => settleUpload(409, gone, 9, LIMITS))).toMatchObject({
      code: "gone",
      sentence: ADD_FILE_AGAIN_SENTENCE,
    });
  });

  test("Bun's bare 413, and a severed send of a file over the cap, say the size sentence", () => {
    expect(refusalOf(() => settleUpload(413, "", 9, LIMITS)).sentence).toBe(LIMITS.oversize);
    expect(refusalOf(() => settleUpload(0, "", CAP + 1, LIMITS)).sentence).toBe(LIMITS.oversize);
  });

  test("anything else is a failure, which the control says in its own sentence", () => {
    for (const [status, body] of [
      [0, ""],
      [404, ""],
      [500, "boom"],
      [201, JSON.stringify({ key: "k1" })],
      [415, JSON.stringify({ refusal: "signature" })],
    ] as const) {
      expect(() => settleUpload(status, body, 9, LIMITS)).toThrow(/status/);
      expect(() => settleUpload(status, body, 9, LIMITS)).not.toThrow(FileRefusal);
    }
  });
});

class RequestDouble {
  opened: [string, string] | undefined;
  readonly headers = new Map<string, string>();
  sent: unknown;
  aborted = false;
  status = 0;
  responseText = "";
  private readonly listeners = new Map<string, (() => void)[]>();
  private readonly progress: ((event: { loaded: number }) => void)[] = [];
  readonly upload = {
    addEventListener: (_type: string, run: (event: { loaded: number }) => void) => {
      this.progress.push(run);
    },
  };

  addEventListener(type: string, run: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), run]);
  }
  open(method: string, url: string): void {
    this.opened = [method, url];
  }
  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
  send(body: unknown): void {
    this.sent = body;
  }
  abort(): void {
    this.aborted = true;
    this.fire("abort");
  }
  answer(status: number, body: string): void {
    Object.assign(this, { status, responseText: body });
    this.fire("load");
  }
  moved(loaded: number): void {
    for (const run of this.progress) run({ loaded });
  }
  private fire(type: string): void {
    for (const run of this.listeners.get(type) ?? []) run();
  }
}

type Host = Parameters<ReturnType<typeof uploadTransfer>>[3];

function host(upload: string | null = "/capability/photos/inc/upload/photo"): Host {
  const element = {
    dataset: {
      ...(upload === null ? {} : { fileUpload: upload }),
      fileCap: String(CAP),
      fileOversize: LIMITS.oversize,
    },
    isConnected: true,
    contains: (other: unknown) => other === element,
    closest: () => null,
  };
  return element as unknown as Host;
}

function pick(name: string, size: number, type = "image/jpeg") {
  return { name, type, size, file: new File([new Uint8Array(size)], name, { type }) };
}

function start(
  picked: ReturnType<typeof pick>,
  field = host(),
): {
  request: RequestDouble;
  upload: ReturnType<ReturnType<typeof uploadTransfer>>;
  seen: number[];
} {
  const request = new RequestDouble();
  const seen: number[] = [];
  const transfer = uploadTransfer(
    () => request as unknown as ReturnType<Parameters<typeof uploadTransfer>[0]>,
  );
  const upload = transfer(picked, "image", (loaded) => seen.push(loaded), field);
  return { request, upload, seen };
}

describe("the transfer", () => {
  test("posts the raw file to the field's address, its name encoded and its own type declared", () => {
    const picked = pick("日本 dawn.jpg", 10);
    const { request } = start(picked);
    expect(request.opened).toEqual(["POST", "/capability/photos/inc/upload/photo"]);
    expect(request.headers.get(FILE_NAME_HEADER)).toBe(encodeURIComponent(picked.name));
    expect(request.headers.get("Content-Type")).toBe("image/jpeg");
    expect(request.sent).toBe(picked.file);
  });

  test("declares no type for a file the browser could not name one for", () => {
    const { request } = start(pick("scan.jpg", 10, ""));
    expect(request.headers.has("Content-Type")).toBe(false);
  });

  test("moves the progress line as the bytes leave", () => {
    const { request, seen } = start(pick("dawn.jpg", 10));
    request.moved(4);
    request.moved(10);
    expect(seen).toEqual([4, 10]);
  });

  test("settles with the file as served, and the key it answered with is the one posted", async () => {
    const { request, upload } = start(pick("dawn.jpg", 10));
    request.answer(
      201,
      JSON.stringify({ key: "k9", url: "/files/k9", name: "dawn.jpg", size: 10 }),
    );
    const held = await upload.done;
    expect(held).toEqual({ name: "dawn.jpg", size: 10, url: "/files/k9" });
    expect(admittedKey(held)).toBe("k9");
  });

  test("refuses a file over the cap before a byte leaves, and sends one at the cap", async () => {
    const over = start(pick("big.jpg", CAP + 1));
    expect(over.request.opened).toBeUndefined();
    expect(await over.upload.done.catch((error: FileRefusal) => error.sentence)).toBe(
      LIMITS.oversize,
    );
    expect(start(pick("full.jpg", CAP)).request.opened).toBeDefined();
  });

  test("stops when the field stops it, or when the field leaves the page", async () => {
    const stopped = start(pick("dawn.jpg", 10));
    stopped.upload.abort();
    expect(stopped.request.aborted).toBe(true);
    expect(await stopped.upload.done.catch((error: Error) => error.name)).toBe("AbortError");

    const uploads = () => regionScopeReport().filter(({ label }) => label === "file upload").length;
    const before = uploads();
    const field = host();
    const left = start(pick("dawn.jpg", 10), field);
    expect(uploads()).toBe(before + 1);
    releaseRegionContent(field);
    expect(left.request.aborted).toBe(true);
    await left.upload.done.catch(() => undefined);
    expect(uploads()).toBe(before);
  });

  test("a field with nowhere to send a file fails without opening a request", async () => {
    const { request, upload } = start(pick("dawn.jpg", 10), host(null));
    expect(request.opened).toBeUndefined();
    await expect(upload.done).rejects.toThrow("nowhere to send");
  });
});

/* ── the wiring around the drawn control ───────────────────────────────────── */

installDomGlobals();

function formScene(record?: Readonly<Record<string, unknown>>) {
  const doc = new Doc();
  const root = new El("html");
  doc.append(root);
  const capability = { ...renderableFromSpec(photoSpec()), incarnationId: "inc" };
  parseHtml(record ? renderEditForm(capability, record) : renderCreateForm(capability), root);
  const settled: [unknown, string][] = [];
  const settle = (form: unknown, how: string) => settled.push([form, how]);
  wireFileFields(doc as never, settle as never);
  const one = (selector: string) => doc.querySelector(selector) as El;
  const host = one("[data-file-field]");
  const change = (current: object | null) =>
    doc.fire(FILE_FIELD_CHANGE, host, { detail: { saved: null, current, uploading: false } });
  return { doc, host, form: one("form"), value: one("[data-file-value]"), one, settled, change };
}

async function answeredHeld(key: string) {
  const { request, upload } = start(pick("dawn.jpg", 10));
  request.answer(201, JSON.stringify({ key, url: `/files/${key}`, name: "dawn.jpg", size: 10 }));
  return upload.done;
}

describe("the form around a photo field", () => {
  test("posts the key an upload answered with, and nothing once a create's photo is cleared", async () => {
    const scene = formScene();
    scene.change(await answeredHeld("k7"));
    expect(scene.value.value).toBe("k7");
    scene.change(null);
    expect(scene.value.value).toBe("");
  });

  test("posts the drawn key while an edit holds its photo, and the drawn clear once it does not", () => {
    const key = mintFileKey();
    const photo = {
      url: `${FILE_URL_PREFIX}${key}`,
      name: "a.jpg",
      kind: "image",
      mime: "image/jpeg",
      size: 3,
    };
    const scene = formScene({ id: "r1", caption: "Dawn", photo });
    expect(scene.value.value).toBe(key);
    scene.change(null);
    expect(scene.value.value).toBe(scene.value.getAttribute("data-file-clear-value") ?? "absent");
    scene.change({ ...KEPT });
    expect(scene.value.value).toBe(key);
  });

  test("puts the field back when a create is saved or put down", () => {
    const scene = formScene();
    scene.doc.fire("aluna:record-created", scene.form);
    scene.doc.fire("aluna:create-cancelled", scene.one("[data-create-cancel]"));
    expect(scene.settled).toEqual([
      [scene.form, "revert"],
      [scene.form, "revert"],
    ]);
  });

  test("refuses a submission while a file travels, before htmx hears it, and stands on the save", () => {
    const scene = formScene();
    const posted: unknown[] = [];
    scene.form.addEventListener("submit", (event) => posted.push(event));
    expect(scene.doc.fire("submit", scene.form).prevented).toBe(false);

    parseHtml("<span data-file-progress></span>", scene.one("[data-file-body]"));
    const refused = scene.doc.fire("submit", scene.form);
    expect(refused).toEqual({ prevented: true, stopped: true });
    expect(posted).toHaveLength(1);
    expect(scene.doc.activeElement).toBe(scene.one("[data-held-save]"));
  });

  test("while a save is out, says so in the save's own label and takes no pick until refused", () => {
    const scene = formScene();
    const save = scene.one("[data-held-save]");
    const label = scene.one("[data-held-save-label]");
    const idle = label.textContent;
    setPending(scene.form as never, true, "[data-create-cancel]");
    expect(label.textContent).toBe(save.getAttribute(BUSY_LABEL_ATTRIBUTE) ?? "absent");
    expect(scene.one("[data-held-save-label]")).toBe(label);
    expect((scene.host as unknown as { inert: boolean }).inert).toBe(true);

    thawFileFields({ detail: { elt: scene.form, xhr: { status: 200 } } } as never);
    expect((scene.host as unknown as { inert: boolean }).inert).toBe(true);
    thawFileFields({ detail: { elt: scene.form, xhr: { status: 422 } } } as never);
    expect((scene.host as unknown as { inert: boolean }).inert).toBe(false);
    setPending(scene.form as never, false, "[data-create-cancel]");
    expect(label.textContent).toBe(idle);
  });
});
