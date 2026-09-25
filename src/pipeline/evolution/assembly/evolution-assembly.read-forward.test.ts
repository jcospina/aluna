import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { sealWithoutPlural } from "../../../builder/artifacts/publication/read-forward.test-support.ts";
import {
  generatedUnitsFor,
  makeSequenceProvider,
  notesFixtureGate,
  notesSpec,
} from "../../../builder/gate/gate.test-support.ts";
import {
  type CapabilityGateResult,
  diffCapabilitySpec,
  publishCapabilitySnapshot,
} from "../../../builder/index.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import { FIRST_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import { capabilitySpecFromRow, insertCapability } from "../../../registry/index.ts";
import { assembleEvolutionCandidate } from "./evolution-assembly.ts";

// Every capability built before `plural_noun` existed is committed on a snapshot without it, so
// the first evolution of each one must assemble on top of that snapshot rather than refuse it.

let gate: CapabilityGateResult;
let env: ScratchDbEnv;

beforeAll(async () => {
  gate = await notesFixtureGate({ enabled: false });
});

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-assembly-read-forward-");
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

describe("evolving a capability whose committed snapshot predates plural_noun", () => {
  test("assembles on that base without a model call for a copy-only change", async () => {
    const { directory } = publishCapabilitySnapshot({
      buildId: "build-v1",
      spec: notesSpec(),
      incarnationId: FIRST_INCARNATION_ID,
      version: 1,
      units: [...generatedUnitsFor(notesSpec())],
      gate,
      artifactsRoot: join(env.dir, "capabilities"),
    });
    sealWithoutPlural(directory);
    const committed = insertCapability(
      {
        ...notesSpec(),
        incarnation_id: FIRST_INCARNATION_ID,
        version: 1,
        artifacts_path: `${directory}/`,
        seed: 184206,
        logo: { status: "absent", attempts: 0 },
      },
      env.conns.readwrite,
    );
    const candidate = { ...capabilitySpecFromRow(committed), label: "Jottings" };

    const assembled = await assembleEvolutionCandidate({
      committed,
      candidate,
      diff: diffCapabilitySpec(capabilitySpecFromRow(committed), candidate),
      provider: makeSequenceProvider([]).provider,
      behavioralTierEnabled: false,
    });

    expect(assembled.regeneratedUnits).toEqual([]);
    expect(assembled.additiveMigration.statements).toEqual([]);
  });
});
