// A behavioral test names a file by a closed token (Module 7 PLAN decision 39): a family its
// field accepts, or null for none. The harness turns each token into a scratch reference, rows
// compare a file by its family and name, and the shape crosses OpenAI's strict mode.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { zodSchema } from "ai";

import { requireFileLedgerRow } from "../../../../platform/files/ledger.test-support.ts";
import { PHOTO_FIELD, photoSpec } from "../../../../registry/fields/file.test-support.ts";
import {
  deriveCapabilityTableDdl,
  FILE_CLEAR_VALUE,
  FILE_URL_PREFIX,
} from "../../../../runtime/data/index.ts";
import {
  createHandlerFor,
  type FullBehavioralTestSuite,
  frozenTierInput,
  fullBehavioralSuiteFor,
  fullHandlersFor,
  itemRendererFor,
  readHandlerFor,
  updateHandlerFor,
} from "../../gate.test-support.ts";
import type { CapabilityGateInput } from "../../gate.ts";
import { openScratchDatabasePair, prepareScratchCatalog } from "../../gate-internal.ts";
import { tokenFileName } from "../../gate-scratch-names.ts";
import { actionFixtureVocabulary } from "./freeze/behavioral-test-inputs.ts";
import { rowMatches } from "./gate-behavioral-shared.ts";
import {
  FullBehavioralCaseFailure,
  runFullBehavioralRung,
} from "./generation/gate-behavioral-full.ts";
import { assertActionSuiteContract } from "./generation/gate-behavioral-full-contract.ts";
import {
  actionBehavioralTestSuiteSchema,
  type FullBehavioralTestCase,
} from "./generation/gate-behavioral-full-schema.ts";
import { inputValuesToHandlerInput, scratchFormInput } from "./generation/gate-behavioral-input.ts";

setDefaultTimeout(30_000);

const PHOTO_SUITE: FullBehavioralTestSuite = fullBehavioralSuiteFor(photoSpec(), {
  createValues: { caption: "Harbour at dawn", photo: "image" },
  updateValues: { caption: "Harbour at dusk", photo: "image" },
  readValues: { caption: "Read me", photo: "image" },
  searchMatchValues: { caption: "Matching photo newest", photo: "image" },
  searchOlderMatchValues: { caption: "Matching photo older", photo: null },
  searchMissValues: { caption: "Other photo", photo: "image" },
  markerField: "caption",
  searchQuery: "matching",
});

function normalCase(action: FullBehavioralTestCase["action"]): FullBehavioralTestCase {
  const found = PHOTO_SUITE.cases.find(
    (candidate) =>
      candidate.action === action && !candidate.expectedError && !candidate.expectedPlatformError,
  );
  if (!found) throw new Error(`Expected a normal ${action} case.`);
  return found;
}

const CLEARS_THE_PHOTO: FullBehavioralTestCase = {
  ...normalCase("update"),
  name: "removes the photo and keeps the caption",
  setupRows: [
    {
      values: [
        { field: "caption", value: "Kept caption" },
        { field: "photo", value: "image" },
      ],
    },
  ],
  input: [{ field: "photo", value: null }],
  expectedRows: [
    {
      values: [
        { field: "caption", value: "Kept caption" },
        { field: "photo", value: null },
      ],
    },
  ],
  expectFragmentIncludes: ["Kept caption"],
};

const CREATES_WITHOUT_ONE: FullBehavioralTestCase = {
  ...normalCase("create"),
  name: "stores a caption with no photo",
  input: [
    { field: "caption", value: "Caption only" },
    { field: "photo", value: null },
  ],
  expectedRows: [
    {
      values: [
        { field: "caption", value: "Caption only" },
        { field: "photo", value: null },
      ],
    },
  ],
  expectFragmentIncludes: ["Caption only"],
};

/** A missing-record case posts no file: the platform would answer before the Handler ran. */
const withoutFilesOnMissingRecords = (testCase: FullBehavioralTestCase): FullBehavioralTestCase =>
  testCase.target === "missing_record"
    ? { ...testCase, input: testCase.input.filter(({ field }) => field !== PHOTO_FIELD.name) }
    : testCase;

const SUITE: FullBehavioralTestSuite = {
  cases: [
    ...PHOTO_SUITE.cases.map(withoutFilesOnMissingRecords),
    CLEARS_THE_PHOTO,
    CREATES_WITHOUT_ONE,
  ],
};

function photoRung(update = updateHandlerFor(photoSpec())): CapabilityGateInput {
  const spec = photoSpec();
  return {
    spec,
    ddl: deriveCapabilityTableDdl(spec),
    handlers: fullHandlersFor(spec, {
      create: createHandlerFor(spec),
      read: readHandlerFor(spec),
      update,
    }),
    itemRenderer: itemRendererFor(spec),
    behavioralTier: frozenTierInput(spec, SUITE),
  };
}

describe("the behavioral case shape", () => {
  test("takes a file's token as a required, nullable value, with no oneOf anywhere", () => {
    const json = zodSchema(actionBehavioralTestSuiteSchema).jsonSchema as {
      properties: {
        cases: {
          items: {
            properties: {
              input: {
                items: { required: string[]; properties: { value: { anyOf?: unknown[] } } };
              };
            };
          };
        };
      };
    };
    const entry = json.properties.cases.items.properties.input.items;
    expect(entry.required).toContain("value");
    expect(entry.properties.value.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
    expect(JSON.stringify(json)).not.toContain('"oneOf"');
  });

  test("tells the model which families a row's file field takes", () => {
    const photo = actionFixtureVocabulary(photoSpec()).row_fields.find(
      ({ name }) => name === PHOTO_FIELD.name,
    );
    expect(photo).toEqual({ name: "photo", type: "file", accepts: ["image"] });
  });
});

describe("the contract over file tokens", () => {
  const withInput = (value: string | null, field = "photo"): FullBehavioralTestCase => ({
    ...CREATES_WITHOUT_ONE,
    input: [
      { field: "caption", value: "Caption only" },
      { field, value },
    ],
  });
  const createSuite = (testCase: FullBehavioralTestCase) => [
    testCase,
    ...SUITE.cases.filter(({ action, expectedError }) => action === "create" && expectedError),
  ];

  test("admits a family the field accepts, or null", () => {
    for (const value of ["image", null]) {
      expect(() =>
        assertActionSuiteContract(photoSpec(), "create", createSuite(withInput(value))),
      ).not.toThrow();
    }
  });

  test("refuses a file name, an address, or a family the field does not accept", () => {
    for (const value of ["IMG_4821.JPG", "/files/x", "video", ""]) {
      expect(() =>
        assertActionSuiteContract(photoSpec(), "create", createSuite(withInput(value))),
      ).toThrow('gives file field "photo"');
    }
  });

  test("refuses null anywhere but a file field", () => {
    const nullCaption: FullBehavioralTestCase = {
      ...CREATES_WITHOUT_ONE,
      input: [{ field: "caption", value: null }],
    };
    expect(() =>
      assertActionSuiteContract(photoSpec(), "create", createSuite(nullCaption)),
    ).toThrow("only a file field takes null");
  });

  test("refuses a row whose file holds anything but a token", () => {
    const numbered: FullBehavioralTestCase = {
      ...CLEARS_THE_PHOTO,
      setupRows: [{ values: [{ field: "photo", value: 7 }] }],
    };
    expect(() =>
      assertActionSuiteContract(photoSpec(), "update", [
        numbered,
        ...SUITE.cases.filter((candidate) => candidate.action === "update"),
      ]),
    ).toThrow('setupRows[0] gives file field "photo" 7');
  });

  test("refuses a file posted to a missing record, which the platform answers before the Handler", () => {
    const missing = PHOTO_SUITE.cases.find(
      ({ target, action }) => action === "update" && target === "missing_record",
    );
    if (!missing) throw new Error("Expected a missing-record update case.");
    const updates = SUITE.cases.filter(
      ({ action, target }) => action === "update" && target !== "missing_record",
    );
    expect(missing.input.some(({ field }) => field === PHOTO_FIELD.name)).toBe(true);
    expect(() => assertActionSuiteContract(photoSpec(), "update", [...updates, missing])).toThrow(
      'posts file field "photo" to a missing record',
    );
    expect(() =>
      assertActionSuiteContract(photoSpec(), "update", [
        ...updates,
        withoutFilesOnMissingRecords(missing),
      ]),
    ).not.toThrow();
  });

  test("never counts a token as fragment evidence", () => {
    const assertsTheToken: FullBehavioralTestCase = {
      ...withInput("image"),
      expectFragmentIncludes: ["image"],
    };
    expect(() =>
      assertActionSuiteContract(photoSpec(), "create", createSuite(assertsTheToken)),
    ).toThrow("fragment assertions may use submitted input");
  });
});

describe("the harness", () => {
  test("posts a token as a pending scratch file of that family, named for it", () => {
    const scratch = openScratchDatabasePair();
    try {
      const input = inputValuesToHandlerInput(photoSpec(), [
        { field: "caption", value: "A day" },
        { field: "photo", value: "image" },
      ]);
      const form = scratchFormInput(photoSpec(), input, scratch.readwrite);
      const row = requireFileLedgerRow(scratch.readwrite, String(form.values.photo));
      expect(row).toMatchObject({ state: "pending", kind: "image", name: tokenFileName("image") });
    } finally {
      scratch.readonly.close();
      scratch.readwrite.close();
    }
  });

  test("posts none as an empty field, and a create's missing file field as one too", () => {
    const scratch = openScratchDatabasePair();
    try {
      for (const values of [
        [{ field: "photo", value: null }],
        [{ field: "caption", value: "A day" }],
      ]) {
        const input = inputValuesToHandlerInput(photoSpec(), values);
        expect(input.values.photo).toBe("");
        expect(input.submittedFields.has(PHOTO_FIELD.name)).toBe(true);
        expect(scratchFormInput(photoSpec(), input, scratch.readwrite).values.photo).toBe("");
      }
    } finally {
      scratch.readonly.close();
      scratch.readwrite.close();
    }
  });

  test("posts none on an edit as the clear when the record holds a file, and empty when not", () => {
    const spec = photoSpec();
    const scratch = openScratchDatabasePair();
    try {
      prepareScratchCatalog(spec, deriveCapabilityTableDdl(spec), [], scratch);
      const { tableName } = deriveCapabilityTableDdl(spec);
      scratch.readwrite
        .query(
          `INSERT INTO "${tableName}" ("id", "caption", "photo") VALUES (?, ?, ?), (?, ?, NULL)`,
        )
        .run("holds", "A day", '{"placeholder":true}', "empty", "A night");
      const none = inputValuesToHandlerInput(spec, [{ field: "photo", value: null }], ["photo"]);
      expect(scratchFormInput(spec, none, scratch.readwrite, "holds").values.photo).toBe(
        FILE_CLEAR_VALUE,
      );
      expect(scratchFormInput(spec, none, scratch.readwrite, "empty").values.photo).toBe("");
    } finally {
      scratch.readonly.close();
      scratch.readwrite.close();
    }
  });
});

describe("a photo capability's frozen suite", () => {
  test("passes Handlers that hand the photo back as they were given it", async () => {
    const { result } = await runFullBehavioralRung(photoRung());
    if (result.status !== "passed") throw new Error("Expected the behavioral tier to run.");
    const names = result.testRun.cases.map(({ name }) => name);
    expect(names).toContain(CLEARS_THE_PHOTO.name);
    expect(names).toContain(CREATES_WITHOUT_ONE.name);
  });

  test("fails an update Handler that runs the photo through the scalar extractor", async () => {
    const source = updateHandlerFor(photoSpec());
    const mangled = source.replace(
      "input.values.photo;",
      'String(input.values.photo ?? "").trim();',
    );
    expect(mangled).not.toBe(source);
    const error = await runFullBehavioralRung(photoRung(mangled)).catch((caught) => caught);
    expect(String(error)).toContain('Field "photo" holds a file reference');
    const cause = (error as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(FullBehavioralCaseFailure);
    const received = (cause as FullBehavioralCaseFailure).diagnostic.actionInput?.values.photo;
    expect(received).toMatchObject({
      kind: "image",
      url: expect.stringContaining(FILE_URL_PREFIX),
    });
  });

  test("compares a row's file by its family and name, never by its key", () => {
    const stored = (name: string, key: string) => ({
      id: "row",
      created_at: "2026-01-01 00:00:00",
      caption: "A day",
      photo: { url: `/files/${key}`, name, kind: "image" as const, mime: "image/jpeg", size: 1 },
    });
    const fields = photoSpec().schema.fields;
    const named = tokenFileName("image");
    expect(rowMatches(fields, stored(named, "a"), { photo: "image" })).toBe(true);
    expect(rowMatches(fields, stored(named, "b"), { photo: "image" })).toBe(true);
    expect(rowMatches(fields, stored("IMG_4821.JPG", "a"), { photo: "image" })).toBe(false);
    expect(rowMatches(fields, stored(named, "a"), { photo: null })).toBe(false);
    const empty = { ...stored(named, "a"), photo: null };
    expect(rowMatches(fields, empty, { photo: null })).toBe(true);
    expect(rowMatches(fields, empty, { photo: "image" })).toBe(false);
  });
});
