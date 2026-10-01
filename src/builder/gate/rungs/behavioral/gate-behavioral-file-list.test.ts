// A behavioral test names a `file[]`'s files by family token too (Module 7 PLAN decision 39): one
// input entry per file, in order, or a lone null, and an array of families in a row. The harness
// turns each token into a scratch file, rows compare file by file in order, and the input digest
// moves when a field starts holding a list.

import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { DEFAULT_MAX_LIST_FILES } from "../../../../platform/files/file-cap.ts";
import { requireFileLedgerRow } from "../../../../platform/files/store/ledger.test-support.ts";
import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../../registry/fields/file.test-support.ts";
import {
  type CapabilitySpec,
  defaultBehavioralErrorsForSchema,
  FULL_CAPABILITY_TOOLS,
} from "../../../../registry/index.ts";
import { deriveCapabilityTableDdl, FILE_REMOVE_PREFIX } from "../../../../runtime/data/index.ts";
import {
  createHandlerFor,
  type FullBehavioralTestSuite,
  frozenTierInput,
  fullBehavioralSuiteFor,
  fullHandlersFor,
  itemRendererFor,
  readHandlerFor,
  updateHandlerFor,
  withScratch,
} from "../../gate.test-support.ts";
import type { CapabilityGateInput } from "../../gate.ts";
import { scratchStoredFile } from "../../gate-scratch-files.ts";
import { tokenFileName } from "../../gate-scratch-names.ts";
import { actionTestInputDigest, actionTestInputs } from "./freeze/behavioral-test-inputs.ts";
import { rowMatches } from "./gate-behavioral-shared.ts";
import { runFullBehavioralRung } from "./generation/gate-behavioral-full.ts";
import { assertActionSuiteContract } from "./generation/gate-behavioral-full-contract.ts";
import type { FullBehavioralTestCase } from "./generation/gate-behavioral-full-schema.ts";
import { inputValuesToHandlerInput, scratchFormInput } from "./generation/gate-behavioral-input.ts";

setDefaultTimeout(30_000);

const albumSpec = (album = ALBUM_FIELD): CapabilitySpec => {
  const spec = photoSpec([CAPTION_FIELD, album]);
  return { ...spec, behavioral_errors: defaultBehavioralErrorsForSchema(spec.schema) };
};

const suiteFor = (spec: CapabilitySpec): FullBehavioralTestSuite =>
  fullBehavioralSuiteFor(spec, {
    createValues: { caption: "Lisbon in May", album: ["image", "document"] },
    updateValues: { caption: "Lisbon in June", album: ["document"] },
    readValues: { caption: "Read me", album: ["image"] },
    searchMatchValues: { caption: "Matching trip newest", album: ["image", "image"] },
    searchOlderMatchValues: { caption: "Matching trip older", album: null },
    searchMissValues: { caption: "Other trip", album: [] },
    markerField: "caption",
    searchQuery: "matching",
  });

const SUITE = suiteFor(albumSpec());

const withoutFilesOnMissingRecords = (testCase: FullBehavioralTestCase): FullBehavioralTestCase =>
  testCase.target === "missing_record"
    ? { ...testCase, input: testCase.input.filter(({ field }) => field !== ALBUM_FIELD.name) }
    : testCase;

function albumRung(): CapabilityGateInput {
  const spec = albumSpec();
  const suite = { cases: SUITE.cases.map(withoutFilesOnMissingRecords) };
  return {
    spec,
    ddl: deriveCapabilityTableDdl(spec),
    handlers: fullHandlersFor(spec, {
      create: createHandlerFor(spec),
      read: readHandlerFor(spec),
      update: updateHandlerFor(spec),
    }),
    itemRenderer: itemRendererFor(spec),
    behavioralTier: frozenTierInput(spec, suite),
  };
}

function normalCreate(): FullBehavioralTestCase {
  const found = SUITE.cases.find(
    (candidate) => candidate.action === "create" && !candidate.expectedError,
  );
  if (!found) throw new Error("Expected a normal create case.");
  return found;
}

describe("the harness over a file list", () => {
  test("posts each token as its own pending scratch file of that family, in order", () => {
    withScratch(albumSpec(), (database) => {
      const input = inputValuesToHandlerInput(albumSpec(), [
        { field: "caption", value: "A trip" },
        { field: "album", value: "document" },
        { field: "album", value: "image" },
      ]);
      expect(input.values.album).toEqual(["document", "image"]);
      const keys = scratchFormInput(albumSpec(), input, database).values.album as string[];
      expect(keys.map((key) => requireFileLedgerRow(database, key).kind)).toEqual([
        "document",
        "image",
      ]);
      for (const key of keys) expect(requireFileLedgerRow(database, key).state).toBe("pending");
    });
  });

  test("posts a lone null as none, and a create's missing list as none too", () => {
    withScratch(albumSpec(), (database) => {
      for (const values of [
        [{ field: "album", value: null }],
        [{ field: "caption", value: "x" }],
      ]) {
        const input = inputValuesToHandlerInput(albumSpec(), values);
        expect(input.values.album).toEqual([]);
        expect(scratchFormInput(albumSpec(), input, database).values.album).toEqual([]);
      }
    });
  });

  test("names every file an edit's record holds as removed, under none or under new files", () => {
    const spec = albumSpec();
    withScratch(spec, (database) => {
      const { tableName } = deriveCapabilityTableDdl(spec);
      const held = scratchStoredFile(database, spec, ALBUM_FIELD, "holds", "a.jpg");
      database
        .query(
          `INSERT INTO "${tableName}" ("id", "caption", "album") VALUES (?, ?, ?), (?, ?, NULL)`,
        )
        .run("holds", "A day", held, "older", "A night");
      const removals = (JSON.parse(held) as { key: string }[]).map(
        ({ key }) => `${FILE_REMOVE_PREFIX}${key}`,
      );
      const none = inputValuesToHandlerInput(spec, [{ field: "album", value: null }], ["album"]);
      expect(scratchFormInput(spec, none, database, "holds").values.album).toEqual(removals);
      expect(scratchFormInput(spec, none, database, "older").values.album).toEqual([]);
      const one = inputValuesToHandlerInput(spec, [{ field: "album", value: "image" }], ["album"]);
      const posted = scratchFormInput(spec, one, database, "holds").values.album as string[];
      expect(posted.slice(1)).toEqual(removals);
    });
  });
});

describe("the contract over a file list's tokens", () => {
  const create = (input: FullBehavioralTestCase["input"]) => [
    { ...normalCreate(), input: [{ field: "caption", value: "Lisbon in May" }, ...input] },
  ];
  const holds = (spec: CapabilitySpec, testCases: FullBehavioralTestCase[]) => () =>
    assertActionSuiteContract(spec, "create", [
      ...testCases,
      ...suiteFor(spec).cases.filter(
        ({ action, expectedError }) => action === "create" && expectedError,
      ),
    ]);

  test("admits one entry per file, each a family the field takes, or a lone null", () => {
    const admitted = [
      [
        { field: "album", value: "image" },
        { field: "album", value: "document" },
      ],
      [{ field: "album", value: null }],
    ];
    for (const input of admitted) expect(holds(albumSpec(), create(input))).not.toThrow();
  });

  test("refuses a family the field doesn't take, and null beside a file", () => {
    expect(holds(albumSpec(), create([{ field: "album", value: "video" }]))).toThrow();
    const beside = [
      { field: "album", value: "image" },
      { field: "album", value: null },
    ];
    expect(holds(albumSpec(), create(beside))).toThrow();
  });

  test("admits an array of families in a row, and refuses one holding anything else", () => {
    const row = (value: string[] | null) => [
      {
        ...normalCreate(),
        expectedRows: [
          {
            values: [
              { field: "caption", value: "Lisbon in May" },
              { field: "album", value },
            ],
          },
        ],
      },
    ];
    expect(holds(albumSpec(), row(["image", "document"]))).not.toThrow();
    expect(holds(albumSpec(), row(["image", "/files/a.jpg"]))).toThrow();
  });

  test("refuses a row giving a list null beside a file, in either order", () => {
    const rowOf = (values: { field: string; value: string | null }[]) => [
      {
        ...normalCreate(),
        expectedRows: [{ values: [{ field: "caption", value: "Lisbon in May" }, ...values] }],
      },
    ];
    for (const values of [
      [
        { field: "album", value: "image" },
        { field: "album", value: null },
      ],
      [
        { field: "album", value: null },
        { field: "album", value: "image" },
      ],
    ]) {
      expect(holds(albumSpec(), rowOf(values))).toThrow();
    }
  });

  test("refuses more files than a list holds, in an input or a row", () => {
    const many = Array.from({ length: DEFAULT_MAX_LIST_FILES + 1 }, () => ({
      field: "album",
      value: "image",
    }));
    expect(holds(albumSpec(), create(many))).toThrow();
  });

  test("holds a single file field to nothing new, so a suite frozen before lists still passes", () => {
    const one = { ...ALBUM_FIELD, type: "file" as const };
    const beside = [
      { field: "album", value: "image" },
      { field: "album", value: null },
    ];
    const posting = (spec: CapabilitySpec) =>
      holds(
        spec,
        create(beside).map((c) => ({
          ...c,
          expectedRows: [
            {
              values: [
                { field: "caption", value: "Lisbon in May" },
                { field: "album", value: "image" },
              ],
            },
          ],
        })),
      );
    expect(posting(albumSpec(one))).not.toThrow();
    expect(posting(albumSpec())).toThrow();
  });

  test("refuses a save expected to go through that leaves a required list empty", () => {
    const required = albumSpec({ ...ALBUM_FIELD, required: true });
    const empty = create([{ field: "album", value: null }]);
    expect(holds(required, empty)).toThrow();
  });
});

describe("a row's file list", () => {
  const stored = (names: string[]) => ({
    id: "row",
    created_at: "2026-01-01 00:00:00",
    caption: "A trip",
    album: names.map((name, index) => ({
      url: `/files/${index}`,
      name,
      kind: "image" as const,
      mime: "image/jpeg",
      size: 1,
    })),
  });
  const fields = albumSpec().schema.fields;
  const named = tokenFileName("image");

  test("compares file by file, in order, by family and name and never by key", () => {
    expect(rowMatches(fields, stored([named, named]), { album: ["image", "image"] })).toBe(true);
    expect(rowMatches(fields, stored([named]), { album: ["image", "image"] })).toBe(false);
    expect(rowMatches(fields, stored([named, "IMG_1.JPG"]), { album: ["image", "image"] })).toBe(
      false,
    );
  });

  test("reads null and [] alike as a list holding none", () => {
    expect(rowMatches(fields, stored([]), { album: null })).toBe(true);
    expect(rowMatches(fields, stored([]), { album: [] })).toBe(true);
    expect(rowMatches(fields, stored([named]), { album: null })).toBe(false);
  });
});

describe("a file list's input digest", () => {
  const digests = (spec: CapabilitySpec) =>
    FULL_CAPABILITY_TOOLS.map((action) => actionTestInputDigest(actionTestInputs(spec, action)));

  test("moves for create and update when a file field starts holding a list", () => {
    const one = photoSpec([CAPTION_FIELD, { ...PHOTO_FIELD, name: "album", accepts: ["image"] }]);
    const many = photoSpec([CAPTION_FIELD, { ...ALBUM_FIELD, accepts: ["image"] }]);
    const before = digests(one);
    const after = digests(many);
    const moved = FULL_CAPABILITY_TOOLS.filter((_, index) => before[index] !== after[index]);
    expect(moved).toEqual(expect.arrayContaining(["create", "update"]));
    expect(moved).not.toContain("delete");
  });
});

describe("a capability with a file list's frozen suite", () => {
  test("passes Handlers that hand the list back as they were given it", async () => {
    const { result } = await runFullBehavioralRung(albumRung());
    expect(result.status).toBe("passed");
  });
});
