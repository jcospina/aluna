// What a generated unit is told about a choice field. The two halves are deliberately
// asymmetric: the writing Handlers get the admitted values as context they must not
// re-validate, and the item renderer gets them so it can present the label a person reads
// rather than the wire value the row stores.

import { describe, expect, test } from "bun:test";
import type { CapabilitySpec } from "../../registry/index.ts";
import { notesSpec } from "../gate/gate.test-support.ts";
import { buildUnitPrompt } from "./unit-prompts.ts";

const STAGE_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
];

/** The notes capability with one active choice field its item card also shows. */
function stagedSpec(): CapabilitySpec {
  const base = notesSpec();
  return notesSpec({
    schema: {
      fields: [
        ...base.schema.fields,
        {
          name: "stage",
          label: "Stage",
          type: "choice",
          required: false,
          lifecycle: "active",
          values: STAGE_OPTIONS,
          groups: [],
        },
      ],
    },
    ui_intent: {
      ...base.ui_intent,
      form: { ...base.ui_intent.form, choice_inputs: [{ field: "stage", presentation: "picker" }] },
      item: { ...base.ui_intent.item, shows: ["text", "stage"] },
    },
  });
}

function promptFor(name: "create" | "update" | "search" | "item"): string {
  const spec = stagedSpec();
  return name === "item"
    ? buildUnitPrompt(spec, { kind: "item-renderer", name: "item" })
    : buildUnitPrompt(spec, { kind: "handler", name });
}

describe("what a Handler is told about a choice", () => {
  test("create and update receive the admitted values as context", () => {
    for (const action of ["create", "update"] as const) {
      const prompt = promptFor(action);
      expect(prompt).toContain('"values"');
      expect(prompt).toContain('"draft"');
      expect(prompt).toContain('"sent"');
    }
  });

  test("and are told the platform already refused anything undeclared", () => {
    expect(promptFor("create")).toContain(
      "has already been checked against its declared values by the platform",
    );
    expect(promptFor("create")).toContain("Never re-validate the option set");
  });

  test("search is told the field is searchable, without the option set", () => {
    const prompt = promptFor("search");
    expect(prompt).toContain("stage");
    // The admitted set is create/update validation shape; search matches stored text
    // either way, so it is not part of the search Handler's contract.
    expect(prompt).not.toContain('"values"');
  });
});

describe("what the item renderer is told about a choice", () => {
  test("it receives the option labels, so a card can read 'Draft' rather than 'draft'", () => {
    const prompt = promptFor("item");
    expect(prompt).toContain("options ");
    expect(prompt).toContain('{"value":"draft","label":"Draft"}');
  });

  test("and is told to present the label, never the stored value", () => {
    expect(promptFor("item")).toContain(
      "Present the matching option `label`, never the raw stored value",
    );
  });

  test("a non-choice field brings no option list to either surface", () => {
    const itemPrompt = promptFor("item");
    const textLine = itemPrompt.split("\n").find((line) => line.startsWith("- text:"));
    expect(textLine).toBeDefined();
    expect(textLine).not.toContain("options");
  });
});
