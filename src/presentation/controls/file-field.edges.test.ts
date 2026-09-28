// The photo control's product half at its edges: answers the upload route never sends on purpose,
// a field drawn without its cap, the transfer's own events, and the module started on a page,
// mounting the fields there now and every field that lands later. Run through the real
// `public/file-field.js` over a request double, since Bun has no XMLHttpRequest.

import { afterAll, describe, expect, test } from "bun:test";

import { FILE_FIELD_HOOKS, FileRefusal, pickInto, uploadingIn } from "#design/file-field.js";
import { settleUpload, uploadTransfer } from "#shell/file-field.js";
import { regionScopeReport } from "#shell/region-scope.js";
import { FILE_FIELD_ATTRIBUTES } from "#shell/shell-dom.js";
import { oversizeSentence } from "../../platform/files/refusal-copy.ts";
import { photoSpec } from "../../registry/fields/file.test-support.ts";
import { renderCreateForm } from "../fields/field-renderer.ts";
import { renderableFromSpec } from "../fields/renderable-capability.ts";
import { installDomGlobals } from "./choice-picker.fixture.test-support.ts";
import { Doc, El, parseHtml } from "./choice-picker.test-support.ts";
import { hooked, travelling } from "./file-field.test-support.ts";
import { startedOn } from "./started-module.test-support.ts";

installDomGlobals();

const CAP = 1024;
const LIMITS = { cap: CAP, oversize: oversizeSentence(CAP) };
const ADMITTED = { key: "k1", url: "/files/k1", name: "dawn.jpg", size: 9 };

/** What a settle does with an answer: the file it admits, the refusal it says, or the failure. */
function outcome(status: number, body: string) {
  try {
    return { admitted: settleUpload(status, body, LIMITS) };
  } catch (error) {
    if (error instanceof FileRefusal) return { refused: [error.code, error.sentence] };
    return { failed: (error as Error).message };
  }
}

describe("answers the upload route never sends on purpose", () => {
  test("a body that is not an object is no answer at all", () => {
    for (const body of ["null", "42", '"words"']) {
      expect(outcome(409, body)).toEqual({ failed: "The upload failed with status 409." });
    }
  });

  test("only a 201 admits, and only with every part of the file named", () => {
    expect(outcome(200, JSON.stringify(ADMITTED))).toEqual({
      failed: "The upload failed with status 200.",
    });
    for (const broken of [{ key: 1 }, { url: 1 }, { name: 1 }, { size: "9" }, { size: 9.5 }]) {
      expect(outcome(201, JSON.stringify({ ...ADMITTED, ...broken }))).toEqual({
        failed: "The upload failed with status 201.",
      });
    }
  });

  test("only a 409 or 415 refuses, with a named refusal and a sentence to say", () => {
    const refusal = { refusal: "gone", message: "Add it again." };
    expect(outcome(400, JSON.stringify(refusal))).toEqual({
      failed: "The upload failed with status 400.",
    });
    expect(outcome(409, JSON.stringify({ ...refusal, refusal: 7 }))).toEqual({
      failed: "The upload failed with status 409.",
    });
    for (const message of ["", 5]) {
      expect(outcome(409, JSON.stringify({ ...refusal, message }))).toEqual({
        failed: "The upload failed with status 409.",
      });
    }
    expect(outcome(413, "")).toEqual({ refused: ["too_large", LIMITS.oversize] });
  });
});

/** A request that records what it was asked, and answers when told. */
class Request {
  static made: Request[] = [];
  readonly listeners = new Map<string, (() => void)[]>();
  readonly progress: [string, (event: { loaded: number }) => void][] = [];
  status = 0;
  responseText = "";
  opened: unknown;
  readonly upload = {
    addEventListener: (type: string, run: (event: { loaded: number }) => void) => {
      this.progress.push([type, run]);
    },
  };
  constructor() {
    Request.made.push(this);
  }
  addEventListener(type: string, run: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), run]);
  }
  open(method: string, url: string) {
    this.opened = [method, url];
  }
  setRequestHeader() {}
  send() {}
  abort() {
    this.fire("abort");
  }
  fire(type: string) {
    for (const run of this.listeners.get(type) ?? []) run();
  }
  answer(status: number, body: string, type = "load") {
    Object.assign(this, { status, responseText: body });
    this.fire(type);
  }
}

/** A field as the transfer reads one: its address, its cap and the sentence for going over it. */
function field(attributes: Record<string, string | null> = {}) {
  const all: Record<string, string | null> = {
    [FILE_FIELD_ATTRIBUTES.upload]: "/upload/photo",
    [FILE_FIELD_ATTRIBUTES.cap]: String(CAP),
    [FILE_FIELD_ATTRIBUTES.oversize]: LIMITS.oversize,
    ...attributes,
  };
  const element = {
    id: "photo-field",
    getAttribute: (name: string) => all[name] ?? null,
    isConnected: true,
    contains: (other: unknown) => other === element,
    closest: () => null,
  };
  return element as never;
}

const picked = (size = 10) => ({
  name: "dawn.jpg",
  type: "image/jpeg",
  size,
  file: new File([new Uint8Array(size)], "dawn.jpg"),
});

function sending(host = field()) {
  const request = new Request();
  const seen: number[] = [];
  const upload = uploadTransfer(() => request as never)(
    picked(),
    "image",
    (loaded) => seen.push(loaded),
    host,
  );
  return { request, upload, seen };
}

describe("a field drawn without what it needs to hold its files to", () => {
  test("no cap, a cap of nothing, a cap that is not a whole number, or no sentence: it says so", () => {
    const broken: Record<string, string | null>[] = [
      { [FILE_FIELD_ATTRIBUTES.cap]: null },
      { [FILE_FIELD_ATTRIBUTES.cap]: "0" },
      { [FILE_FIELD_ATTRIBUTES.cap]: "1.5" },
      { [FILE_FIELD_ATTRIBUTES.oversize]: null },
    ];
    for (const attributes of broken) {
      expect(() => sending(field(attributes))).toThrow(/photo-field.*carries no cap/);
    }
  });
});

describe("the transfer's own events", () => {
  test("a file over the cap is refused as too large, in the field's own sentence", async () => {
    const over = uploadTransfer(() => new Request() as never)(
      picked(CAP + 1),
      "image",
      () => {},
      field(),
    );
    const refusal = (await over.done.catch((error) => error)) as FileRefusal;
    expect([refusal.code, refusal.sentence]).toEqual(["too_large", LIMITS.oversize]);
  });

  test("an answer that fails, or a connection that errors, rejects the upload", async () => {
    const failing = sending();
    failing.request.answer(500, "boom");
    await expect(failing.upload.done).rejects.toThrow(/status 500/);
    const erroring = sending();
    erroring.request.answer(0, "", "error");
    await expect(erroring.upload.done).rejects.toThrow(/status 0/);
  });

  test("a stopped upload rejects as an abort that says what happened", async () => {
    const stopped = sending();
    stopped.upload.abort();
    const error = (await stopped.upload.done.catch((caught) => caught)) as DOMException;
    expect([error.name, error.message === ""]).toEqual(["AbortError", false]);
  });

  test("progress is heard off the upload's own progress, and the claim goes once it settles", async () => {
    const uploads = () => regionScopeReport().filter(({ label }) => label === "file upload").length;
    const before = uploads();
    const moving = sending();
    expect(moving.request.progress.map(([type]) => type)).toEqual(["progress"]);
    expect(uploads()).toBe(before + 1);
    moving.request.answer(201, JSON.stringify(ADMITTED));
    await moving.upload.done;
    expect(uploads()).toBe(before);
  });
});

describe("the module on a page", () => {
  const host = globalThis as Record<string, unknown>;
  const standing = ["document", "XMLHttpRequest"].map(
    (name) => [name, Reflect.getOwnPropertyDescriptor(host, name)] as const,
  );
  afterAll(() => {
    for (const [name, descriptor] of standing) {
      if (descriptor) Object.defineProperty(host, name, descriptor);
      else Reflect.deleteProperty(host, name);
    }
  });

  const photoForm = () =>
    renderCreateForm({ ...renderableFromSpec(photoSpec()), incarnationId: "inc" });

  /** A page holding `markup`, with the module started on it and its requests kept. */
  async function page(markup: string, prepare: (root: El) => void = () => {}) {
    const doc = new Doc();
    const root = new El("html");
    doc.append(root);
    parseHtml(markup, root);
    prepare(root);
    Object.defineProperty(host, "document", { value: doc, configurable: true, writable: true });
    Object.defineProperty(host, "XMLHttpRequest", {
      value: Request,
      configurable: true,
      writable: true,
    });
    Request.made = [];
    let refused: unknown = null;
    await startedOn("file-field.js", doc).catch((error) => {
      refused = error;
    });
    Object.defineProperty(host, "document", { value: doc, configurable: true, writable: true });
    return { doc, root, refused };
  }

  const fieldsIn = (root: El) => root.querySelectorAll(hooked(FILE_FIELD_HOOKS.field));
  const take = (field: El) => pickInto(field as never, picked());

  test("mounts the fields already there, which then send what they are given", async () => {
    const { root } = await page(photoForm());
    const [photo] = fieldsIn(root) as [El];
    take(photo);
    expect(Request.made).toHaveLength(1);
    expect(uploadingIn(root.querySelector("form") as never)).toBe(true);
  });

  test("a field drawn without its cap refuses, and the field beside it is still mounted", async () => {
    const { root, refused } = await page(`${photoForm()}${photoForm()}`, (drawn) => {
      (fieldsIn(drawn)[0] as El).removeAttribute(FILE_FIELD_ATTRIBUTES.cap);
    });
    expect(String(refused)).toMatch(/carries no cap/);
    take(fieldsIn(root)[1] as El);
    expect(Request.made).toHaveLength(1);
  });

  test("a form that lands later is mounted too, and a refusing one says so after its neighbour", async () => {
    const { doc, root } = await page("");
    const arriving = parseHtml(`${photoForm()}${photoForm()}`, new El("div"));
    const [broken, whole] = fieldsIn(arriving) as [El, El];
    broken.removeAttribute(FILE_FIELD_ATTRIBUTES.cap);
    root.append(arriving);
    await doc.arrivals();
    expect(doc.reported).toHaveLength(1);
    take(whole);
    expect(Request.made).toHaveLength(1);
  });

  test("a field that lands on its own is mounted as it lands", async () => {
    const { doc, root } = await page("");
    const holder = parseHtml(photoForm(), new El("div"));
    const [photo] = fieldsIn(holder) as [El];
    const shell = new El("section");
    root.append(shell);
    await doc.arrivals();
    shell.append(photo);
    await doc.arrivals();
    take(photo);
    expect(Request.made).toHaveLength(1);
  });

  test("a submission while a file travels stands the person on the save, visibly", async () => {
    const { doc, root } = await page(photoForm());
    const { mountFileFields } = await import("#design/file-field.js");
    mountFileFields(root as never, travelling);
    const [photo] = fieldsIn(root) as [El];
    pickInto(photo as never, picked());
    const form = root.querySelector("form") as El;
    expect(doc.fire("submit", form).prevented).toBe(true);
    expect(doc.activeElement.focusOptions).toEqual({ focusVisible: true });
  });
});
