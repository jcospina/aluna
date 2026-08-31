// What a generated unit is told about a choice field. The two halves are deliberately
// asymmetric: the writing Handlers get the admitted values as context they must not
// re-validate, and the item renderer gets them so it can present the label a person reads
// rather than the wire value the row stores.

import { describe, expect, test } from "bun:test";
import type { CapabilitySpec, ChoiceOption } from "../../registry/index.ts";
import { notesSpec } from "../gate/gate.test-support.ts";
import { buildUnitPrompt } from "./unit-prompts.ts";

const STAGE_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
];

/** The notes capability with one active choice field its item card also shows. */
function stagedSpec(
  values: readonly ChoiceOption[] = STAGE_OPTIONS,
  groups: readonly { id: string; heading: string }[] = [],
): CapabilitySpec {
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
          values: [...values],
          groups: [...groups],
        },
      ],
    },
    ui_intent: {
      ...base.ui_intent,
      form: {
        ...base.ui_intent.form,
        choice_inputs: [{ field: "stage", presentation: "picker" }],
        long_text: [],
        guidance: [],
      },
      item: { ...base.ui_intent.item, shows: ["text", "stage"] },
    },
  });
}

function promptFor(
  name: "create" | "update" | "search" | "item",
  spec: CapabilitySpec = stagedSpec(),
): string {
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

/*
 * What a generated unit is *not* told, which is what lets the Diff matrix copy it.
 *
 * Every one of these is a fact the matrix maps to platform work alone. A unit copied
 * byte-for-byte across such a change is only sound if the change could not have reached
 * the prompt the unit was written from — so the projections are pinned here, from the one
 * side that can prove it: two specs differing only in that fact must produce the same
 * prompt, byte for byte.
 */
describe("the option facts a generated unit never sees", () => {
  const GROUPED = [
    { value: "draft", label: "Draft", group: "open" as const, note: "not sent yet" },
    { value: "sent", label: "Sent", group: "open" as const, disabled: true as const },
  ];

  test("a note, a group, a retirement and the authored order all leave both prompts identical", () => {
    const plain = stagedSpec();
    const decorated = stagedSpec(GROUPED, [{ id: "open", heading: "Open" }]);
    const reordered = stagedSpec([...STAGE_OPTIONS].reverse());

    for (const unit of ["create", "update", "item"] as const) {
      expect(promptFor(unit, decorated), unit).toBe(promptFor(unit, plain));
      expect(promptFor(unit, reordered), unit).toBe(promptFor(unit, plain));
    }
  });

  test("a relabel and an append do move both prompts, which is why they select units", () => {
    const plain = stagedSpec();
    const relabelled = stagedSpec([
      { value: "draft", label: "Rough draft" },
      { value: "sent", label: "Sent" },
    ]);
    const appended = stagedSpec([...STAGE_OPTIONS, { value: "paid", label: "Paid" }]);

    // A wording change reaches the card and nothing else; an appended value reaches both.
    expect(promptFor("item", relabelled)).not.toBe(promptFor("item", plain));
    expect(promptFor("create", relabelled)).toBe(promptFor("create", plain));
    expect(promptFor("item", appended)).not.toBe(promptFor("item", plain));
    expect(promptFor("create", appended)).not.toBe(promptFor("create", plain));
  });

  test("the Handler gets bare value strings, never the option objects", () => {
    const prompt = promptFor("create", stagedSpec(GROUPED, [{ id: "open", heading: "Open" }]));
    expect(prompt).toContain('"values": [\n          "draft",\n          "sent"\n        ]');
    expect(prompt).not.toContain("not sent yet");
    expect(prompt).not.toContain('"disabled"');
    expect(prompt).not.toContain('"group"');
  });

  test("the card gets value and label pairs, never the rest of the row", () => {
    const prompt = promptFor("item", stagedSpec(GROUPED, [{ id: "open", heading: "Open" }]));
    expect(prompt).toContain('{"value":"draft","label":"Draft"}');
    expect(prompt).not.toContain("not sent yet");
    expect(prompt).not.toContain("Open");
    expect(prompt).not.toContain('"disabled"');
  });
});
