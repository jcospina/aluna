// Behavioral test execution follows executable impact — Module 4.7/02 (PLAN decision 23's
// execution clause; ADR-0006). The engine-level half of 4.7/02: generation is settled
// before any Handler byte (4.7/01), and *these* runs prove that which frozen suites then
// execute follows the copy/regenerate split — end to end, over real snapshots on disk, with
// the verdict landing in the assembly report, the snapshot manifest, and the metrics row.
// Providers are fake: no network, no spend.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CapabilityGateResult,
  frozenBehavioralTestsSchema,
  SnapshotVerificationError,
  verifyCapabilitySnapshot,
} from "../../builder/index.ts";
import type { CapabilitySpec } from "../../registry/index.ts";
import {
  activated,
  behaviorNeutralDueDateCandidate,
  committedGate,
  type EngineEnv,
  evolve,
  setUpCommitted,
  tearDownCommitted,
  versionDirectory,
} from "./evolution-run.test-support.ts";

let gate: CapabilityGateResult;
let env: EngineEnv;

beforeAll(async () => {
  gate = await committedGate();
});

/** One Action's frozen cases as published bytes, for byte-identity comparisons. */
function frozenActionCases(directory: string, action: string): unknown {
  const frozen = frozenBehavioralTestsSchema.parse(
    JSON.parse(readFileSync(join(directory, "tests/behavioral.json"), "utf8")),
  );
  return frozen.actions.find((entry) => entry.action === action)?.cases;
}

/**
 * Publish the tier-on base every narrowing test evolves from. v2 is decision 24's off→on
 * transition: the committed base carries no frozen tests, so every Action's suite is authored
 * from current intent and every one of them runs — nothing is narrowed and nothing is skipped.
 */
async function publishTierOnBase(buildId: string): Promise<CapabilitySpec> {
  const neutral = behaviorNeutralDueDateCandidate();
  // The list shows both fields, so a later evolution has a field it can take *away* — the
  // direction that makes a carried fragment assertion unsatisfiable.
  const base: CapabilitySpec = {
    ...neutral,
    ui_intent: {
      ...neutral.ui_intent,
      item: { ...neutral.ui_intent.item, shows: ["text", "due_date"] },
    },
  };
  const first = activated(
    await evolve(env, base, "add a due date", { behavioralTierEnabled: true, buildId }),
  );
  expect(
    first.assembly.behavioralExecution?.actions.every(
      (entry) => entry.source === "generated" && entry.execution === "executed",
    ),
  ).toBe(true);
  return base;
}

describe("behavioral test execution under evolution", () => {
  beforeEach(async () => {
    env = await setUpCommitted(gate);
  });

  afterEach(() => {
    tearDownCommitted(env);
  });

  test("a schema change runs the Actions it touched and leaves the untouched suites alone", async () => {
    const base = await publishTierOnBase("impact-base");

    // v3 adds a second nullable non-text field. `create`/`update` inputs move, so their
    // tests are authored fresh and must run; `read`/`delete`/`search` carry byte-identical
    // suites over byte-identical Handlers, so those three do not run at all — the saving
    // decision 23's execution clause exists to make.
    const candidate: CapabilitySpec = {
      ...base,
      schema: {
        fields: [
          ...base.schema.fields,
          {
            name: "reminded_at",
            label: "Reminded at",
            type: "date",
            required: false,
            lifecycle: "active",
          },
        ],
      },
    };
    const result = await evolve(env, candidate, "add a reminder date", {
      behavioralTierEnabled: true,
      buildId: "selective-execution",
    });
    const outcome = activated(result);

    expect(outcome.assembly.regeneratedUnits).toEqual(["create", "update"]);
    expect(
      outcome.assembly.behavioralExecution?.actions.map(
        (entry) => `${entry.action}:${entry.source}:${entry.execution}`,
      ),
    ).toEqual([
      "create:generated:executed",
      "read:copied:skipped",
      "update:generated:executed",
      "delete:copied:skipped",
      "search:copied:skipped",
    ]);
    expect(outcome.assembly.behavioralExecution?.fullSuite).toBe(false);
    if (outcome.assembly.gate.behavioral.tier !== "on") {
      throw new Error("expected a tier-on evolution");
    }
    // Only the two impacted Actions' cases executed — the frozen suite is complete in the
    // snapshot, but the run is not the artifact.
    expect([
      ...new Set(outcome.assembly.gate.behavioral.testRun.cases.map((entry) => entry.action)),
    ]).toEqual(["create", "update"]);

    const manifest = verifyCapabilitySnapshot(versionDirectory(env, 3)).manifest;
    expect(
      manifest.behavioral_tests?.actions.filter((entry) => entry.execution === "skipped"),
    ).toHaveLength(3);
    // The three skipped suites are byte-identical to v2's — copy first, then the run/skip
    // decision; the artifact never changes because execution did or did not happen.
    for (const action of ["read", "delete", "search"] as const) {
      expect(frozenActionCases(versionDirectory(env, 3), action)).toEqual(
        frozenActionCases(versionDirectory(env, 2), action),
      );
    }
    // The frozen artifact still covers all five Actions: skipping execution never shrinks
    // the intent a version is held to.
    const frozen = frozenBehavioralTestsSchema.parse(
      JSON.parse(
        readFileSync(join(outcome.publication.directory, "tests/behavioral.json"), "utf8"),
      ),
    );
    expect(frozen.actions).toHaveLength(5);
  });

  test("changing which fields the item renderer shows runs the complete frozen suite", async () => {
    // The renderer is not a Handler and covers no Action, so a narrowing that only watched
    // Handlers would skip everything here. But every fragment assertion is rendered through
    // it and may only name row values: drop a field from `item.shows` and a carried `read`
    // assertion naming that field's value stops being satisfiable by *any* renderer, with
    // no Handler moving and no test digest moving. That is coverage that cannot be narrowed,
    // and decision 23 answers it with the full frozen suite.
    const base = await publishTierOnBase("shows-base");
    const narrowedItem: CapabilitySpec = {
      ...base,
      ui_intent: {
        ...base.ui_intent,
        item: { ...base.ui_intent.item, shows: ["text"] },
      },
    };
    const result = await evolve(env, narrowedItem, "just show the text in the list", {
      behavioralTierEnabled: true,
      buildId: "shows-narrowed",
    });
    const outcome = activated(result);

    // Only the renderer was rewritten, and every suite carried — yet all five ran.
    expect(outcome.assembly.regeneratedUnits).toEqual(["item"]);
    expect(outcome.assembly.behavioralTests.every((entry) => entry.status === "carried")).toBe(
      true,
    );
    expect(outcome.assembly.behavioralExecution?.fullSuite).toBe(true);
    expect(outcome.assembly.behavioralExecution?.fullSuiteReason).toContain(
      "fields the item renderer may show changed",
    );
    expect(
      outcome.assembly.behavioralExecution?.actions.every(
        (entry) => entry.source === "copied" && entry.reason === "full_suite_fallback",
      ),
    ).toBe(true);
    expect(
      verifyCapabilitySnapshot(versionDirectory(env, 3)).manifest.behavioral_tests,
    ).toMatchObject({ full_suite: true });
  });

  test("a mutated copy of the frozen tests fails snapshot verification", async () => {
    // Copy is byte-for-byte or it is nothing. The published suite is content-digested into
    // the manifest, so editing an assertion after the fact — the one way code could ever
    // "win" an argument with frozen intent — cannot survive a read of the snapshot.
    const outcome = activated(
      await evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
        behavioralTierEnabled: true,
        buildId: "mutated-copy",
      }),
    );
    const frozenPath = join(outcome.publication.directory, "tests/behavioral.json");
    const original = readFileSync(frozenPath, "utf8");
    expect(verifyCapabilitySnapshot(outcome.publication.directory).manifest.behavioral_tier).toBe(
      "on",
    );

    writeFileSync(
      frozenPath,
      original.replace(/"expectedRowCount":\s*\d+/u, '"expectedRowCount":0'),
    );

    expect(() => verifyCapabilitySnapshot(outcome.publication.directory)).toThrow(
      SnapshotVerificationError,
    );
  });
});
