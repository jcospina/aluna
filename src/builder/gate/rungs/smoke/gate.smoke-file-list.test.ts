// The smoke drives a `file[]` the way the list control posts it (Module 7 PLAN decision 38): a
// create with several files, each edit the list makes, search fixtures holding several files or
// the `NULL` an evolution leaves in older rows, and a hidden list held still through every edit.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: renderer source is string data.

import type { Database } from "bun:sqlite";
import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { MAX_LIST_FILES_ENV_VAR } from "../../../../platform/files/file-cap.ts";
import { requireFileLedgerRow } from "../../../../platform/files/store/ledger.test-support.ts";
import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  photoSpec,
} from "../../../../registry/fields/file.test-support.ts";
import type { CapabilitySpec } from "../../../../registry/index.ts";
import { deriveCapabilityTableDdl, FILE_REMOVE_PREFIX } from "../../../../runtime/data/index.ts";
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
import { scratchStoredFile } from "../../gate-scratch-files.ts";
import { runSmokeRung } from "./gate-smoke.ts";
import { SmokeRungFailure } from "./gate-smoke-repair.ts";
import {
  buildSmokeInput,
  buildUpdateInputs,
  leftOutCreate,
  mintSmokeFiles,
} from "./gate-smoke-samples.ts";
import { fixtureFieldValue } from "./gate-smoke-search.ts";

setDefaultTimeout(30_000);

const albumSpec = (album = ALBUM_FIELD) => photoSpec([CAPTION_FIELD, album]);
const requiredAlbumSpec = () => albumSpec({ ...ALBUM_FIELD, required: true });

function albumFiles(spec: CapabilitySpec, database: Database) {
  const all = mintSmokeFiles(spec, database);
  const minted = all.get(ALBUM_FIELD.name);
  if (!minted) throw new Error("Expected the album's smoke files.");
  return { all, ...minted };
}

describe("a file list's smoke samples", () => {
  test("create posts several pending files in order and expects them back in that order", () => {
    withScratch(albumSpec(), (database) => {
      const files = mintSmokeFiles(albumSpec(), database);
      const { created, beside } = files.get(ALBUM_FIELD.name) ?? ({} as never);
      const { input, expectedValues } = buildSmokeInput(albumSpec(), files);
      expect(input.values[ALBUM_FIELD.name]).toEqual([created.key, beside.key]);
      expect(expectedValues[ALBUM_FIELD.name]).toEqual([created.expected, beside.expected]);
      expect(requireFileLedgerRow(database, beside.key).state).toBe("pending");
    });
  });

  test("a second create leaves an optional list out and expects [], never null", () => {
    withScratch(albumSpec(), (database) => {
      const leftOut = leftOutCreate(albumSpec(), mintSmokeFiles(albumSpec(), database));
      expect(leftOut && ALBUM_FIELD.name in leftOut.input.values).toBe(false);
      expect(leftOut?.expectedValues[ALBUM_FIELD.name]).toEqual([]);
    });
  });

  test("a required list posts a file of its own to the second create", () => {
    const spec = photoSpec([
      CAPTION_FIELD,
      { ...ALBUM_FIELD, required: true },
      { ...ALBUM_FIELD, name: "extras", label: "Extras" },
    ]);
    withScratch(spec, (database) => {
      const { all, leftOut } = albumFiles(spec, database);
      const second = leftOutCreate(spec, all);
      expect(second?.input.values[ALBUM_FIELD.name]).toEqual([leftOut.key]);
      expect(second?.expectedValues.extras).toEqual([]);
    });
  });

  test("update keeps, drops one as the rest move up and one joins, removes all, posts none, and adds", () => {
    withScratch(albumSpec(), (database) => {
      const { all, created, beside, replacement, added } = albumFiles(albumSpec(), database);
      const edits = buildUpdateInputs(albumSpec(), all).filter(
        ({ field }) => field.name === ALBUM_FIELD.name,
      );
      expect(edits.map(({ input }) => input.values[ALBUM_FIELD.name])).toEqual([
        [created.key, beside.key],
        [beside.key, replacement.key, `${FILE_REMOVE_PREFIX}${created.key}`],
        [`${FILE_REMOVE_PREFIX}${beside.key}`, `${FILE_REMOVE_PREFIX}${replacement.key}`],
        [],
        [added.key],
      ]);
      expect(edits.map(({ expected }) => expected)).toEqual([
        [created.expected, beside.expected],
        [beside.expected, replacement.expected],
        [],
        [],
        [added.expected],
      ]);
    });
  });

  test("a required list takes only the edits that leave it holding files", () => {
    withScratch(requiredAlbumSpec(), (database) => {
      const { all } = albumFiles(requiredAlbumSpec(), database);
      const edits = buildUpdateInputs(requiredAlbumSpec(), all).filter(
        ({ field }) => field.name === ALBUM_FIELD.name,
      );
      expect(edits).toHaveLength(2);
      for (const { expected } of edits) expect((expected as unknown[]).length).toBe(2);
    });
  });
});

describe("a file list's scratch rows", () => {
  test("a stored list holds several files, each owned by its row", () => {
    withScratch(albumSpec(), (database) => {
      const stored = JSON.parse(
        scratchStoredFile(database, albumSpec(), ALBUM_FIELD, "row-1", "a.jpg"),
      ) as { key: string }[];
      expect(stored.length).toBeGreaterThan(1);
      expect(new Set(stored.map((file) => file.key)).size).toBe(stored.length);
      for (const { key } of stored) {
        expect(requireFileLedgerRow(database, key)).toMatchObject({
          state: "owned",
          record_id: "row-1",
        });
      }
    });
  });

  test("search fixtures hold a list on every other row and NULL on the rest, as evolution leaves it", () => {
    expect(fixtureFieldValue(ALBUM_FIELD, 2)).toEqual(expect.any(String));
    expect(fixtureFieldValue(ALBUM_FIELD, 3)).toBeNull();
  });
});

function albumGate(
  overrides: Partial<Record<HandlerUnitName, string>> = {},
  spec: CapabilitySpec = albumSpec(),
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

async function smokeFailure(input: CapabilityGateInput): Promise<SmokeRungFailure> {
  const error = await runSmokeRung(input).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(SmokeRungFailure);
  return error as SmokeRungFailure;
}

/** A Handler that changes the list it was handed before it writes it. */
function rewritten(source: string, rewrite: string): string {
  const changed = source.replace(".album = input.values.album;", `.album = ${rewrite};`);
  expect(changed).not.toBe(source);
  return changed;
}

describe("the smoke rung over a capability with a file list", () => {
  test("passes Handlers that hand the list back as they were given it, required or not", async () => {
    for (const spec of [albumSpec(), requiredAlbumSpec()]) {
      const run = await runSmokeRung(albumGate({}, spec));
      expect(run.result.attempts).toHaveLength(1);
    }
  });

  test("fails a create Handler that drops, reorders or nulls the list", async () => {
    const rewrites = [
      "(input.values.album as unknown[]).slice(1)",
      "[...(input.values.album as unknown[])].reverse()",
      "null",
    ];
    for (const rewrite of rewrites) {
      const create = rewritten(createHandlerFor(albumSpec()), rewrite);
      const failure = await smokeFailure(albumGate({ create }));
      expect(failure.diagnostic.smoke.action).toBe("create");
    }
  });

  test("fails an update Handler that drops an entry the edit kept", async () => {
    const update = rewritten(
      updateHandlerFor(albumSpec()),
      "(input.values.album as unknown[]).slice(1)",
    );
    const failure = await smokeFailure(albumGate({ update }));
    expect(failure.diagnostic.smoke.action).toBe("update");
  });

  test("fails a search that reads the list, whose only text is its files' names", async () => {
    const asText = albumSpec().schema.fields.map((field) =>
      field.name === ALBUM_FIELD.name
        ? { ...field, type: "string" as const, accepts: undefined }
        : field,
    );
    const readsTheList = searchHandlerFor({ ...albumSpec(), schema: { fields: asText } });
    const failure = await smokeFailure(albumGate({ search: readsTheList }));
    expect(failure.diagnostic.smoke.action).toBe("search");
  });

  test("runs whatever count the operator configured, since the platform holds lists to it", async () => {
    process.env[MAX_LIST_FILES_ENV_VAR] = "1";
    try {
      const run = await runSmokeRung(albumGate());
      expect(run.result.attempts).toHaveLength(1);
    } finally {
      delete process.env[MAX_LIST_FILES_ENV_VAR];
    }
  });

  test("hands a renderer and the readers the NULL an evolution leaves as []", async () => {
    const renderer = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  const album = record.album;",
      '  if (!Array.isArray(album)) throw new Error("album is not a list: " + JSON.stringify(album));',
      '  return `<p class="text-lg">${String(record.caption ?? "")} ${album.length}</p>`;',
      "}",
    ].join("\n");
    const spec = albumSpec();
    const shown = {
      ...spec,
      ui_intent: {
        ...spec.ui_intent,
        item: { ...spec.ui_intent.item, shows: ["caption", "album"] },
      },
    };
    const run = await runSmokeRung({ ...albumGate({}, shown), itemRenderer: renderer });
    expect(run.result.attempts).toHaveLength(1);
  });

  test("holds a hidden list still through every edit", async () => {
    const hidden = {
      ...ALBUM_FIELD,
      name: "old_album",
      label: "Old album",
      lifecycle: "inactive" as const,
    };
    const spec = photoSpec([CAPTION_FIELD, ALBUM_FIELD, hidden]);
    await runSmokeRung(albumGate({}, spec));
    const { tableName } = deriveCapabilityTableDdl(spec);
    const wipes = `CREATE TRIGGER "wipe_old_album" AFTER UPDATE OF "caption" ON "${tableName}" BEGIN UPDATE "${tableName}" SET "old_album" = NULL WHERE "id" = NEW."id"; END`;
    const failure = await smokeFailure(albumGate({}, spec, [wipes]));
    expect(failure.diagnostic.smoke.action).toBe("update");
  });
});
