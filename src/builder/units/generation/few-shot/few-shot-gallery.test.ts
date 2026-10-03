// What the gallery teaches a card that holds files: for every set of families a field may take,
// alone or as a list, an exemplar in every collection layout, and a list's exemplars only where a
// list is shown (7.4/03).

import { describe, expect, test } from "bun:test";

import {
  CAPTION_FIELD,
  photoSpec,
  subsets,
} from "../../../../registry/fields/file.test-support.ts";
import {
  type CapabilitySpec,
  FILE_FAMILIES,
  type FileFamily,
  isFileFieldType,
  isFileListFieldType,
  uiCollectionLayoutSchema,
} from "../../../../registry/index.ts";
import { buildUnitPrompt } from "../unit-prompts.ts";
import {
  FEW_SHOT_DESIGN_EXAMPLES,
  type FewShotDesignExample,
  fewShotExamplesFor,
} from "./few-shot-gallery.ts";

const item = { kind: "item-renderer", name: "item" } as const;
const EVERY_LAYOUT = new Set(uiCollectionLayoutSchema.options);

const fileOf = (example: FewShotDesignExample) =>
  example.capability.schema.fields.find((field) => isFileFieldType(field.type));
const holdsAList = (example: FewShotDesignExample) =>
  isFileListFieldType(fileOf(example)?.type ?? "");

function showing(accepts: FileFamily[], list: boolean): CapabilitySpec {
  const type = list ? ("file[]" as const) : ("file" as const);
  const file = { name: "files", label: "Files", type, required: false, accepts };
  const spec = photoSpec([CAPTION_FIELD, { ...file, lifecycle: "active" }]);
  const shows = ["caption", "files"];
  return { ...spec, ui_intent: { ...spec.ui_intent, item: { ...spec.ui_intent.item, shows } } };
}

describe("the few-shot gallery", () => {
  test("shows a card whose field takes any set of families an exemplar of it in every layout", () => {
    for (const accepts of subsets(FILE_FAMILIES)) {
      for (const list of [false, true]) {
        const files = fewShotExamplesFor([{ accepts, list }]).filter(fileOf);
        expect(new Set(files.map(({ layout }) => layout)), `${accepts}, ${list}`).toEqual(
          EVERY_LAYOUT,
        );
        if (!list) continue;
        const lists = files.filter(holdsAList).map(({ layout }) => layout);
        expect(new Set(lists), `${accepts} as a list`).toEqual(EVERY_LAYOUT);
      }
    }
  });

  test("shows a card that holds no file every exemplar without one, in every layout, and no other", () => {
    const text = FEW_SHOT_DESIGN_EXAMPLES.filter((example) => !fileOf(example));
    expect(new Set(text.map(({ layout }) => layout))).toEqual(EVERY_LAYOUT);
    const prompt = buildUnitPrompt(photoSpec(), item);
    for (const example of FEW_SHOT_DESIGN_EXAMPLES) {
      expect(prompt.includes(example.rendererSource), example.id).toBe(text.includes(example));
    }
  });

  test("shows a list's exemplars to a card that shows a list, and never to one that shows a file", () => {
    const lists = FEW_SHOT_DESIGN_EXAMPLES.filter(holdsAList);
    for (const accepts of subsets(FILE_FAMILIES)) {
      const single = buildUnitPrompt(showing(accepts, false), item);
      const listed = buildUnitPrompt(showing(accepts, true), item);
      expect(lists.some(({ rendererSource }) => single.includes(rendererSource))).toBe(false);
      expect(lists.some(({ rendererSource }) => listed.includes(rendererSource))).toBe(true);
    }
  });

  test("shows a card that shows only lists no exemplar of a single file", () => {
    for (const accepts of subsets(FILE_FAMILIES)) {
      const offered = fewShotExamplesFor([{ accepts, list: true }]).filter(fileOf);
      expect(offered.every(holdsAList), `${accepts}`).toBe(true);
    }
  });

  test("shows a card with several file fields what it would show for each of them", () => {
    const fields = subsets(FILE_FAMILIES).flatMap((accepts) =>
      [false, true].map((list) => ({ accepts, list })),
    );
    for (const [index, first] of fields.entries()) {
      const second = fields[(index * 7 + 3) % fields.length] ?? first;
      const each = new Set([...fewShotExamplesFor([first]), ...fewShotExamplesFor([second])]);
      expect(new Set(fewShotExamplesFor([first, second]))).toEqual(each);
    }
  });
});
