// A document in the product's own path: the edit form the server draws, filled by the drawn
// control (`design/scripts/files/file-field.js`), which opens a PDF in a tab by its verified type.

import { describe, expect, test } from "bun:test";

import { FILE_FIELD_HOOKS as HOOKS } from "#design/files/file-field.js";
import { KINDS, kindOf } from "#design/files/file-parts.js";
import { RECORD_TITLE_ATTRIBUTE } from "#shell/core/shell-dom.js";
import { offeredTypes } from "../../../platform/files/admission/admission.ts";
import { WORD_DOCUMENT_TYPE } from "../../../platform/files/admission/documents/word-package.ts";
import { FILE_URL_PREFIX } from "../../../platform/files/file-url.ts";
import { mintFileKey } from "../../../platform/files/store/ledger.ts";
import {
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../registry/fields/file.test-support.ts";
import { renderCreateForm, renderEditForm } from "../../fields/field-renderer.ts";
import { renderableFromSpec } from "../../fields/renderable-capability.ts";
import { installDomGlobals } from "../double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";
import { drawnFileFields, hooked, travelling } from "./file-field.test-support.ts";

installDomGlobals();
const mountFileFields = drawnFileFields();

const MANUAL = {
  url: `${FILE_URL_PREFIX}${mintFileKey()}`,
  name: "Kettle manual.pdf",
  kind: "document",
  mime: "application/pdf",
  size: 1_842_310,
};

const manuals = () => {
  const spec = photoSpec([CAPTION_FIELD, { ...PHOTO_FIELD, accepts: ["document"] }]);
  return { ...renderableFromSpec(spec), incarnationId: "inc-7" };
};

/** An edit of a manual whose file field takes documents, drawn by the control inside its record. */
function manualInRecord(held: Record<string, unknown>) {
  const doc = new Doc();
  const surface = doc.createElement("div");
  surface.setAttribute(RECORD_TITLE_ATTRIBUTE, "Electric kettle");
  parseHtml(renderEditForm(manuals(), { id: "r1", caption: "Kettle", photo: held }), surface);
  doc.body.append(surface);
  mountFileFields(doc, travelling);
  return surface.querySelector(hooked(HOOKS.field)) as El;
}

describe("a held PDF in the edit form", () => {
  test("carries its verified type, and opens in a tab of its own that can't reach back", () => {
    const host = manualInRecord(MANUAL);
    expect(host.getAttribute(HOOKS.kind)).toBe("document");
    expect(host.getAttribute(HOOKS.holdsType)).toBe(MANUAL.mime);
    expect(host.querySelector("img, video, audio, embed, object, iframe")).toBeNull();
    const links = host.querySelectorAll("a[href]");
    expect(links).toHaveLength(1);
    const [open] = links as El[];
    expect(open?.getAttribute("href")).toBe(MANUAL.url);
    expect(open?.getAttribute("target")).toBe("_blank");
    expect(open?.getAttribute("rel")?.split(/\s+/)).toContain("noopener");
    expect(open?.hasAttribute("download")).toBe(false);
  });

  test("downloads when its name says PDF but no verified type does", () => {
    for (const mime of ["text/plain", null]) {
      const host = manualInRecord({ ...MANUAL, mime });
      expect(host.getAttribute(HOOKS.holdsType) ?? null).toBe(mime);
      const [link] = host.querySelectorAll("a[href]") as El[];
      expect(link?.getAttribute("download")).toBe(MANUAL.name);
      expect(link?.hasAttribute("target")).toBe(false);
    }
  });
});

describe("a held Word document in the edit form", () => {
  test("shows its name and a link that downloads it under that name", () => {
    const name = "Presupuesto año.docx";
    const mime = WORD_DOCUMENT_TYPE;
    const host = manualInRecord({ ...MANUAL, name, mime });
    expect(host.getAttribute(HOOKS.holdsType)).toBe(mime);
    expect(host.textContent).toContain(name);
    expect(host.querySelector("img, video, audio, embed, object, iframe")).toBeNull();
    const links = host.querySelectorAll("a[href]") as El[];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(MANUAL.url);
    expect(links[0]?.getAttribute("download")).toBe(name);
    expect(links[0]?.hasAttribute("target")).toBe(false);
  });
});

describe("a held file's kind", () => {
  test("is a document when its verified type is one, whatever its name says", () => {
    const either = ["image", "document"] as const;
    expect(kindOf({ name: "scan.jpg", type: "application/pdf" }, [...either])).toBe("document");
    expect(kindOf({ name: "scan.pdf", type: "image/png" }, [...either])).toBe("image");
  });
});

describe("a document field's picker", () => {
  test("offers every document extension admission takes, as design/ draws the picker", () => {
    const surface = new Doc().createElement("div");
    parseHtml(renderCreateForm(manuals()), surface);
    const host = surface.querySelector(hooked(HOOKS.field)) as El;
    const offered = host.getAttribute(HOOKS.accept);
    expect(offered).toBe(offeredTypes(["document"]).join(","));
    expect(offered).toBe(KINDS.document.accept);
  });
});
