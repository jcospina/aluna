// A field that holds many files in the product's own path: the list the server draws, filled by the
// drawn control (`design/scripts/files/file-list.js`), and what the form posts for it
// (`public/controls/file-field.js`), driven through the DOM double with a transfer double.

import { afterAll, describe, expect, test } from "bun:test";

import {
  FILE_FIELD_HOOKS as HOOKS,
  type Picked,
  settleFileFields,
  type Transfer,
  uploadingIn,
} from "#design/files/file-field.js";
import { mountFileLists, overCapSentence, pickIntoList } from "#design/files/file-list.js";
import { listedKey, postedKeys, wireFileFields } from "#shell/controls/file-field.js";
import { FILE_FIELD_ATTRIBUTES as WIRE } from "#shell/core/shell-dom.js";
import { missingRequiredValues, relocateFieldError } from "#shell/fields/field-errors.js";
import { WORD_DOCUMENT_TYPE } from "../../../platform/files/admission/documents/word-package.ts";
import { resolveMaxListFiles } from "../../../platform/files/file-cap.ts";
import { FILE_URL_PREFIX } from "../../../platform/files/file-url.ts";
import { mintFileKey } from "../../../platform/files/store/ledger.ts";
import { fileUploadPath } from "../../../platform/files/upload-path.ts";
import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  photoSpec,
} from "../../../registry/fields/file.test-support.ts";
import type { SpecField } from "../../../registry/index.ts";
import { FILE_REMOVE_PREFIX } from "../../../runtime/data/index.ts";
import { renderCreateForm, renderEditForm } from "../../fields/field-renderer.ts";
import { renderableFromSpec } from "../../fields/renderable-capability.ts";
import { installDomGlobals } from "../double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";
import { standInMedia } from "../recorder/file-recorder.test-support.ts";
import { hooked } from "./file-field.test-support.ts";

installDomGlobals();
const had = Reflect.getOwnPropertyDescriptor(globalThis, "document");
afterAll(() => {
  if (had) Object.defineProperty(globalThis, "document", had);
  else Reflect.deleteProperty(globalThis, "document");
});

const file = (name: string, mime: string, kind = "document") => {
  const key = mintFileKey();
  return { key, projection: { url: `${FILE_URL_PREFIX}${key}`, name, kind, mime, size: 2_048 } };
};

const PDF = file("Kettle manual.pdf", "application/pdf");
const DOCX = file("Garantía.docx", WORD_DOCUMENT_TYPE);
const PHOTO = file("label.jpg", "image/jpeg", "image");

/** One upload the list set off, which a case answers, refuses, or sees stopped. */
interface Sent {
  readonly picked: Picked;
  aborted: boolean;
  land(key: string): void;
}

/** A form holding one `file[]`, drawn by the server, mounted, and wired as the product wires it. */
function listScene(held?: readonly (typeof PDF)[], album: SpecField = ALBUM_FIELD, count?: number) {
  const doc = new Doc();
  const capability = {
    ...renderableFromSpec(photoSpec([CAPTION_FIELD, album])),
    incarnationId: "inc-7",
  };
  const record = held && {
    id: "r1",
    caption: "Kettle",
    album: held.map((each) => each.projection),
  };
  parseHtml(record ? renderEditForm(capability, record) : renderCreateForm(capability), doc);
  if (count !== undefined) {
    (doc.querySelector(hooked(HOOKS.list)) as El).setAttribute(HOOKS.count, String(count));
  }
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  wireFileFields(doc as never);
  const sent: Sent[] = [];
  const transfer: Transfer = (picked) => {
    let land = (_key: string) => {};
    let stop = () => {};
    const done = new Promise<{ name: string; size: number; url: string }>((resolve, reject) => {
      land = (key) => resolve({ name: picked.name, size: picked.size, url: `/files/${key}` });
      stop = () => reject(new DOMException("The upload was stopped.", "AbortError"));
    });
    const entry: Sent = { picked, aborted: false, land };
    sent.push(entry);
    return {
      done,
      abort: () => {
        entry.aborted = true;
        stop();
      },
    };
  };
  const media = standInMedia();
  mountFileLists(doc as never, transfer, { recorder: media.env });
  const host = doc.querySelector(hooked(HOOKS.list)) as El;
  const form = doc.querySelector("form") as El;
  const posted = () =>
    (host.querySelector(hooked(WIRE.keys))?.querySelectorAll("input") ?? []).map(
      (input) => (input as El & { value: string }).value,
    );
  const pick = (...names: string[]) =>
    pickIntoList(
      host as never,
      names.map((name) => ({ name, type: "image/jpeg", size: 10 })),
    );
  /** A person's press, a moment after the last change, as the list asks. */
  const press = (selector: string) => {
    media.tick(1_000);
    const target = host.querySelector(selector) as El;
    target.focus();
    return doc.fire("click", target);
  };
  return { doc, host, form, sent, posted, pick, press, media };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the list the server draws", () => {
  test("is a list host that takes the configured count, never a single field", () => {
    const { host } = listScene();
    expect(host.getAttribute(HOOKS.count)).toBe(String(resolveMaxListFiles()));
    expect(host.getAttribute(HOOKS.kind)).toBe("image document");
    expect(host.matches(hooked(HOOKS.field))).toBe(false);
    expect(host.getAttribute(WIRE.upload)).toBe(
      fileUploadPath("photos", "inc-7", ALBUM_FIELD.name),
    );
  });

  test("opens holding its files in order, each with the type admission verified", () => {
    const { host, posted } = listScene([PDF, DOCX, PHOTO]);
    const holds = JSON.parse(host.getAttribute(HOOKS.holds) ?? "[]") as { type: string }[];
    expect(holds.map((each) => each.type)).toEqual([
      "application/pdf",
      WORD_DOCUMENT_TYPE,
      "image/jpeg",
    ]);
    expect(posted()).toEqual([PDF.key, DOCX.key, PHOTO.key]);
  });

  test("a PDF in it opens in a tab that can't reach back, and a Word file downloads", () => {
    const { host } = listScene([PDF, DOCX]);
    const links = host.querySelectorAll("a[href]") as El[];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      PDF.projection.url,
      DOCX.projection.url,
    ]);
    const [open, download] = links;
    expect(open?.getAttribute("target")).toBe("_blank");
    expect(open?.getAttribute("rel")).toBe("noopener");
    expect(open?.hasAttribute("download")).toBe(false);
    expect(download?.getAttribute("download")).toBe(DOCX.projection.name);
    expect(download?.hasAttribute("target")).toBe(false);
  });
});

describe("what a list posts", () => {
  test("each file's key in order, and each file it was drawn holding and holds no longer", () => {
    const drawn = { held: [PDF.key, DOCX.key], remove: FILE_REMOVE_PREFIX };
    const held = (key: string) => ({ name: "a", size: 1, url: `/files/${key}` });
    expect(postedKeys([held(DOCX.key), held(PDF.key)], drawn)).toEqual([DOCX.key, PDF.key]);
    expect(postedKeys([held(DOCX.key)], drawn)).toEqual([
      DOCX.key,
      `${FILE_REMOVE_PREFIX}${PDF.key}`,
    ]);
    expect(postedKeys([], drawn)).toEqual(drawn.held.map((key) => `${FILE_REMOVE_PREFIX}${key}`));
    expect(postedKeys([], { held: [], remove: FILE_REMOVE_PREFIX })).toEqual([]);
    expect(listedKey({ name: "a", size: 1, url: "./elsewhere.pdf" })).toBe("");
  });

  test("removing a file names it removed, and removing every one names each", () => {
    const { host, posted, press } = listScene([PDF, DOCX]);
    press(`[data-file-list-remove]`);
    expect(posted()).toEqual([DOCX.key, `${FILE_REMOVE_PREFIX}${PDF.key}`]);
    press(`[data-file-list-remove]`);
    expect(posted()).toEqual([PDF.key, DOCX.key].map((key) => `${FILE_REMOVE_PREFIX}${key}`));
    expect(host.querySelectorAll("[data-file-entry]")).toHaveLength(0);
  });

  test("a double click on Remove removes one file, though the next closes up under it", () => {
    const { host, posted, press, doc } = listScene([PDF, DOCX]);
    press(`[data-file-list-remove]`);
    doc.fire("click", host.querySelector("[data-file-list-remove]") as El);
    expect(posted()).toEqual([DOCX.key, `${FILE_REMOVE_PREFIX}${PDF.key}`]);
  });

  test("a held Enter presses once, so its repeats never remove the next file", () => {
    const { host, doc } = listScene([PDF, DOCX]);
    const remove = host.querySelector("[data-file-list-remove]") as El;
    for (const key of ["Enter", " "]) {
      expect(doc.fire("keydown", remove, { key, repeat: true }).prevented).toBe(true);
      expect(doc.fire("keydown", remove, { key, repeat: false }).prevented).toBe(false);
    }
  });

  test("a held Tab still walks out of the list", () => {
    const { host, doc } = listScene([PDF, DOCX]);
    const remove = host.querySelector("[data-file-list-remove]") as El;
    expect(doc.fire("keydown", remove, { key: "Tab", repeat: true }).prevented).toBe(false);
  });

  test("a file that lands joins the end, posted by the key its upload answered", async () => {
    const { posted, pick, sent } = listScene([PDF]);
    pick("dawn.jpg");
    expect(posted()).toEqual([PDF.key]);
    const landed = mintFileKey();
    sent[0]?.land(landed);
    await flush();
    expect(posted()).toEqual([PDF.key, landed]);
  });
});

describe("files travelling", () => {
  test("each file in one pick travels on its own upload", () => {
    const { pick, sent } = listScene();
    pick("a.jpg", "b.jpg", "c.jpg");
    expect(sent.map((each) => each.picked.name)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  test("the form's save waits while any is in flight, and not after the last lands", async () => {
    const { form, pick, sent, doc } = listScene();
    pick("a.jpg", "b.jpg");
    expect(uploadingIn(form as never)).toBe(true);
    expect(doc.fire("submit", form).prevented).toBe(true);
    sent[0]?.land(mintFileKey());
    await flush();
    expect(uploadingIn(form as never)).toBe(true);
    sent[1]?.land(mintFileKey());
    await flush();
    expect(uploadingIn(form as never)).toBe(false);
    expect(doc.fire("submit", form).prevented).toBe(false);
  });

  test("removing a file still in flight stops its upload and leaves the rest travelling", async () => {
    const { host, pick, sent, form, posted } = listScene();
    pick("a.jpg", "b.jpg");
    const [first] = host.querySelectorAll("[data-file-list-stop]") as El[];
    host.ownerDocument?.fire("click", first as El);
    await flush();
    expect(sent.map((each) => each.aborted)).toEqual([true, false]);
    expect(uploadingIn(form as never)).toBe(true);
    const kept = mintFileKey();
    sent[1]?.land(kept);
    await flush();
    expect(posted()).toEqual([kept]);
  });

  test("a pick past the count is refused whole before anything travels", () => {
    const { host, pick, sent } = listScene([PDF], ALBUM_FIELD, 2);
    pick("a.jpg", "b.jpg");
    expect(sent).toHaveLength(0);
    expect(host.querySelector(".field__guidance")?.textContent).toBe(overCapSentence(3, 2, 1));
    pick("a.jpg");
    expect(sent).toHaveLength(1);
  });

  test("a list a lowered count already passes may still swap a file, but never grow", () => {
    const { pick, sent, press } = listScene([PDF, DOCX, PHOTO], ALBUM_FIELD, 2);
    press("[data-file-list-remove]");
    pick("a.jpg");
    expect(sent).toHaveLength(1);
    pick("b.jpg");
    expect(sent).toHaveLength(1);
  });
});

describe("a required list", () => {
  test("counts as empty in the browser with no file, and with only removals", () => {
    const required = { ...ALBUM_FIELD, required: true };
    const empty = listScene(undefined, required);
    expect(missingRequiredValues(empty.form as never)).toHaveLength(1);
    const held = listScene([PDF], required);
    expect(missingRequiredValues(held.form as never)).toHaveLength(0);
    held.press("[data-file-list-remove]");
    expect(held.posted()).toEqual([`${FILE_REMOVE_PREFIX}${PDF.key}`]);
    expect(missingRequiredValues(held.form as never)).toHaveLength(1);
  });
});

describe("a list after a save keeps what it holds", () => {
  test("counts its removals from what it was saved holding, not from what it was drawn with", async () => {
    const { form, posted, pick, sent, press } = listScene([PDF]);
    pick("dawn.jpg");
    const landed = mintFileKey();
    sent[0]?.land(landed);
    await flush();
    settleFileFields(form as never, "keep");
    press(`[data-file-entry="1"] [data-file-list-remove]`);
    expect(posted()).toEqual([PDF.key, `${FILE_REMOVE_PREFIX}${landed}`]);
  });
});

describe("a refusal naming an empty list", () => {
  test("reaches the list, though it posts nothing under its name", () => {
    const { form, doc, host } = listScene();
    const notice = doc.createElement("p");
    notice.setAttribute("data-error-fields", ALBUM_FIELD.name);
    notice.textContent = "I still need a little more before I can add this.";
    expect(relocateFieldError(form as never, notice as never)).toEqual([host]);
  });
});
