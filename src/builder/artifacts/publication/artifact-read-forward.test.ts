import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  finalizeGenerationLifecycleFailure,
  finalizeGenerationLifecycleSuccess,
  startGenerationLifecycle,
} from "../../../platform/metrics/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import { FIRST_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import { type CapabilityRow, insertCapability } from "../../../registry/index.ts";
import { buildVerifiedDependencySnapshotCatalog } from "../../evolution/dependency-snapshot-catalog.ts";
import { generatedUnitsFor, notesFixtureGate, notesSpec } from "../../gate/gate.test-support.ts";
import type { CapabilityGateResult } from "../../gate/gate.ts";
import {
  publishCapabilitySnapshot,
  verifyCapabilitySnapshot,
  verifyStoredCapabilitySnapshot,
} from "./artifact-lifecycle.ts";
import { reconcileCapabilityArtifacts } from "./artifact-reconciliation.ts";
import { sealWithoutPlural } from "./read-forward.test-support.ts";

// A snapshot published before `plural_noun` existed is frozen without it. It is read forward with
// the registry row's plural and never rewritten, so its digests stay the ones it was sealed with.

const ROW_PLURAL = "jottings";

let gate: CapabilityGateResult;
let env: ScratchDbEnv;
let conns: PlatformDatabase;
let artifactsRoot: string;

beforeAll(async () => {
  gate = await notesFixtureGate({ enabled: false });
});

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-read-forward-");
  conns = env.conns;
  artifactsRoot = join(env.dir, "capabilities");
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

function publish(version = 1): string {
  return publishCapabilitySnapshot({
    buildId: `build-v${version}`,
    spec: notesSpec(),
    incarnationId: FIRST_INCARNATION_ID,
    version,
    units: [...generatedUnitsFor(notesSpec())],
    gate,
    artifactsRoot,
  }).directory;
}

describe("a snapshot written before plural_noun", () => {
  test("is read forward with the row's plural, and its bytes are never rewritten", () => {
    const directory = publish();
    const bytes = sealWithoutPlural(directory);

    const verified = verifyStoredCapabilitySnapshot(directory, { pluralNoun: ROW_PLURAL });

    expect(verified.spec.plural_noun).toBe(ROW_PLURAL);
    expect(readFileSync(join(directory, "spec.json"), "utf8")).toBe(bytes);
  });

  test("fails closed when nothing reads it forward, as a new snapshot missing it would", () => {
    const directory = publish();
    sealWithoutPlural(directory);

    expect(() => verifyCapabilitySnapshot(directory)).toThrow(/plural_noun/);
  });

  test("a snapshot carrying its own plural keeps it over the row's", () => {
    const directory = publish();

    const verified = verifyStoredCapabilitySnapshot(directory, { pluralNoun: ROW_PLURAL });

    expect(verified.spec.plural_noun).toBe(notesSpec().plural_noun);
  });

  test("boot reconciliation accepts it live against a row that carries the plural", () => {
    installLiveWithoutPlural();

    expect(() =>
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }),
    ).not.toThrow();
  });

  test("a history version below the live one is proven too", () => {
    sealWithoutPlural(publish(1));
    const live = publish(2);
    sealWithoutPlural(live);
    insertCapability(
      { ...liveRow(live), version: 2, plural_noun: notesSpec().plural_noun },
      conns.readwrite,
    );

    expect(() =>
      reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot }),
    ).not.toThrow();
  });

  test("an orphan above the live version is still proven and removed at boot", () => {
    installLiveWithoutPlural();
    const orphan = publish(2);
    sealWithoutPlural(orphan);
    const build = { buildId: "build-v2", incarnationId: FIRST_INCARNATION_ID };
    startGenerationLifecycle({ ...build, capabilityId: "notes", stages: [] }, conns.readwrite);
    finalizeGenerationLifecycleFailure(
      { ...build, outcome: "activation_failed", stages: [] },
      conns.readwrite,
    );

    reconcileCapabilityArtifacts({ database: conns.readwrite, artifactsRoot });

    expect(existsSync(orphan)).toBe(false);
  });

  test("an evolution's dependency catalog reads it forward rather than refusing to start", () => {
    const row = installLiveWithoutPlural();

    const [dependency] = buildVerifiedDependencySnapshotCatalog([row], "another_capability");

    expect(dependency?.capability_id).toBe(row.id);
  });
});

/** A live v1 row whose snapshot predates `plural_noun`, as all thirteen dev capabilities do. */
function installLiveWithoutPlural(): CapabilityRow {
  const directory = publish();
  sealWithoutPlural(directory);
  const build = { buildId: "build-v1", incarnationId: FIRST_INCARNATION_ID };
  startGenerationLifecycle({ ...build, capabilityId: "notes", stages: [] }, conns.readwrite);
  finalizeGenerationLifecycleSuccess(
    { ...build, outcome: "activated", stages: [] },
    conns.readwrite,
  );
  return insertCapability(liveRow(directory), conns.readwrite);
}

function liveRow(directory: string) {
  return {
    ...notesSpec(),
    plural_noun: ROW_PLURAL,
    incarnation_id: FIRST_INCARNATION_ID,
    version: 1,
    artifacts_path: `${directory}/`,
    seed: 184206,
    logo: { status: "absent" as const, attempts: 0 },
  };
}
