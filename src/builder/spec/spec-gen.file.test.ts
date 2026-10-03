// The spec prompt names the file type and says when to declare one, and a generated spec carrying
// one passes the stage.

import { describe, expect, test } from "bun:test";

import { addedLines, linesNaming } from "../../platform/provider/prompt-lines.test-support.ts";

import { CAPTION_FIELD, PHOTO_FIELD, photoSpec } from "../../registry/fields/file.test-support.ts";
import {
  type CapabilitySpec,
  fieldTypeSchema,
  type UiCollectionLayout,
  uiCollectionLayoutSchema,
} from "../../registry/index.ts";
import { FILE_FIELD_CARD_LINE, FILE_FIELD_PROMPT_LINES } from "./file-field-guidance.ts";
import { drawFileCardLayout, drawnFileCardLayout } from "./layout-draw.ts";
import {
  makeSpecProvider,
  notesIntent,
  notesSpec,
  recordingSend,
} from "./spec-gen.test-support.ts";
import { buildSpecPrompt, generateSpec } from "./spec-gen.ts";

function stageInput(spec: unknown, incarnationId = "inc_spec_test") {
  return {
    provider: makeSpecProvider(spec),
    prompt: "keep track of my photos",
    intent: notesIntent(),
    send: recordingSend().send,
    incarnationId,
  };
}

const INCARNATIONS = Array.from({ length: 16 }, (_, index) => `inc_${index}`);

const drawsOtherThan = (id: string) => (candidate: string) =>
  drawnFileCardLayout(candidate) !== drawnFileCardLayout(id);

describe("the spec prompt", () => {
  test("offers the file type, says what it accepts, and says search never reads it", () => {
    const prompt = buildSpecPrompt(stageInput(photoSpec()));
    expect(linesNaming(prompt, fieldTypeSchema.options)).not.toEqual([]);
    for (const line of FILE_FIELD_PROMPT_LINES) expect(prompt).toContain(line);
    expect(prompt).toContain(FILE_FIELD_CARD_LINE);
  });

  test("names the layout its incarnation draws for a card that shows a file", () => {
    const [first] = INCARNATIONS;
    const other = INCARNATIONS.find(drawsOtherThan(first ?? ""));
    if (!first || !other) throw new Error("Expected incarnations that draw both layouts.");
    const prompt = (id: string) => buildSpecPrompt(stageInput(photoSpec(), id));
    const named = addedLines(prompt(other), prompt(first));
    expect(named).not.toEqual([]);
    for (const line of named) expect(line).toContain(drawnFileCardLayout(first));
  });
});

describe("a generated spec carrying a file field", () => {
  test("passes the stage with its families", async () => {
    const second = { ...PHOTO_FIELD, name: "cover", label: "Cover" };
    const { spec } = await generateSpec(
      stageInput(photoSpec([CAPTION_FIELD, PHOTO_FIELD, second])),
    );
    const files = spec.schema.fields.filter((field) => field.type === "file");
    expect(files.map((field) => [field.name, field.accepts])).toEqual([
      ["photo", ["image"]],
      ["cover", ["image"]],
    ]);
  });

  test("passes the stage when a field takes videos, alone or beside pictures", async () => {
    const clips = { ...PHOTO_FIELD, name: "clip", label: "Clip", accepts: ["video" as const] };
    const either = { ...PHOTO_FIELD, name: "moment", label: "Moment", accepts: ["video", "image"] };
    const { spec } = await generateSpec(
      stageInput(photoSpec([CAPTION_FIELD, clips, either as typeof PHOTO_FIELD])),
    );
    const files = spec.schema.fields.filter((field) => field.type === "file");
    expect(files.map((field) => [field.name, field.accepts])).toEqual([
      ["clip", ["video"]],
      ["moment", ["image", "video"]],
    ]);
  });

  test("passes the stage when a field takes sounds, alone or beside the other families", async () => {
    const memo = { ...PHOTO_FIELD, name: "memo", label: "Memo", accepts: ["audio" as const] };
    const any = { ...PHOTO_FIELD, name: "any", label: "Any", accepts: ["audio", "video", "image"] };
    const { spec } = await generateSpec(
      stageInput(photoSpec([CAPTION_FIELD, memo, any as typeof PHOTO_FIELD])),
    );
    const files = spec.schema.fields.filter((field) => field.type === "file");
    expect(files.map((field) => [field.name, field.accepts])).toEqual([
      ["memo", ["audio"]],
      ["any", ["image", "video", "audio"]],
    ]);
  });

  test("passes the stage when a field takes documents, alone or beside the other families", async () => {
    const manual = {
      ...PHOTO_FIELD,
      name: "manual",
      label: "Manual",
      accepts: ["document" as const],
    };
    const any = { ...PHOTO_FIELD, name: "any", label: "Any", accepts: ["document", "image"] };
    const { spec } = await generateSpec(
      stageInput(photoSpec([CAPTION_FIELD, manual, any as typeof PHOTO_FIELD])),
    );
    const files = spec.schema.fields.filter((field) => field.type === "file");
    expect(files.map((field) => [field.name, field.accepts])).toEqual([
      ["manual", ["document"]],
      ["any", ["image", "document"]],
    ]);
  });

  test("passes the stage when it marks the file field required", async () => {
    const required = photoSpec([CAPTION_FIELD, { ...PHOTO_FIELD, required: true }]);
    const { spec } = await generateSpec(stageInput(required));
    expect(spec.schema.fields.find((field) => field.type === "file")?.required).toBe(true);
  });
});

describe("the layout of a capability that keeps files", () => {
  function laidOut(spec: CapabilitySpec, layout: UiCollectionLayout, shows: string[]) {
    const ui_intent = {
      ...spec.ui_intent,
      collection: { layout },
      item: { ...spec.ui_intent.item, shows },
    };
    return { ...spec, ui_intent };
  }

  async function layoutsOf(spec: CapabilitySpec): Promise<Set<UiCollectionLayout>> {
    const built = await Promise.all(
      INCARNATIONS.map((incarnation) => generateSpec(stageInput(spec, incarnation))),
    );
    return new Set(built.map(({ spec: { ui_intent } }) => ui_intent.collection.layout));
  }

  test("is drawn from the incarnation when the card shows a file, whatever the model chose", async () => {
    for (const shows of [["caption", "photo"], ["photo"]]) {
      for (const chosen of uiCollectionLayoutSchema.options) {
        const spec = laidOut(photoSpec(), chosen, shows);
        expect(await layoutsOf(spec)).toEqual(new Set(uiCollectionLayoutSchema.options));
      }
    }
  });

  test("is the same for every build of one incarnation", async () => {
    const spec = laidOut(photoSpec(), "feed", ["caption", "photo"]);
    for (const incarnation of INCARNATIONS) {
      const first = await generateSpec(stageInput(spec, incarnation));
      const again = drawFileCardLayout(laidOut(spec, "grid", ["caption", "photo"]), incarnation);
      expect(again.ui_intent.collection).toEqual(first.spec.ui_intent.collection);
    }
  });

  test("is the model's own when the card shows no file", async () => {
    for (const chosen of uiCollectionLayoutSchema.options) {
      const hidden = laidOut(photoSpec(), chosen, ["caption"]);
      expect(await layoutsOf(hidden)).toEqual(new Set([chosen]));
      const notes = laidOut(notesSpec(), chosen, notesSpec().ui_intent.item.shows);
      expect(await layoutsOf(notes)).toEqual(new Set([chosen]));
    }
  });
});
