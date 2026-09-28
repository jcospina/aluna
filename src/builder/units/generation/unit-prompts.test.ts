// What a generated unit is told, read without keeping a second copy of the telling. The wording
// is a person's to change; these own which inputs reach which unit's prompt, which never do, and
// that each conditional instruction appears exactly when its condition holds.

import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  addedLines,
  linesNaming,
  linesOnlyIn,
} from "../../../platform/provider/prompt-lines.test-support.ts";
import { PHOTO_FIELD } from "../../../registry/fields/file.test-support.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  defaultBehavioralErrorsForSchema,
  fieldTypeSchema,
  isSearchableTextType,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  type SpecField,
} from "../../../registry/index.ts";
import { notesSpec } from "../../gate/gate.test-support.ts";
import {
  FILE_PROJECTION_SHAPE,
  handlerContractDeclarations,
  handlerContractType,
} from "../../generated-code-check.ts";
import {
  buildUnitPrompt,
  FILE_ARRIVES_ON_CREATE,
  FILE_ARRIVES_ON_UPDATE,
  PRESENT_ADAPTER_RULES,
  QUERY_PORT_RULES,
  SEARCH_NORMALIZATION_RULE,
  UPDATE_PATCH_ADMISSION_RULE,
} from "./unit-prompts.ts";
import type { HandlerUnitName, UnitDescriptor } from "./units.ts";

const HANDLERS = ["create", "read", "update", "delete", "search"] as const;
const ITEM: UnitDescriptor = { kind: "item-renderer", name: "item" };
const handler = (name: HandlerUnitName): UnitDescriptor => ({ kind: "handler", name });

function prompts(spec: CapabilitySpec): Record<HandlerUnitName | "item", string> {
  return {
    create: buildUnitPrompt(spec, handler("create")),
    read: buildUnitPrompt(spec, handler("read")),
    update: buildUnitPrompt(spec, handler("update")),
    delete: buildUnitPrompt(spec, handler("delete")),
    search: buildUnitPrompt(spec, handler("search")),
    item: buildUnitPrompt(spec, ITEM),
  };
}

/** The notes capability with `extra` fields beside its own, and the error cases that implies. */
function withFields(extra: readonly SpecField[], base = notesSpec()): CapabilitySpec {
  const schema = { fields: [...base.schema.fields, ...extra] };
  return { ...base, schema, behavioral_errors: defaultBehavioralErrorsForSchema(schema) };
}

/** The notes capability with nothing required, so no validation error case applies anywhere. */
function unrequiredNotes(): CapabilitySpec {
  const base = notesSpec();
  const fields = base.schema.fields.map((field) => ({ ...field, required: false }));
  return { ...base, schema: { fields }, behavioral_errors: [] };
}

/** The prompt's own instructions: no trailing context JSON, and no line naming one of the fields. */
function instructionsOf(spec: CapabilitySpec, prompt: string): string {
  const names = spec.schema.fields.map((field) => new RegExp(`\\b${field.name}\\b`));
  return prompt
    .slice(0, prompt.lastIndexOf("\n{\n"))
    .split("\n")
    .filter((line) => !names.some((name) => name.test(line)))
    .join("\n");
}

/** A line with every Action's name set aside, so two Actions' copies of one rule compare equal. */
function withoutActionNames(line: string): string {
  return line.replace(/\b(create|read|update|delete|search)\b/g, "ACTION");
}

/** The context type the checker compiles `action`'s Handler against, read off its declarations. */
function contextTypeOf(action: HandlerUnitName): string {
  const declarations = handlerContractDeclarations(notesSpec());
  const type = new RegExp(`type ${handlerContractType(action)} = \\(context: (\\w+)\\)`).exec(
    declarations,
  )?.[1];
  if (!type) throw new Error(`no context type declared for ${action}`);
  return type;
}

const fieldName = fc.stringMatching(/^zq[a-z]{6}$/);
const anyField = fc
  .record({
    name: fieldName,
    label: fc.stringMatching(/^L[A-Z]{7}$/),
    type: fc.constantFrom(...fieldTypeSchema.options),
    required: fc.boolean(),
    lifecycle: fc.constantFrom("active" as const, "inactive" as const),
    options: fc.uniqueArray(
      fc.record({
        value: fc.stringMatching(/^v[a-z]{7}$/),
        label: fc.stringMatching(/^O[A-Z]{7}$/),
      }),
      { minLength: 1, maxLength: 3, selector: (option) => option.value },
    ),
  })
  .map(({ options, ...field }): SpecField => {
    if (field.type === "choice") return { ...field, values: options, groups: [] };
    if (field.type === "file") return { ...field, accepts: PHOTO_FIELD.accepts };
    return field;
  });

/** A valid capability of generated fields, one of them always active, showing a generated subset. */
const anySpec = fc
  .uniqueArray(anyField, { minLength: 1, maxLength: 6, selector: (field) => field.name })
  .map((fields) =>
    fields.map((field, index) =>
      index === 0 ? { ...field, lifecycle: "active" as const } : field,
    ),
  )
  .chain((fields) => {
    const active = fields.filter((field) => field.lifecycle === "active");
    return fc
      .subarray(
        active.map((field) => field.name),
        { minLength: 1 },
      )
      .map((shows) => {
        const base = notesSpec();
        const schema = { fields };
        const named = (type: string) => active.filter((field) => field.type === type);
        return notesSpec({
          schema,
          behavioral_errors: defaultBehavioralErrorsForSchema(schema),
          ui_intent: {
            ...base.ui_intent,
            form: {
              ...base.ui_intent.form,
              list_inputs: named("string[]").map(({ name }) => ({
                field: name,
                mode: "repeatable",
              })),
              choice_inputs: named("choice").map(({ name }) => ({
                field: name,
                presentation: "picker",
              })),
            },
            item: { ...base.ui_intent.item, shows },
          },
        });
      });
  });

const RUNS = { seed: 20260926, numRuns: 120 };

function optionsOf(field: SpecField): readonly { value: string; label: string }[] {
  return field.values ?? [];
}

/** A shown field reaches the card with its name, label and options together; any other, not at all. */
function expectOnCard(prompt: string, field: SpecField, shown: boolean): void {
  expect(linesNaming(prompt, [field.name, field.label]).length > 0, field.name).toBe(shown);
  for (const option of optionsOf(field)) {
    expect(linesNaming(prompt, [field.name, option.value, option.label]).length > 0).toBe(shown);
  }
  if (shown) return;
  for (const word of [field.name, field.label]) expect(prompt).not.toContain(word);
}

/** A writing Handler gets an active field's name, type and admitted values, and never a label. */
function expectWritten(prompt: string, field: SpecField): void {
  const active = field.lifecycle === "active";
  expect(linesNaming(prompt, [field.name, field.type]).length > 0, field.name).toBe(active);
  expect(prompt.includes(field.name), field.name).toBe(active);
  expect(prompt).not.toContain(field.label);
  for (const option of optionsOf(field)) {
    expect(prompt.includes(`"${option.value}"`)).toBe(active);
    expect(prompt).not.toContain(option.label);
  }
}

/** Search gets an active text-bearing field's name only; read and delete get no field at all. */
function expectSearchedOrUnread(all: Record<HandlerUnitName, string>, field: SpecField): void {
  const searched = field.lifecycle === "active" && isSearchableTextType(field.type);
  expect(all.search.includes(field.name), field.name).toBe(searched);
  expect(all.read).not.toContain(field.name);
  expect(all.delete).not.toContain(field.name);
  const words = [field.label, ...optionsOf(field).map((option) => option.label)];
  for (const action of ["search", "read", "delete"] as const) {
    for (const word of words) expect(all[action]).not.toContain(word);
  }
}

describe("which of a capability's fields reach which unit", () => {
  test("the item renderer gets each shown field's name and label together, and nothing else's", () => {
    fc.assert(
      fc.property(anySpec, (spec) => {
        const prompt = buildUnitPrompt(spec, ITEM);
        const shows = new Set(spec.ui_intent.item.shows);
        for (const field of spec.schema.fields) expectOnCard(prompt, field, shows.has(field.name));
      }),
      RUNS,
    );
  });

  test("create and update get every active field with its type and a choice's values, never a label", () => {
    fc.assert(
      fc.property(anySpec, (spec) => {
        for (const action of ["create", "update"] as const) {
          const prompt = buildUnitPrompt(spec, handler(action));
          for (const field of spec.schema.fields) expectWritten(prompt, field);
        }
      }),
      RUNS,
    );
  });

  test("search gets the active text-bearing fields and no other; read and delete get none", () => {
    fc.assert(
      fc.property(anySpec, (spec) => {
        const all = prompts(spec);
        for (const field of spec.schema.fields) expectSearchedOrUnread(all, field);
      }),
      RUNS,
    );
  });

  test("making a field required moves the writing Handlers' line for that field", () => {
    const optional = notesSpec();
    const required = withFields(
      [],
      notesSpec({
        schema: {
          fields: optional.schema.fields.map((field) =>
            field.name === "pinned" ? { ...field, required: true } : field,
          ),
        },
      }),
    );
    for (const action of ["create", "update"] as const) {
      const moved = addedLines(
        buildUnitPrompt(optional, handler(action)),
        buildUnitPrompt(required, handler(action)),
      );
      expect(linesNaming(moved.join("\n"), ["pinned", "boolean"]), action).toHaveLength(1);
    }
  });
});

describe("what each Handler is told about its own Action", () => {
  test("each names the context type it is checked against, and no other Action's", () => {
    const all = prompts(notesSpec());
    for (const action of HANDLERS) {
      expect(all[action], action).toContain(contextTypeOf(action));
      for (const other of HANDLERS) {
        const foreign = contextTypeOf(other);
        if (foreign === contextTypeOf(action)) continue;
        expect(all[action], `${action} names ${foreign}`).not.toMatch(
          new RegExp(`\\b${foreign}\\b`),
        );
      }
    }
  });

  test("each writing Handler names its own mutation port and no other's", () => {
    const all = prompts(notesSpec());
    const writing = ["create", "update", "delete"] as const;
    for (const action of HANDLERS) {
      for (const port of writing) {
        expect(all[action].includes(`mutation.${port}`), `${action} → ${port}`).toBe(
          action === port,
        );
      }
    }
  });

  test("only the record-producing Actions are told about the records port", () => {
    const all = prompts(notesSpec());
    for (const action of HANDLERS) {
      const producing = action === "read" || action === "search";
      expect(all[action].includes("query.records"), action).toBe(producing);
      expect(all[action].includes("targetIdAlias"), action).toBe(producing);
      // The registered SQL function every search term and stored value goes through.
      expect(all[action].includes("platform_search_normalize"), action).toBe(action === "search");
    }
  });

  test("every Handler that draws records is told to draw them through present, and delete is not", () => {
    const all = prompts(notesSpec());
    const rules = PRESENT_ADAPTER_RULES.join("\n");
    for (const action of HANDLERS) {
      expect(all[action].includes(rules), action).toBe(action !== "delete");
    }
    expect(all.delete).not.toContain("present(");
  });

  test("the Actions that read submitted values share input rules read and delete never get", () => {
    const spec = unrequiredNotes();
    const all = prompts(spec);
    const told = (action: HandlerUnitName) => instructionsOf(spec, all[action]);
    expect(
      linesOnlyIn([told("create"), told("update"), told("search")], [told("read"), told("delete")]),
    ).not.toEqual([]);
    expect(
      linesOnlyIn([told("create"), told("update")], [told("search"), told("read"), told("delete")]),
    ).not.toEqual([]);
  });
});

describe("each duty reaches the units it binds, and no other", () => {
  const all = prompts(notesSpec());
  const units = [...HANDLERS, "item"] as const;

  test("every Handler is given the query port's rules, and the item renderer none of them", () => {
    expect(QUERY_PORT_RULES.length).toBeGreaterThan(0);
    for (const rule of QUERY_PORT_RULES) {
      expect(rule.trim()).not.toBe("");
      for (const unit of units) expect(all[unit].includes(rule), unit).toBe(unit !== "item");
    }
  });

  test("only update is told an omitted field stays out of its patch", () => {
    for (const unit of units) {
      expect(all[unit].includes(UPDATE_PATCH_ADMISSION_RULE), unit).toBe(unit === "update");
    }
  });

  test("only search is told to normalize both its terms and the stored values", () => {
    for (const unit of units) {
      expect(all[unit].includes(SEARCH_NORMALIZATION_RULE), unit).toBe(unit === "search");
    }
  });

  test("a file field reaches create and update each described as its own Action holds it", () => {
    const photo = prompts(withFields([{ ...PHOTO_FIELD }]));
    for (const unit of units) {
      expect([unit, photo[unit].includes(FILE_ARRIVES_ON_CREATE)]).toEqual([
        unit,
        unit === "create",
      ]);
      expect([unit, photo[unit].includes(FILE_ARRIVES_ON_UPDATE)]).toEqual([
        unit,
        unit === "update",
      ]);
    }
  });
});

describe("validation error cases", () => {
  const without = unrequiredNotes();
  const withCases = notesSpec();
  const taughtFor = (action: HandlerUnitName) =>
    addedLines(
      buildUnitPrompt(without, handler(action)),
      buildUnitPrompt(withCases, handler(action)),
    );

  test("a writing Handler with cases is handed each marker and code; one without is handed none", () => {
    const markers = [
      BEHAVIORAL_ERROR_MARKERS.role_attribute,
      BEHAVIORAL_ERROR_MARKERS.code_attribute,
      BEHAVIORAL_ERROR_MARKERS.fields_attribute,
      MISSING_REQUIRED_FIELDS_ERROR_CODE,
    ];
    for (const action of ["create", "update"] as const) {
      const taught = taughtFor(action).join("\n");
      for (const marker of markers) expect(taught, `${action} ${marker}`).toContain(marker);
      expect(buildUnitPrompt(without, handler(action))).not.toContain(markers[0] ?? "");
    }
  });

  test("an Action is handed only the cases it owns", () => {
    for (const action of ["read", "delete", "search"] as const) {
      expect(buildUnitPrompt(withCases, handler(action)), action).toBe(
        buildUnitPrompt(without, handler(action)),
      );
    }
    expect(buildUnitPrompt(withCases, handler("create"))).not.toContain(JSON.stringify("update"));
    expect(buildUnitPrompt(withCases, handler("update"))).not.toContain(JSON.stringify("create"));
  });

  test("create and update are taught different ways to honour their cases", () => {
    const taught = (action: "create" | "update") =>
      new Set(
        taughtFor(action)
          .filter((line) => !line.includes('"'))
          .map(withoutActionNames),
      );
    const create = taught("create");
    const update = taught("update");
    expect([...create].some((line) => !update.has(line))).toBe(true);
    expect([...update].some((line) => !create.has(line))).toBe(true);
  });
});

describe("a file field", () => {
  const photo = withFields([{ ...PHOTO_FIELD }]);
  const plain = withFields([]);

  test("teaches create and update what a file arrives as, and moves no other unit's prompt", () => {
    const before = prompts(plain);
    const after = prompts(photo);
    for (const action of ["create", "update"] as const) {
      expect(addedLines(before[action], after[action]).join("\n"), action).toContain(
        FILE_PROJECTION_SHAPE,
      );
    }
    for (const unit of ["read", "delete", "search", "item"] as const) {
      expect(after[unit], unit).toBe(before[unit]);
    }
  });

  test("tells create and update different things about when a file is there", () => {
    const requiredPhoto = withFields([{ ...PHOTO_FIELD, required: true }]);
    const taught = (action: "create" | "update", spec: CapabilitySpec) =>
      addedLines(
        buildUnitPrompt(plain, handler(action)),
        buildUnitPrompt(spec, handler(action)),
      ).map(withoutActionNames);
    const arrives = (action: "create" | "update") =>
      taught(action, photo).filter((line) => line.includes(FILE_PROJECTION_SHAPE));
    expect(arrives("create")).not.toEqual([]);
    expect(arrives("create")).not.toEqual(arrives("update"));
    // A create submits every field, so only an update tells a left-out file from an emptied one.
    const requiredOnly = (action: "create" | "update") =>
      taught(action, requiredPhoto).filter((line) => !taught(action, photo).includes(line));
    const bySubmission = (action: "create" | "update") =>
      requiredOnly(action).some((line) => line.includes("input.submittedFields"));
    expect(bySubmission("update")).toBe(true);
    expect(bySubmission("create")).toBe(false);
  });

  test("teaches more when it is required than a required field of any other type does", () => {
    const requiredPhoto = withFields([{ ...PHOTO_FIELD, required: true }]);
    const pinnedRequired = withFields(
      [{ ...PHOTO_FIELD }],
      notesSpec({
        schema: {
          fields: notesSpec().schema.fields.map((field) =>
            field.name === "pinned" ? { ...field, required: true } : field,
          ),
        },
      }),
    );
    for (const action of ["create", "update"] as const) {
      const photoDelta = addedLines(
        buildUnitPrompt(photo, handler(action)),
        buildUnitPrompt(requiredPhoto, handler(action)),
      );
      const otherDelta = addedLines(
        buildUnitPrompt(photo, handler(action)),
        buildUnitPrompt(pinnedRequired, handler(action)),
      );
      expect(photoDelta.length, action).toBeGreaterThan(otherDelta.length);
    }
  });

  test("an inactive file field teaches nothing", () => {
    const inactive = withFields([{ ...PHOTO_FIELD, lifecycle: "inactive" }]);
    const before = prompts(plain);
    const after = prompts(inactive);
    for (const unit of [...HANDLERS, "item"] as const) expect(after[unit], unit).toBe(before[unit]);
  });
});

describe("a retry", () => {
  const spec = notesSpec();
  const UNRELATED = "Type 'number' is not assignable to type 'string'.";
  const INDEXED = [
    "Argument of type 'CapabilityInputValue | undefined' is not assignable to parameter of type 'string'.",
    "Argument of type 'CapabilitySaveInputValue | undefined' is not assignable to parameter of type 'string'.",
    "Type 'readonly string[]' is not assignable to type 'string'.",
  ];
  const HALF = [
    "Type 'readonly string[]' is missing the following properties.",
    "Type 'string[]' is not assignable to type 'string'.",
  ];

  /** What the retry says after the failure it was handed. */
  function afterFailure(unit: UnitDescriptor, message: string): string {
    const retry = buildUnitPrompt(spec, unit, { ...unit, message });
    expect(retry.startsWith(buildUnitPrompt(spec, unit))).toBe(true);
    const at = retry.lastIndexOf(message);
    expect(at).toBeGreaterThan(buildUnitPrompt(spec, unit).length);
    return retry.slice(at + message.length);
  }

  test("is the whole unit prompt, then the failure, and ends there when nothing more applies", () => {
    for (const unit of [...HANDLERS.map(handler), ITEM]) {
      expect(afterFailure(unit, UNRELATED)).toBe("");
      for (const message of HALF) expect(afterFailure(unit, message)).toBe("");
    }
  });

  test("adds indexed-input repair to a Handler's retry only for an indexed-input failure", () => {
    for (const message of INDEXED) {
      for (const action of HANDLERS)
        expect(afterFailure(handler(action), message), action).not.toBe("");
      expect(afterFailure(ITEM, message)).toBe("");
    }
  });

  test("gives update one more repair line than any other Handler, and the rest the same", () => {
    const [message = ""] = INDEXED;
    const update = afterFailure(handler("update"), message).split("\n");
    for (const action of ["create", "read", "delete", "search"] as const) {
      const other = afterFailure(handler(action), message).split("\n");
      expect(other, action).toEqual(afterFailure(handler("create"), message).split("\n"));
      expect(
        update.filter((line) => !other.includes(line)),
        action,
      ).toHaveLength(1);
    }
  });
});

describe("prior committed source", () => {
  const spec = notesSpec();
  const SOURCE = "export default function zzPriorSource(): string { return 'zz'; }";

  test("is carried verbatim after the unit's own prompt, and only when there is some", () => {
    for (const unit of [...HANDLERS.map(handler), ITEM]) {
      const base = buildUnitPrompt(spec, unit);
      const carried = buildUnitPrompt(spec, unit, undefined, [], SOURCE);
      expect(buildUnitPrompt(spec, unit, undefined, [], "")).toBe(base);
      expect(carried.startsWith(base)).toBe(true);
      expect(carried.slice(base.length)).toContain(SOURCE);
    }
  });

  test("names the Handler it was written for, and no Handler for the item renderer", () => {
    for (const action of HANDLERS) {
      const unit = handler(action);
      const added = addedLines(
        buildUnitPrompt(spec, unit),
        buildUnitPrompt(spec, unit, undefined, [], SOURCE),
      );
      expect(linesNaming(added.join("\n"), [action]), action).not.toEqual([]);
    }
    const item = addedLines(
      buildUnitPrompt(spec, ITEM),
      buildUnitPrompt(spec, ITEM, undefined, [], SOURCE),
    ).join("\n");
    for (const action of HANDLERS) expect(item).not.toContain(action);
  });

  test("comes before the failure, so a retry still ends on what to fix", () => {
    const unit = handler("create");
    const message = "zz the previous create failed";
    const retry = buildUnitPrompt(spec, unit, { ...unit, message }, [], SOURCE);
    expect(retry.indexOf(SOURCE)).toBeLessThan(retry.indexOf(message));
    expect(retry.endsWith(message)).toBe(true);
  });
});
