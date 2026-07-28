// Freezing behavioral intent before any Handler work (4.7/01, PLAN decision 23).

import { describe, expect, test } from "bun:test";

import type { CapabilitySpec } from "../../../registry/index.ts";
import {
  DEFAULT_BEHAVIORAL_SUITE,
  frozenBehavioralTestsFor,
  fullBehavioralSuiteFor,
  makeBehaviorProvider,
  makeSequenceProvider,
  notesSpec,
} from "../gate.test-support.ts";
import { BehavioralTestGenerationError, freezeBehavioralTests } from "./behavioral-test-freeze.ts";
import { actionTestInputDigest, actionTestInputs } from "./behavioral-test-inputs.ts";

const NOTES = notesSpec();

function actionsOf(prompts: readonly string[]): readonly string[] {
  return prompts.flatMap((prompt) => /Action under test: (\w+)/.exec(prompt)?.[1] ?? []);
}

/** The same notes capability with `pinned` promoted to required — a create/update change. */
function requiredPinnedSpec(): CapabilitySpec {
  return notesSpec({
    schema: {
      fields: NOTES.schema.fields.map((field) =>
        field.name === "pinned" ? { ...field, required: true } : field,
      ),
    },
  });
}

describe("freezing behavioral intent — generation", () => {
  test("generates every Action independently on a first build", async () => {
    const { provider, prompts } = makeBehaviorProvider();

    const result = await freezeBehavioralTests({ provider, spec: NOTES });

    expect(actionsOf(prompts)).toEqual(["create", "read", "update", "delete", "search"]);
    expect(result.report.map((entry) => `${entry.action}:${entry.status}`)).toEqual([
      "create:generated",
      "read:generated",
      "update:generated",
      "delete:generated",
      "search:generated",
    ]);
    expect(result.testCount).toBe(DEFAULT_BEHAVIORAL_SUITE.cases.length);
    expect(result.usage.totalTokens).toBe(5 * 18);
  });

  test("each Action's frozen entry is content-addressed to its own closed inputs", async () => {
    const { provider } = makeBehaviorProvider();

    const { frozenTests } = await freezeBehavioralTests({ provider, spec: NOTES });

    for (const entry of frozenTests.actions) {
      expect(entry.input_digest).toBe(actionTestInputDigest(actionTestInputs(NOTES, entry.action)));
      for (const testCase of entry.cases) expect(testCase.action).toBe(entry.action);
    }
  });

  test("the report names the inputs each Action's tests came from", async () => {
    const { provider } = makeBehaviorProvider();

    const { report } = await freezeBehavioralTests({ provider, spec: NOTES });
    const byAction = new Map(report.map((entry) => [entry.action, entry]));

    expect(byAction.get("create")?.inputs).toEqual({
      behavior: true,
      schemaFields: ["pinned", "text"],
      behavioralErrorCodes: ["missing_required_fields"],
      dependencies: [],
    });
    // read/delete carry no schema at all, and only create/update own authored errors here.
    expect(byAction.get("read")?.inputs.schemaFields).toEqual([]);
    expect(byAction.get("delete")?.inputs.behavioralErrorCodes).toEqual([]);
    expect(byAction.get("search")?.inputs.schemaFields).toEqual(["text"]);
  });
});

describe("freezing behavioral intent — carry-forward on unchanged inputs", () => {
  test("unchanged total inputs regenerate nothing at all", async () => {
    // The sequence provider throws when asked for anything, so "no regeneration" is proof
    // rather than an assertion about counts.
    const { provider, prompts } = makeSequenceProvider([]);

    const result = await freezeBehavioralTests({
      provider,
      spec: NOTES,
      priorFrozenTests: frozenBehavioralTestsFor(NOTES),
    });

    expect(prompts).toEqual([]);
    expect(result.report.every((entry) => entry.status === "carried")).toBe(true);
    expect(result.usage.totalTokens).toBe(0);
    expect(result.frozenTests).toEqual(frozenBehavioralTestsFor(NOTES));
  });

  test("a label-only change regenerates nothing", async () => {
    const relabelled = notesSpec({
      label: "Jottings",
      schema: {
        fields: NOTES.schema.fields.map((field) => ({ ...field, label: `${field.label} (v2)` })),
      },
    });
    const { provider, prompts } = makeSequenceProvider([]);

    const result = await freezeBehavioralTests({
      provider,
      spec: relabelled,
      priorFrozenTests: frozenBehavioralTestsFor(NOTES),
    });

    expect(prompts).toEqual([]);
    expect(result.report.every((entry) => entry.status === "carried")).toBe(true);
  });

  test("a field-order-only change regenerates nothing", async () => {
    const reordered = notesSpec({ schema: { fields: [...NOTES.schema.fields].reverse() } });
    const { provider, prompts } = makeSequenceProvider([]);

    const result = await freezeBehavioralTests({
      provider,
      spec: reordered,
      priorFrozenTests: frozenBehavioralTestsFor(NOTES),
    });

    expect(prompts).toEqual([]);
    expect(result.report.every((entry) => entry.status === "carried")).toBe(true);
  });

  test("a required change regenerates exactly the mapped Actions", async () => {
    const candidate = requiredPinnedSpec();
    const suite = fullBehavioralSuiteFor(candidate, {
      createValues: { text: "Behavioral note", pinned: true },
      updateValues: { text: "Updated note", pinned: true },
      readValues: { text: "Read me", pinned: true },
      searchMatchValues: { text: "Matching note newest", pinned: true },
      searchOlderMatchValues: { text: "Matching note older", pinned: true },
      searchMissValues: { text: "Other entry", pinned: true },
      markerField: "text",
      searchQuery: "matching",
    });
    const { provider, prompts } = makeBehaviorProvider(suite);
    const prior = frozenBehavioralTestsFor(NOTES);

    const result = await freezeBehavioralTests({
      provider,
      spec: candidate,
      priorFrozenTests: prior,
    });

    expect(actionsOf(prompts)).toEqual(["create", "update"]);
    expect(result.report.map((entry) => `${entry.action}:${entry.status}`)).toEqual([
      "create:generated",
      "read:carried",
      "update:generated",
      "delete:carried",
      "search:carried",
    ]);
    // The carried entries are the prior bytes, untouched.
    const carriedRead = result.frozenTests.actions.find((entry) => entry.action === "read");
    expect(carriedRead).toEqual(prior.actions.find((entry) => entry.action === "read"));
  });

  test("prior tests whose digests no longer match are not reused", async () => {
    const candidate = requiredPinnedSpec();
    // A prior artifact claiming the *new* digests would be a lie; one claiming the old ones
    // simply does not match, so those Actions regenerate.
    const stale = frozenBehavioralTestsFor(NOTES);
    const { provider, prompts } = makeBehaviorProvider(
      fullBehavioralSuiteFor(candidate, {
        createValues: { text: "Behavioral note", pinned: true },
        updateValues: { text: "Updated note", pinned: true },
        readValues: { text: "Read me", pinned: true },
        searchMatchValues: { text: "Matching note newest", pinned: true },
        searchOlderMatchValues: { text: "Matching note older", pinned: true },
        searchMissValues: { text: "Other entry", pinned: true },
        markerField: "text",
        searchQuery: "matching",
      }),
    );

    const { frozenTests } = await freezeBehavioralTests({
      provider,
      spec: candidate,
      priorFrozenTests: stale,
    });

    expect(actionsOf(prompts)).toEqual(["create", "update"]);
    for (const entry of frozenTests.actions) {
      expect(entry.input_digest).toBe(
        actionTestInputDigest(actionTestInputs(candidate, entry.action)),
      );
    }
  });
});

describe("freezing behavioral intent — platform admission", () => {
  test("an inadmissible delete suite is never frozen", async () => {
    const suite = structuredClone(DEFAULT_BEHAVIORAL_SUITE);
    const deleteCase = suite.cases.find(
      (testCase) => testCase.action === "delete" && testCase.target === "first_setup_row",
    );
    if (!deleteCase) throw new Error("default suite is missing normal delete coverage");
    deleteCase.expectFragmentIncludes = ["Behavioral note"];
    const { provider } = makeBehaviorProvider(suite);

    const failure = await freezeBehavioralTests({ provider, spec: NOTES }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(BehavioralTestGenerationError);
    expect((failure as BehavioralTestGenerationError).action).toBe("delete");
    expect((failure as Error).message).toContain("delete returns no observable item evidence");
  });

  test("hiding a fixture field regenerates stale carried suites instead of bricking retries", async () => {
    const candidate = notesSpec({
      schema: {
        fields: NOTES.schema.fields.map((field) =>
          field.name === "pinned" ? { ...field, lifecycle: "inactive" as const } : field,
        ),
      },
    });
    const candidateSuite = fullBehavioralSuiteFor(candidate, {
      createValues: { text: "Behavioral note" },
      updateValues: { text: "Updated note" },
      readValues: { text: "Read me" },
      searchMatchValues: { text: "Matching note newest" },
      searchOlderMatchValues: { text: "Matching note older" },
      searchMissValues: { text: "Other entry" },
      markerField: "text",
      searchQuery: "matching",
    });
    const { provider, prompts } = makeBehaviorProvider(candidateSuite);

    const result = await freezeBehavioralTests({
      provider,
      spec: candidate,
      priorFrozenTests: frozenBehavioralTestsFor(NOTES),
    });

    // create/update digests move. Read/delete/search digests do not, but their v1 fixture
    // rows name `pinned`, so candidate admission turns each stale carry into regeneration.
    expect(actionsOf(prompts)).toEqual(["create", "read", "update", "delete", "search"]);
    expect(result.report.every((entry) => entry.status === "generated")).toBe(true);
    expect(JSON.stringify(result.frozenTests)).not.toContain("pinned");
  });
});
