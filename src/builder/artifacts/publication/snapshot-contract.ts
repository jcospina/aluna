// What a publishable snapshot has to be true of, stated apart from the machinery that
// writes one.
//
// These are the checks `artifact-lifecycle.ts` runs at the two boundaries it cannot take
// on trust: before staged bytes are published, and after a manifest is read back off
// disk. They live here because the questions they answer — is this the complete canonical
// Gate result, is this inventory exactly what the tier requires, does the tier metadata
// describe work that actually happened — are the snapshot's contract rather than steps in
// assembling one, and reading them together is the only way to see that contract whole.

import type { CapabilityGateResult } from "../../gate/gate.ts";
import type { GeneratedUnit } from "../../units/generation/units.ts";
import { sameOrderedStrings } from "../inventory/artifact-digests.ts";
import { DERIVED_UNIT_FILES } from "../inventory/artifact-provenance.ts";
import { SnapshotVerificationError } from "../inventory/snapshot-error.ts";
import type { SnapshotManifest } from "./artifact-lifecycle.ts";

export const SNAPSHOT_MANIFEST_FILE = "snapshot.json";
export const SPEC_FILE = "spec.json";
export const FROZEN_BEHAVIORAL_TEST_FILE = "tests/behavioral.json";

export function assertSuccessfulGate(gate: CapabilityGateResult): void {
  const expected = ["structural", "smoke", "behavioral", "design-lint"] as const;
  if (
    gate.outcomes.length !== expected.length ||
    !gate.outcomes.every((outcome, index) => outcome.rung === expected[index])
  ) {
    throw new SnapshotVerificationError("Publication requires the complete canonical Gate result.");
  }
  for (const outcome of gate.outcomes) {
    const allowedSkipped = outcome.rung === "behavioral" && gate.behavioral.tier === "off";
    if (outcome.status !== "passed" && !(allowedSkipped && outcome.status === "skipped")) {
      throw new SnapshotVerificationError(
        `Publication requires a successful ${outcome.rung} Gate rung.`,
      );
    }
  }
  assertBehavioralGateMatchesTier(gate);
}

export function assertUnitsMatchGateVerdict(
  units: readonly GeneratedUnit[],
  gate: CapabilityGateResult,
): void {
  for (const unit of units) {
    const gatedContent =
      unit.kind === "item-renderer" ? gate.designLint?.itemRenderer : gate.handlers?.[unit.name];
    if (gatedContent !== unit.content) {
      throw new SnapshotVerificationError(
        `Generated artifact ${unit.filename} does not match the bytes cleared by the Gate.`,
      );
    }
  }
}

function assertBehavioralGateMatchesTier(gate: CapabilityGateResult): void {
  const behavioralOutcome = gate.outcomes.find((outcome) => outcome.rung === "behavioral");
  const expectedStatus = gate.behavioral.tier === "on" ? "passed" : "skipped";
  if (gate.behavioral.status !== expectedStatus || behavioralOutcome?.status !== expectedStatus) {
    throw new SnapshotVerificationError(
      `Tier-${gate.behavioral.tier} publication requires a ${expectedStatus} behavioral Gate rung.`,
    );
  }
}

export function assertGeneratedUnitInventory(units: readonly GeneratedUnit[]): void {
  const actual = units.map((unit) => unit.filename);
  if (!sameOrderedStrings(actual, DERIVED_UNIT_FILES)) {
    throw new SnapshotVerificationError(
      `Generated artifact inventory must be exactly ${DERIVED_UNIT_FILES.join(", ")} in order.`,
    );
  }
}

/**
 * The tier metadata's own internal contract. Tier state and tier metadata are one
 * fact: a tier-on snapshot that cannot say what it executed is as incomplete as one missing
 * its frozen tests, and a tier-off snapshot describing test execution describes work the
 * contract says never happened. Beyond presence, two invariants are cheap here and
 * expensive to discover later — a freshly authored suite that never judged code must not
 * reach a published version, and a full-suite fallback that skipped something is not a full
 * suite. They are asserted at the boundary rather than trusted from the Gate, exactly as the
 * frozen suite's own contract is.
 */
function assertBehavioralTestMetadataShape(manifest: SnapshotManifest): void {
  const behavioralTests = manifest.behavioral_tests;
  if ((behavioralTests !== undefined) !== (manifest.behavioral_tier === "on")) {
    throw new SnapshotVerificationError(
      `A tier-${manifest.behavioral_tier} snapshot must ${manifest.behavioral_tier === "on" ? "record" : "omit"} per-Action behavioral test metadata.`,
    );
  }
  if (behavioralTests) assertBehavioralTestEntries(behavioralTests);
}

/** The tier-on metadata's internal consistency, once presence is already settled. */
function assertBehavioralTestEntries(
  behavioralTests: NonNullable<SnapshotManifest["behavioral_tests"]>,
): void {
  const actions = behavioralTests.actions.map((entry) => entry.action);
  if (new Set(actions).size !== actions.length) {
    throw new SnapshotVerificationError(
      "Behavioral test metadata must record each Action exactly once.",
    );
  }
  for (const entry of behavioralTests.actions) {
    if (entry.source === "generated" && entry.execution === "skipped") {
      throw new SnapshotVerificationError(
        `Behavioral tests authored for ${entry.action} in this build were never executed against it.`,
      );
    }
    if (behavioralTests.full_suite && entry.execution === "skipped") {
      throw new SnapshotVerificationError(
        `A full-suite behavioral run cannot report ${entry.action} as skipped.`,
      );
    }
  }
  if (behavioralTests.full_suite !== (behavioralTests.full_suite_reason !== undefined)) {
    throw new SnapshotVerificationError(
      "A full-suite behavioral run must record why execution could not be narrowed.",
    );
  }
}

export function assertManifestShape(manifest: SnapshotManifest): void {
  assertBehavioralTestMetadataShape(manifest);
  const snapshotEntries = manifest.files.filter((entry) => entry.path === SNAPSHOT_MANIFEST_FILE);
  if (snapshotEntries.length !== 1 || snapshotEntries[0]?.content_digest !== undefined) {
    throw new SnapshotVerificationError(
      "snapshot.json must appear exactly once without a self-digest.",
    );
  }
  const paths = manifest.files.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length || !sameOrderedStrings(paths, [...paths].sort())) {
    throw new SnapshotVerificationError(
      "Snapshot inventory must be unique and canonically ordered.",
    );
  }
  const requiredPaths = [
    SNAPSHOT_MANIFEST_FILE,
    SPEC_FILE,
    ...DERIVED_UNIT_FILES,
    ...(manifest.behavioral_tier === "on" ? [FROZEN_BEHAVIORAL_TEST_FILE] : []),
  ].sort();
  if (!sameOrderedStrings(paths, requiredPaths)) {
    throw new SnapshotVerificationError(
      `Snapshot inventory must be exactly [${requiredPaths.join(", ")}] for tier ${manifest.behavioral_tier}.`,
    );
  }
  for (const entry of manifest.files) {
    if (entry.path !== SNAPSHOT_MANIFEST_FILE && entry.content_digest === undefined) {
      throw new SnapshotVerificationError(
        `Snapshot entry ${entry.path} is missing its content digest.`,
      );
    }
  }
}
