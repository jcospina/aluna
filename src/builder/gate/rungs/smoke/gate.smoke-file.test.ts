// The smoke drives a file field the way the form's photo control posts it, with scratch references
// minted in the scratch database's own ledger (Module 7 PLAN decision 38), so a Handler that
// mangles a photo or a search that reads one fails the Gate.

import type { Database } from "bun:sqlite";
import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { MAX_NAME_BYTES } from "../../../../platform/files/file-name.ts";
import { requireFileLedgerRow } from "../../../../platform/files/ledger.test-support.ts";
import {
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../../registry/fields/file.test-support.ts";
import type { CapabilitySpec, SpecField } from "../../../../registry/index.ts";
import { deriveCapabilityTableDdl, FILE_CLEAR_VALUE } from "../../../../runtime/data/index.ts";
import type { HandlerUnitName } from "../../../units/generation/units.ts";
import {
  createHandlerFor,
  fullHandlersFor,
  itemRendererFor,
  readHandlerFor,
  searchHandlerFor,
  updateHandlerFor,
  withScratch,
} from "../../gate.test-support.ts";
import type { CapabilityGateInput } from "../../gate.ts";
import { runSmokeRung } from "./gate-smoke.ts";
import { SmokeRungFailure } from "./gate-smoke-repair.ts";
import {
  buildSmokeInput,
  buildUpdateInputs,
  leftOutCreate,
  mintSmokeFiles,
} from "./gate-smoke-samples.ts";

setDefaultTimeout(30_000);

function withMintedFiles<T>(
  spec: CapabilitySpec,
  run: (files: ReturnType<typeof mintSmokeFiles>, database: Database) => T,
): T {
  return withScratch(spec, (database) => run(mintSmokeFiles(spec, database), database));
}

const COVER_FIELD = { ...PHOTO_FIELD, name: "cover", label: "Cover" };

function requiredPhotoSpec(): CapabilitySpec {
  return photoSpec([CAPTION_FIELD, { ...PHOTO_FIELD, required: true }]);
}

/** A required photo beside an optional cover: the second create leaves one out and posts one. */
function requiredAndOptionalSpec(): CapabilitySpec {
  return photoSpec([CAPTION_FIELD, { ...PHOTO_FIELD, required: true }, COVER_FIELD]);
}

function photoFiles(files: ReturnType<typeof mintSmokeFiles>) {
  const minted = files.get(PHOTO_FIELD.name);
  if (!minted) throw new Error("Expected the photo's smoke files.");
  return minted;
}

describe("a file field's smoke samples", () => {
  test("create posts a pending scratch file, submits every field, and expects to read it back", () => {
    withMintedFiles(photoSpec(), (files, database) => {
      const { created } = photoFiles(files);
      const { input, expectedValues } = buildSmokeInput(photoSpec(), files);
      expect(input.values[PHOTO_FIELD.name]).toBe(created.key);
      expect([...input.submittedFields]).toEqual([CAPTION_FIELD.name, PHOTO_FIELD.name]);
      expect(expectedValues[PHOTO_FIELD.name]).toEqual(created.expected);
      expect(requireFileLedgerRow(database, created.key).state).toBe("pending");
    });
  });

  test("a second create leaves an optional photo out, as a request other than the form may", () => {
    withMintedFiles(photoSpec(), (files) => {
      const leftOut = leftOutCreate(photoSpec(), files);
      expect(leftOut && PHOTO_FIELD.name in leftOut.input.values).toBe(false);
      expect([...(leftOut?.input.submittedFields ?? [])]).toEqual([CAPTION_FIELD.name]);
      expect(leftOut?.expectedValues[PHOTO_FIELD.name]).toBeNull();
    });
  });

  test("a required photo is never left out, so a spec with only that one has no second create", () => {
    const spec = requiredPhotoSpec();
    withMintedFiles(spec, (files) => {
      expect(leftOutCreate(spec, files)).toBeUndefined();
    });
  });

  test("a second create posts a required photo a file of its own, leaving the optional one out", () => {
    const spec = requiredAndOptionalSpec();
    withMintedFiles(spec, (files) => {
      const leftOut = leftOutCreate(spec, files);
      const own = photoFiles(files).leftOut;
      expect(leftOut?.input.values[PHOTO_FIELD.name]).toBe(own.key);
      expect(leftOut?.expectedValues[PHOTO_FIELD.name]).toEqual(own.expected);
      expect(leftOut && COVER_FIELD.name in leftOut.input.values).toBe(false);
      expect(leftOut?.input.submittedFields.has(COVER_FIELD.name)).toBe(false);
      expect(own.key).not.toBe(photoFiles(files).created.key);
    });
  });

  test("a required photo takes only the edits that leave it holding a file: keep and replace", () => {
    const spec = requiredPhotoSpec();
    withMintedFiles(spec, (files) => {
      const { created, replacement } = photoFiles(files);
      const edits = buildUpdateInputs(spec, files).filter(
        ({ field }) => field.name === PHOTO_FIELD.name,
      );
      expect(edits.map(({ input }) => input.values[PHOTO_FIELD.name])).toEqual([
        created.key,
        replacement.key,
      ]);
    });
  });

  test("update posts what the control will, each edit starting where the last left the field", () => {
    withMintedFiles(photoSpec(), (files) => {
      const { created, replacement, added } = photoFiles(files);
      const edits = buildUpdateInputs(photoSpec(), files).filter(
        ({ field }) => field.name === PHOTO_FIELD.name,
      );
      expect(edits.map(({ input }) => input.values[PHOTO_FIELD.name])).toEqual([
        created.key,
        replacement.key,
        FILE_CLEAR_VALUE,
        "",
        added.key,
      ]);
      expect(edits.map(({ expected }) => expected)).toEqual([
        created.expected,
        replacement.expected,
        null,
        null,
        added.expected,
      ]);
      for (const { input } of edits) expect([...input.submittedFields]).toEqual([PHOTO_FIELD.name]);
    });
  });

  test("names every scratch file apart, with markup and an emoji, in the most bytes a name keeps", () => {
    withMintedFiles(photoSpec(), (files, database) => {
      const names = Object.values(photoFiles(files)).map(
        ({ key }) => requireFileLedgerRow(database, key).name,
      );
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) {
        expect(name).toMatch(/<[a-z]+[^>]*>/);
        expect(name).toMatch(/\p{Extended_Pictographic}/u);
        expect(Buffer.byteLength(name, "utf8")).toBe(MAX_NAME_BYTES);
      }
    });
  });
});

const HIDDEN_PHOTO = {
  ...PHOTO_FIELD,
  name: "old_photo",
  label: "Old photo",
  lifecycle: "inactive" as const,
};

function photoGate(
  overrides: Partial<Record<HandlerUnitName, string>> = {},
  spec: CapabilitySpec = photoSpec(),
  extraStatements: readonly string[] = [],
): CapabilityGateInput {
  const ddl = deriveCapabilityTableDdl(spec);
  return {
    spec,
    ddl: { ...ddl, statements: [...ddl.statements, ...extraStatements] },
    handlers: fullHandlersFor(spec, {
      create: createHandlerFor(spec),
      read: readHandlerFor(spec),
      ...overrides,
    }),
    itemRenderer: itemRendererFor(spec),
  };
}

/** A photo capability whose choice holds its file's kind inside an option, as search reads it. */
function sourcedPhotoSpec(): CapabilitySpec {
  const kind = PHOTO_FIELD.accepts?.[0] ?? "";
  const source: SpecField = {
    name: "source",
    label: "Source",
    type: "choice",
    required: true,
    lifecycle: "active",
    values: [
      { value: `${kind.toUpperCase()} scan`, label: "Scan" },
      { value: "camera", label: "Camera" },
    ],
    groups: [],
  };
  const spec = photoSpec([CAPTION_FIELD, PHOTO_FIELD, source]);
  const form = {
    ...spec.ui_intent.form,
    choice_inputs: [{ field: "source", presentation: "picker" as const }],
  };
  return { ...spec, ui_intent: { ...spec.ui_intent, form } };
}

async function smokeFailure(input: CapabilityGateInput): Promise<SmokeRungFailure> {
  const error = await runSmokeRung(input).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(SmokeRungFailure);
  return error as SmokeRungFailure;
}

/** A Handler that runs the photo through the scalar extractor a text field gets. */
function scalarPhoto(source: string): string {
  const mangled = source.replace("input.values.photo;", 'String(input.values.photo ?? "").trim();');
  expect(mangled).not.toBe(source);
  return mangled;
}

describe("the smoke rung over a photo capability", () => {
  test("passes Handlers that hand the photo back as they were given it", async () => {
    const run = await runSmokeRung(photoGate());
    expect(run.result.attempts).toHaveLength(1);
  });

  test("passes Handlers over a required photo, which no edit empties", async () => {
    for (const spec of [requiredPhotoSpec(), requiredAndOptionalSpec()]) {
      const run = await runSmokeRung(photoGate({}, spec));
      expect(run.result.attempts).toHaveLength(1);
    }
  });

  test("fails a create Handler that runs the photo through the scalar extractor", async () => {
    const failure = await smokeFailure(
      photoGate({ create: scalarPhoto(createHandlerFor(photoSpec())) }),
    );
    expect(failure.diagnostic.smoke.action).toBe("create");
    expect(failure.message).toContain('Field "photo" holds a file reference');
  });

  test("fails a create Handler that assumes the photo is always posted", async () => {
    const source = createHandlerFor(photoSpec());
    const assumes = source.replace(
      "  const missing: string[] = [];",
      '  const missing: string[] = [];\n  void (input.values.photo === null ? "none" : (input.values.photo as { kind: string }).kind);',
    );
    expect(assumes).not.toBe(source);
    const failure = await smokeFailure(photoGate({ create: assumes }));
    expect(failure.diagnostic.smoke.action).toBe("create");
    expect(failure.message).toContain("undefined");
  });

  test("fails an update Handler that runs the photo through the scalar extractor", async () => {
    const failure = await smokeFailure(
      photoGate({ update: scalarPhoto(updateHandlerFor(photoSpec())) }),
    );
    expect(failure.diagnostic.smoke.action).toBe("update");
    expect(failure.message).toContain('Field "photo" holds a file reference');
  });

  test("fails a search that reads the photo, whose only text is its name", async () => {
    const asText = photoSpec().schema.fields.map((field) =>
      field.name === PHOTO_FIELD.name ? { ...field, type: "string" as const } : field,
    );
    const readsThePhoto = searchHandlerFor({ ...photoSpec(), schema: { fields: asText } });
    const failure = await smokeFailure(photoGate({ search: readsThePhoto }));
    expect(failure.diagnostic.smoke.action).toBe("search");
    expect(failure.message).toContain("file exclusion");
  });

  test("fails a search that reads the photo's stored kind", async () => {
    const source = searchHandlerFor(photoSpec());
    const readsTheKind = source.replace(
      '(coalesce(instr(platform_search_normalize("target"."caption"), platform_search_normalize("search_term"."term")), 0) > 0)',
      '(coalesce(instr(platform_search_normalize("target"."caption"), platform_search_normalize("search_term"."term")), 0) > 0) OR (coalesce(instr(platform_search_normalize(json_extract("target"."photo", \\\'$.kind\\\')), platform_search_normalize("search_term"."term")), 0) > 0)',
    );
    expect(readsTheKind).not.toBe(source);
    const failure = await smokeFailure(photoGate({ search: readsTheKind }));
    expect(failure.diagnostic.smoke.action).toBe("search");
    expect(failure.message).toContain("file kind exclusion");
  });

  test("drops the kind case a choice option holds, and still fails a search reading the type", async () => {
    const spec = sourcedPhotoSpec();
    const run = await runSmokeRung(photoGate({}, spec));
    expect(run.result.attempts).toHaveLength(1);
    const source = searchHandlerFor(spec);
    const readsTheType = source.replace(
      '(coalesce(instr(platform_search_normalize("target"."caption"), platform_search_normalize("search_term"."term")), 0) > 0)',
      '(coalesce(instr(platform_search_normalize("target"."caption"), platform_search_normalize("search_term"."term")), 0) > 0) OR (coalesce(instr(platform_search_normalize(json_extract("target"."photo", \\\'$.mime\\\')), platform_search_normalize("search_term"."term")), 0) > 0)',
    );
    expect(readsTheType).not.toBe(source);
    const failure = await smokeFailure(photoGate({ search: readsTheType }, spec));
    expect(failure.diagnostic.smoke.action).toBe("search");
    expect(failure.message).toContain("file type exclusion");
  });

  test("ties its tied rows exactly, so ranking matches by the photo gets one verdict", async () => {
    for (const fields of [
      [PHOTO_FIELD, CAPTION_FIELD],
      [CAPTION_FIELD, PHOTO_FIELD],
    ]) {
      const spec = photoSpec(fields);
      const source = searchHandlerFor(spec);
      const byPhoto = source.replace(
        'ORDER BY "target"."created_at" DESC',
        `ORDER BY ' + (terms.length === 0 ? '' : '"target"."photo" DESC, ') + '"target"."created_at" DESC`,
      );
      expect(byPhoto).not.toBe(source);
      for (let run = 0; run < 3; run += 1) await runSmokeRung(photoGate({ search: byPhoto }, spec));
    }
  });

  test("holds a hidden photo still through every edit", async () => {
    const spec = photoSpec([CAPTION_FIELD, PHOTO_FIELD, HIDDEN_PHOTO]);
    await runSmokeRung(photoGate({}, spec));
    const { tableName } = deriveCapabilityTableDdl(spec);
    const wipesTheHiddenPhoto = `CREATE TRIGGER "wipe_old_photo" AFTER UPDATE OF "caption" ON "${tableName}" BEGIN UPDATE "${tableName}" SET "old_photo" = NULL WHERE "id" = NEW."id"; END`;
    const failure = await smokeFailure(photoGate({}, spec, [wipesTheHiddenPhoto]));
    expect(failure.message).toContain("changed omitted/protected column old_photo");
  });
});
