import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FILE_FAMILIES } from "../../../registry/fields/file.ts";
import { offeredTypes } from "./admission.ts";
import {
  DOCUMENTS_NAMED_AS,
  FAMILY_NOUNS,
  LOCKED_SENTENCE,
  misnamedSentence,
  NOT_ADMITTED_SENTENCES,
  notAdmittedSentence,
  refusalSentence,
} from "./refusal-copy.ts";

const DRAWN = readFileSync(join(import.meta.dir, "../../../../design/controls.html"), "utf8");
const BENCH = readFileSync(
  join(import.meta.dir, "../../../../design/scripts/sections/file-bench.js"),
  "utf8",
);
/** The page's sentences with each run of whitespace, and a tag's broken line, made one space. */
const DRAWN_FLAT = DRAWN.replace(/<em\s*>/g, "<em>")
  .replace(/<\/em\s*>/g, "</em>")
  .replace(/\s+/g, " ");

describe("a refused file's sentence", () => {
  test("for a field of one family is the one design/ settles", () => {
    for (const family of FILE_FAMILIES) {
      expect(DRAWN).toContain(`<em>${notAdmittedSentence([family])}</em>`);
    }
  });

  test("for a field of several families names each, in the field's order", () => {
    for (const accepts of [["video", "audio"], [...FILE_FAMILIES]] as const) {
      const sentence = notAdmittedSentence(accepts);
      const at = accepts.map((family) => sentence.indexOf(FAMILY_NOUNS[family]));
      expect(at.every((index) => index >= 0)).toBe(true);
      expect(at).toEqual([...at].sort((a, b) => a - b));
      expect(sentence).not.toBe(notAdmittedSentence([accepts[0]]));
    }
  });
});

describe("a refused document's sentence", () => {
  const WORD = DOCUMENTS_NAMED_AS.get("docx") ?? "";

  test("for a locked Word document, or one whose contents aren't what its name says, is drawn", () => {
    expect(DRAWN_FLAT).toContain(`<em>${LOCKED_SENTENCE}</em>`);
    expect(DRAWN_FLAT).toContain(`<em>${misnamedSentence(WORD)}</em>`);
  });

  test("names each document as the design bench does", () => {
    for (const [extension, namedAs] of DOCUMENTS_NAMED_AS) {
      expect(BENCH).toContain(`${extension}: "${namedAs}"`);
    }
  });

  test("names what every document extension a picker offers says it is", () => {
    const extensions = offeredTypes(["document"]).filter((offer) => offer.startsWith("."));
    expect(extensions.length).toBeGreaterThan(1);
    for (const extension of extensions) {
      expect(DOCUMENTS_NAMED_AS.has(extension.slice(1)), extension).toBe(true);
    }
  });

  test("is chosen by the stage that refused it and the name the file carries", () => {
    const documents = ["document"] as const;
    expect(refusalSentence("locked", "acta.docx", documents)).toBe(LOCKED_SENTENCE);
    expect(refusalSentence("signature", "cuentas.DOCX", documents)).toBe(misnamedSentence(WORD));
    expect(refusalSentence("signature", "notas.txt", documents)).toBe(
      misnamedSentence(DOCUMENTS_NAMED_AS.get("txt") ?? ""),
    );
    expect(refusalSentence("declared_type", "cuentas.docx", documents)).toBe(
      NOT_ADMITTED_SENTENCES.document,
    );
    expect(refusalSentence("signature", "photo.jpg", ["image"])).toBe(NOT_ADMITTED_SENTENCES.image);
    expect(refusalSentence("signature", "a.constructor", documents)).toBe(
      NOT_ADMITTED_SENTENCES.document,
    );
  });
});
