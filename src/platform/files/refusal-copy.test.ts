import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FILE_FAMILIES } from "../../registry/fields/file.ts";
import { FAMILY_NOUNS, notAdmittedSentence } from "./refusal-copy.ts";

const DRAWN = readFileSync(join(import.meta.dir, "../../../design/controls.html"), "utf8");

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
