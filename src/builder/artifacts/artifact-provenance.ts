// Per-derived-unit dependency-generation provenance (PLAN decision 24; ADR-0006).
//
// Audit evidence only: for each derived unit it records the active-context digest —
// and, when the Action reads external dependencies, the exact dependency
// incarnation/version and snapshot content digest — the bytes were last generated
// against. It verifies publication completeness and lets later reconciliation reason
// about historical generation, but it is never authored spec, candidate/spec equality,
// a Diff fact, or a cascade trigger. A regenerated unit records fresh provenance; a
// byte-copied unit carries its committed provenance forward unchanged (so an evolution
// that copies a unit does not manufacture a spurious difference).

import { z } from "zod";

import {
  type CapabilityRow,
  type CapabilitySpec,
  type CapabilityTool,
  incarnationIdSchema,
} from "../../registry/index.ts";
import { contentDigest } from "./artifact-digests.ts";
import { SnapshotVerificationError } from "./snapshot-error.ts";
import { buildUnitPrompt } from "../units/unit-prompts.ts";
import type { GeneratedUnit, UnitDescriptor } from "../units/units.ts";

// The complete derived-unit inventory a snapshot carries, in canonical order — the
// six units provenance is keyed by (the item renderer plus the five Action Handlers).
export const DERIVED_UNIT_FILES = [
  "item.ts",
  "create.ts",
  "read.ts",
  "update.ts",
  "delete.ts",
  "search.ts",
] as const;

export type DerivedUnitFile = (typeof DERIVED_UNIT_FILES)[number];

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const dependencyGenerationProvenanceSchema = z.strictObject({
  capability_id: z.string().min(1),
  incarnation_id: incarnationIdSchema,
  version: z.number().int().positive(),
  snapshot_content_digest: digestSchema,
});

export const unitGenerationProvenanceSchema = z.strictObject({
  active_context_digest: digestSchema,
  dependencies: z.array(dependencyGenerationProvenanceSchema),
});

export type UnitGenerationProvenance = z.infer<typeof unitGenerationProvenanceSchema>;

export const unitProvenanceManifestSchema = z.strictObject({
  "item.ts": unitGenerationProvenanceSchema,
  "create.ts": unitGenerationProvenanceSchema,
  "read.ts": unitGenerationProvenanceSchema,
  "update.ts": unitGenerationProvenanceSchema,
  "delete.ts": unitGenerationProvenanceSchema,
  "search.ts": unitGenerationProvenanceSchema,
});

export type UnitProvenanceManifest = z.infer<typeof unitProvenanceManifestSchema>;

/**
 * One active dependency snapshot after its committed bytes have passed complete
 * snapshot verification. This is deliberately narrower than the generation catalog:
 * prompts receive active authored context, while provenance records the immutable
 * identity of the exact bytes that context came from.
 */
export interface VerifiedDependencySnapshot {
  readonly capability_id: string;
  readonly incarnation_id: string;
  readonly version: number;
  readonly snapshot_content_digest: string;
}

/**
 * Provenance for a freshly generated complete inventory (a v1 build). Every unit's
 * bytes are new, so each records a fresh active-context digest. A v1 capability cannot
 * declare external dependencies; inventing dependency evidence here would be false, so
 * a non-empty `read_dependencies` fails closed.
 */
export function unitProvenance(
  spec: CapabilitySpec,
  units: readonly GeneratedUnit[],
): UnitProvenanceManifest {
  for (const dependencies of Object.values(spec.read_dependencies)) {
    if (dependencies.length > 0) {
      throw new SnapshotVerificationError(
        "Dependency provenance requires a verified dependency snapshot catalog.",
      );
    }
  }

  const provenanceFor = (filename: DerivedUnitFile): UnitGenerationProvenance => {
    const unit = units.find((candidate) => candidate.filename === filename);
    if (!unit) throw new SnapshotVerificationError(`Missing derived unit ${filename}.`);
    const descriptor: UnitDescriptor =
      unit.kind === "handler"
        ? { kind: "handler", name: unit.name }
        : { kind: "item-renderer", name: "item" };
    return {
      active_context_digest: contentDigest(buildUnitPrompt(spec, descriptor)),
      dependencies: [],
    };
  };

  return mapDerivedUnits(provenanceFor);
}

export interface EvolutionUnitProvenanceInput {
  /** The validated candidate spec regenerated units were generated against. */
  readonly candidateSpec: CapabilitySpec;
  /** The lease-frozen active rows projected into regenerated Handler prompts. */
  readonly dependencyCatalog: readonly CapabilityRow[];
  /** Verified immutable identities for the same lease-frozen dependency rows. */
  readonly dependencySnapshots: readonly VerifiedDependencySnapshot[];
  /** The committed snapshot's per-unit provenance, carried forward for copied units. */
  readonly committedProvenance: UnitProvenanceManifest;
  /** The derived-unit filenames the Diff work plan regenerated (the rest are copied). */
  readonly regeneratedFilenames: ReadonlySet<DerivedUnitFile>;
}

/**
 * The per-unit provenance one evolution records (PLAN decision 24; ADR-0006). A
 * regenerated unit gets a fresh `active_context_digest` over the candidate context it
 * was actually generated from; a byte-copied unit carries its committed provenance
 * forward verbatim, because its bytes — and the context they were generated against —
 * did not change. Provenance is audit evidence only: it never feeds candidate equality,
 * a Diff fact, or a cascade, so carrying it forward keeps the record honest without
 * manufacturing a difference.
 *
 * Fresh provenance for a regenerated dependency-bearing Action resolves only through the
 * lease-frozen verified dependency snapshot catalog. Missing evidence fails closed rather
 * than inventing an incarnation, version, or digest. Copied dependency-bearing units are
 * unaffected — their provenance is carried, not recomputed.
 */
export function evolutionUnitProvenance(
  input: EvolutionUnitProvenanceInput,
): UnitProvenanceManifest {
  const provenanceFor = (filename: DerivedUnitFile): UnitGenerationProvenance => {
    if (!input.regeneratedFilenames.has(filename)) return input.committedProvenance[filename];

    const action = handlerActionForFile(filename);
    return {
      active_context_digest: contentDigest(
        buildUnitPrompt(
          input.candidateSpec,
          descriptorForFile(filename),
          undefined,
          input.dependencyCatalog,
        ),
      ),
      dependencies: action ? dependencyProvenanceFor(input, action) : [],
    };
  };

  return mapDerivedUnits(provenanceFor);
}

function dependencyProvenanceFor(
  input: EvolutionUnitProvenanceInput,
  action: CapabilityTool,
): UnitGenerationProvenance["dependencies"] {
  return input.candidateSpec.read_dependencies[action].map((dependency) => {
    const snapshot = input.dependencySnapshots.find(
      (candidate) =>
        candidate.capability_id === dependency.capability_id &&
        candidate.incarnation_id === dependency.incarnation_id,
    );
    if (!snapshot) {
      throw new SnapshotVerificationError(
        `Dependency provenance is missing a verified snapshot for ${dependency.capability_id}/${dependency.incarnation_id}.`,
      );
    }
    return snapshot;
  });
}

function mapDerivedUnits(
  provenanceFor: (filename: DerivedUnitFile) => UnitGenerationProvenance,
): UnitProvenanceManifest {
  return {
    "item.ts": provenanceFor("item.ts"),
    "create.ts": provenanceFor("create.ts"),
    "read.ts": provenanceFor("read.ts"),
    "update.ts": provenanceFor("update.ts"),
    "delete.ts": provenanceFor("delete.ts"),
    "search.ts": provenanceFor("search.ts"),
  };
}

function descriptorForFile(filename: DerivedUnitFile): UnitDescriptor {
  return filename === "item.ts"
    ? { kind: "item-renderer", name: "item" }
    : { kind: "handler", name: handlerActionForFile(filename) as CapabilityTool };
}

function handlerActionForFile(filename: DerivedUnitFile): CapabilityTool | undefined {
  return filename === "item.ts" ? undefined : (filename.slice(0, -3) as CapabilityTool);
}
