// A field may be named `constructor`, a name every plain object inherits. A submission that leaves
// such a field out must read as leaving it out, at the router's checks and at the mutation port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import {
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../registry/fields/file.test-support.ts";
import type { SpecField } from "../../../registry/index.ts";
import { applyCapabilityTableDdl } from "../schema/ddl.ts";
import { noFiles } from "../tool.test-support.ts";
import { createCapabilityMutationPort } from "./mutation.ts";
import { assertSubmittedFieldValues } from "./submitted-values.ts";

const NAME = "constructor";
const specs: readonly [string, SpecField][] = [
  ["a file field", { ...PHOTO_FIELD, name: NAME }],
  ["a text field", { ...CAPTION_FIELD, name: NAME, required: false }],
  [
    "a choice field",
    {
      name: NAME,
      label: "Builder",
      type: "choice",
      required: false,
      lifecycle: "active",
      values: [{ value: "mason", label: "Mason" }],
      groups: [],
    },
  ],
];

let env: ScratchDbEnv;

function specWith(field: SpecField) {
  const spec = photoSpec([CAPTION_FIELD, field]);
  if (field.type !== "choice") return spec;
  const form = { ...spec.ui_intent.form, choice_inputs: [{ field: NAME, presentation: "picker" }] };
  return { ...spec, ui_intent: { ...spec.ui_intent, form } } as typeof spec;
}

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-own-values-");
});

afterEach(() => teardownScratchDbEnv(env));

describe("a field named constructor, left out of the submission", () => {
  for (const [name, field] of specs) {
    test(`is ${name} the router's checks and the create port both read as empty`, () => {
      const spec = specWith(field);
      applyCapabilityTableDdl(spec, env.conns.readwrite);
      const files = noFiles(spec, env.conns.readwrite);

      expect(() =>
        assertSubmittedFieldValues(spec.schema.fields, { caption: "c" }, "create", files.scope),
      ).not.toThrow();
      const record = createCapabilityMutationPort(spec, files).create({ caption: "c" });
      expect(record.fields[NAME]).toBeNull();
    });
  }
});
