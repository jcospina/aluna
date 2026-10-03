// Behavioral suites holding file tokens, carried through an evolution of the capability's file
// fields (Module 7 PLAN decision 39). The input digest decides: a suite whose inputs the change
// did not move is reused byte for byte, tokens included, and the rest regenerate.

import { describe, expect, test } from "bun:test";

import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../../../registry/fields/file.test-support.ts";
import {
  activeFileFields,
  type CapabilitySpec,
  type SpecField,
} from "../../../../../registry/index.ts";
import {
  type FullBehavioralFixture,
  type FullBehavioralTestSuite,
  frozenBehavioralTestsFor,
  fullBehavioralSuiteFor,
  makeBehaviorProvider,
} from "../../../gate.test-support.ts";
import { freezeBehavioralTests } from "./behavioral-test-freeze.ts";

const PHOTOS = photoSpec();

function photoFixture(photo?: "image"): FullBehavioralFixture {
  const held: Record<string, "image"> = photo === undefined ? {} : { photo };
  return {
    createValues: { caption: "Harbour at dawn", ...held },
    updateValues: { caption: "Harbour at dusk", ...held },
    readValues: { caption: "Read me", ...held },
    searchMatchValues: { caption: "Matching photo newest", ...held },
    searchOlderMatchValues: { caption: "Matching photo older" },
    searchMissValues: { caption: "Other photo", ...held },
    markerField: "caption",
    searchQuery: "matching",
  };
}

/** A missing-record case posts no file: the platform answers it before the Handler runs. */
function suiteFor(spec: CapabilitySpec, fixture: FullBehavioralFixture): FullBehavioralTestSuite {
  const files = new Set(activeFileFields(spec.schema.fields).map((field) => field.name));
  const cases = fullBehavioralSuiteFor(spec, fixture).cases.map((testCase) =>
    testCase.target === "missing_record"
      ? { ...testCase, input: testCase.input.filter(({ field }) => !files.has(field)) }
      : testCase,
  );
  return { cases };
}

const PRIOR = frozenBehavioralTestsFor(PHOTOS, suiteFor(PHOTOS, photoFixture("image")));

function actionsOf(prompts: readonly string[]): readonly string[] {
  return prompts.flatMap((prompt) => /Action under test: (\w+)/.exec(prompt)?.[1] ?? []);
}

async function evolveTo(fields: readonly SpecField[], fixture: FullBehavioralFixture) {
  const candidate = photoSpec(fields);
  const { provider, prompts } = makeBehaviorProvider(suiteFor(candidate, fixture));
  const result = await freezeBehavioralTests({
    provider,
    spec: candidate,
    priorFrozenTests: PRIOR,
  });
  return {
    regenerated: actionsOf(prompts),
    carried: (action: string) =>
      result.frozenTests.actions.find((entry) => entry.action === action),
    frozen: result.frozenTests,
  };
}

const priorOf = (action: string) => PRIOR.actions.find((entry) => entry.action === action);

describe("suites holding file tokens through an evolution", () => {
  test("a widened photo regenerates the writing suites and reuses the rest, tokens and all", async () => {
    const widened: SpecField = { ...PHOTO_FIELD, accepts: ["image", "document"] };
    const run = await evolveTo([CAPTION_FIELD, widened], photoFixture("image"));

    expect(run.regenerated).toEqual(["create", "update"]);
    for (const action of ["read", "delete", "search"]) {
      expect(run.carried(action)).toEqual(priorOf(action));
    }
    expect(JSON.stringify(run.carried("read"))).toContain('"image"');
  });

  test("an added list of files moves only the writing suites", async () => {
    const run = await evolveTo([CAPTION_FIELD, PHOTO_FIELD, ALBUM_FIELD], photoFixture("image"));

    expect(run.regenerated).toEqual(["create", "update"]);
    for (const action of ["read", "delete", "search"]) {
      expect(run.carried(action)).toEqual(priorOf(action));
    }
  });

  test("a hidden photo regenerates the suites whose rows still hold its token", async () => {
    const hidden: SpecField = { ...PHOTO_FIELD, lifecycle: "inactive" };
    const run = await evolveTo([CAPTION_FIELD, hidden], photoFixture());

    expect(run.regenerated).toEqual(["create", "read", "update", "delete", "search"]);
    expect(JSON.stringify(run.frozen)).not.toContain('"photo"');
  });
});
