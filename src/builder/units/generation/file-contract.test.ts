// The contract a generated unit is compiled against knows what a file field carries: the projection
// the router hands a Handler and every record hands back. A mirror narrower than the runtime would
// refuse a Handler that passes the photo on, and one wider would admit a Handler the router fails.

import { describe, expect, test } from "bun:test";

import { mintFileKey } from "../../../platform/files/ledger.ts";
import { photoSpec } from "../../../registry/fields/file.test-support.ts";
import type { CapabilitySpec } from "../../../registry/index.ts";
import { notesSpec } from "../../../registry/spec/spec.test-support.ts";
import { projectFileLedgerRow } from "../../../runtime/data/index.ts";
import { handlerContractDeclarations } from "../../generated-code-check.ts";
import { checkGeneratedUnit } from "../safety/unit-checks.ts";
import { buildUnitPrompt, ITEM_FILE_FIELD_RULE } from "./unit-prompts.ts";

const create = { kind: "handler", name: "create" } as const;

function createHandler(body: string, helpers = ""): string {
  return `${helpers}
export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {
  ${body}
}
`;
}

/** The scalar extractor a create prompt teaches, exactly as the model reads it. */
function taughtExtractor(spec: CapabilitySpec): string {
  const prompt = buildUnitPrompt(spec, create);
  const extractor = /Safe scalar extractor: `([^`]+)`/.exec(prompt)?.[1];
  if (!extractor) throw new Error("the create prompt teaches no scalar extractor");
  return extractor;
}

describe("a generated Handler compiled against the file projection", () => {
  test("declares the projection with the keys the runtime builds", () => {
    const declared = /interface CapabilityFileProjection \{([^}]*)\}/.exec(
      handlerContractDeclarations(photoSpec()),
    )?.[1];
    const keys = [...(declared ?? "").matchAll(/readonly (\w+):/g)].map(([, key]) => key);
    const projection = projectFileLedgerRow({
      key: mintFileKey(),
      capability_id: "photos",
      incarnation_id: "i",
      field: "photo",
      record_id: null,
      state: "pending",
      kind: "image",
      mime: "image/jpeg",
      size: 1,
      name: "a.jpg",
      encoding: null,
      created_at: "2026-09-24 00:00:00",
      cleanup_attempts: 0,
      cleanup_error: null,
    });
    expect(keys).toEqual(Object.keys(projection));
  });

  test("may narrow the photo, read its url and hand it back", () => {
    const content = createHandler(`const photo = input.values.photo;
  const shown = photo !== null && typeof photo === "object" && "url" in photo ? photo.url : "";
  const caption = typeof input.values.caption === "string" ? input.values.caption : "";
  const record = mutation.create({ caption, photo });
  const saved = record.fields.photo;
  const kind = saved !== null && typeof saved === "object" && "kind" in saved ? saved.kind : "";
  return present(record) + shown + kind;`);
    expect(checkGeneratedUnit(photoSpec(), create, content)).toBeUndefined();
  });

  test("may not treat the photo as the text it never is", () => {
    const content = createHandler(`const photo = input.values.photo;
  const name = photo === undefined ? "" : photo.trim();
  return present(mutation.create({ caption: name }));`);
    expect(checkGeneratedUnit(photoSpec(), create, content)?.message).toContain("trim");
  });
});

describe("an Action whose input never carries a file", () => {
  test("keeps the narrow input on a capability with a photo, so a copied search still compiles", () => {
    const search = `function scalarValue(value: string | readonly string[] | undefined): string {
  return typeof value === "string" ? value : "";
}
export default async function search({ input, query, present }: CapabilityContext): Promise<string> {
  const q = scalarValue(input.values.q);
  return query
    .records({ sql: 'SELECT "id" AS "target_id" FROM "cap_photos" WHERE instr("caption", ?) > 0', parameters: [q] })
    .map(({ record }) => present(record))
    .join("");
}
`;
    expect(
      checkGeneratedUnit(photoSpec(), { kind: "handler", name: "search" }, search),
    ).toBeUndefined();
  });

  test("is never told a file can arrive in its input", () => {
    for (const name of ["read", "delete", "search"] as const) {
      expect(buildUnitPrompt(photoSpec(), { kind: "handler", name })).not.toContain(
        "CapabilityFileProjection",
      );
    }
  });
});

describe("the contract a capability without a file field is checked against", () => {
  test("widens no value type, so its Handlers compile as they did before files", () => {
    const declarations = handlerContractDeclarations(notesSpec());
    expect(declarations).not.toContain("| CapabilityFileProjection");
    expect(declarations).toContain("interface CapabilityFileProjection");
    const narrow = createHandler(
      `const text = scalarValue(input.values.text);
  return present(mutation.create({ text, pinned: false }));`,
      `function scalarValue(value: string | readonly string[] | undefined): string {
  return typeof value === "string" ? value : "";
}`,
    );
    expect(checkGeneratedUnit(notesSpec(), create, narrow)).toBeUndefined();
  });
});

describe("the scalar extractor the prompt teaches", () => {
  for (const [name, spec, field] of [
    ["a capability with a photo", photoSpec(), "caption"],
    ["a capability without one", notesSpec(), "text"],
  ] as const) {
    test(`compiles for ${name}`, () => {
      const content = createHandler(
        `return present(mutation.create({ ${field}: scalarValue(input.values.${field}) }));`,
        taughtExtractor(spec),
      );
      expect(checkGeneratedUnit(spec, create, content)).toBeUndefined();
    });
  }

  test("is told what a file field arrives as only where one exists", () => {
    expect(buildUnitPrompt(photoSpec(), create)).toContain("CapabilityFileProjection | null");
    expect(buildUnitPrompt(notesSpec(), create)).not.toContain("CapabilityFileProjection");
  });
});

describe("a create written for the narrower input, on a capability with a photo", () => {
  test("fails the check, and the retry is told the readonly-safe extractor", () => {
    const narrow = createHandler(
      `return present(mutation.create({ caption: scalarValue(input.values.caption) }));`,
      `function scalarValue(value: string | readonly string[] | undefined): string {
  return typeof value === "string" ? value : "";
}`,
    );
    const failure = checkGeneratedUnit(photoSpec(), create, narrow);
    if (!failure) throw new Error("the narrow extractor compiled against the photo contract");

    const retry = buildUnitPrompt(photoSpec(), create, failure);
    expect(retry.slice(retry.indexOf("Failure to fix:"))).toContain(taughtExtractor(photoSpec()));
  });
});

describe("an update on a capability with a photo", () => {
  const update = { kind: "handler", name: "update" } as const;
  const updateHandler = (body: string) => `
export default async function update({ input, mutation, present }: CapabilityUpdateContext): Promise<string> {
  ${body}
}
`;

  test("is told what a file field arrives as, and never about a create's port", () => {
    const prompt = buildUnitPrompt(photoSpec(), update);
    const without = new Set(buildUnitPrompt(notesSpec(), update).split("\n"));
    const fileOnly = prompt.split("\n").filter((line) => !without.has(line));
    expect(fileOnly.some((line) => line.includes("`mutation.update`"))).toBe(true);
    expect(prompt).not.toContain("mutation.create");
    expect(buildUnitPrompt(notesSpec(), update)).not.toContain("CapabilityFileProjection");
  });

  test("may hand the submitted photo back to the patch it writes", () => {
    const content = updateHandler(`const patch: Record<string, unknown> = {};
  if (input.submittedFields.has("caption")) patch.caption = typeof input.values.caption === "string" ? input.values.caption : "";
  if (input.submittedFields.has("photo")) patch.photo = input.values.photo;
  const saved = mutation.update(patch).fields.photo;
  const url = saved !== null && typeof saved === "object" && "url" in saved ? saved.url : "";
  return present(mutation.update(patch)) + url;`);
    expect(checkGeneratedUnit(photoSpec(), update, content)).toBeUndefined();
  });

  test("may not treat the photo as the text it never is", () => {
    const content = updateHandler(`const photo = input.values.photo;
  return present(mutation.update({ caption: photo === undefined ? "" : photo.trim() }));`);
    expect(checkGeneratedUnit(photoSpec(), update, content)?.message).toContain("trim");
  });
});

describe("the item renderer's prompt", () => {
  const item = { kind: "item-renderer", name: "item" } as const;
  const showing = (shows: string[]): CapabilitySpec => {
    const spec = photoSpec();
    return { ...spec, ui_intent: { ...spec.ui_intent, item: { ...spec.ui_intent.item, shows } } };
  };

  test("says what a shown file field arrives as, and that it may be null", () => {
    const prompt = buildUnitPrompt(showing(["caption", "photo"]), item);
    expect(prompt).toContain(ITEM_FILE_FIELD_RULE);
  });

  test("says nothing of files to a card that shows none", () => {
    expect(buildUnitPrompt(showing(["caption"]), item)).not.toContain(
      "A file field's record value",
    );
    expect(buildUnitPrompt(notesSpec(), item)).not.toContain("A file field's record value");
  });
});
