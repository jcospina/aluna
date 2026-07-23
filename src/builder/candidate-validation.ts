// Candidate-spec validation — Module 4.6/01 (PLAN decisions 1, 2, 4, 22 and the
// change-fact matrix's invalid-candidate row; ADR-0006 candidate ownership).
//
// The AI authors one complete candidate spec for an evolving capability; the
// platform validates it here — **before any DDL or unit generation** — against
// the current committed spec and the lease-frozen dependency-generation catalog.
// A candidate that fails never reaches the Diff stage: rejection is loud and
// total, never a partial acceptance or a silent all-Handler fallback
// (decision 22). A candidate that passes emerges as the validated canonical
// value the Diff Engine (4.6/02) compares against the committed spec.
//
// Three layers, in order:
//
//   1. The registry's own spec gate (`promptCapabilitySpecSchema`) — structural
//      shape, the fixed five-Action inventory, Action ownership in
//      errors/dependencies, list-input coverage, reserved names, active-only
//      presentation references. Its strict objects also reject every
//      platform-owned lifecycle key (`incarnation_id`, `version`, build id,
//      snapshot metadata, `artifacts_path`) and any patch/migration/regeneration
//      shape — the AI authors a complete spec, nothing else (decision 1).
//   2. The cross-spec field-lifecycle contract (decision 2): each committed
//      field returns exactly once with immutable name and type;
//      `inactive → inactive` is identical; `active → inactive` changes only
//      lifecycle; reactivation may also change label/required; a new field is
//      born active. Omission is invalid — it is never a soft hide.
//   3. Frozen-catalog resolution (decision 1): every declared dependency pair
//      must be exactly one catalog entry. The catalog was captured under the
//      build lease, so this cannot race a concurrent build.

import type { ZodError } from "zod";
import {
  type CapabilityRow,
  type CapabilitySpec,
  promptCapabilitySpecSchema,
  type SpecField,
} from "../registry/index.ts";
import type { DependencyGenerationCatalogEntry } from "./dependency-catalog.ts";

/**
 * The committed row's authored-spec view, tolerating legacy labels. The row was
 * already validated by the registry's `capabilityRowSchema`, so this only strips
 * the platform-owned lifecycle metadata — it deliberately does NOT re-parse
 * through `capabilitySpecFromRow`. That helper's strict `capabilityNameText`
 * label would reject a committed capability whose stored label is narration-like
 * (older rows the row schema tolerates and every display path canonicalizes),
 * making such a capability impossible to evolve for a reason unrelated to the
 * candidate. Evolution only ever changes the label going forward — the strict
 * gate applies to the candidate, never to the already-committed input.
 */
export function committedSpecView(row: CapabilityRow): CapabilitySpec {
  return {
    id: row.id,
    label: row.label,
    schema: row.schema,
    ui_intent: row.ui_intent,
    behavior: row.behavior,
    behavioral_errors: row.behavioral_errors,
    tools: row.tools,
    read_dependencies: row.read_dependencies,
    prompt_context: row.prompt_context,
  };
}

/** One contract violation, dev-preview friendly: where, and what went wrong. */
export interface CandidateValidationIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * The total rejection: every violation found, never just the first. The
 * `diagnostic` mirrors the issues so the shared build-error preview
 * (`buildDemoErrorPreview`) surfaces them in the developer panel unchanged.
 */
export class CandidateValidationError extends Error {
  override readonly name = "CandidateValidationError";
  readonly issues: readonly CandidateValidationIssue[];
  readonly diagnostic: { readonly issues: readonly CandidateValidationIssue[] };

  constructor(issues: readonly CandidateValidationIssue[]) {
    const summary = issues[0]?.message ?? "unknown violation";
    super(
      issues.length === 1
        ? `Invalid evolution candidate: ${summary}`
        : `Invalid evolution candidate: ${issues.length} contract violations, first: ${summary}`,
    );
    this.issues = issues;
    this.diagnostic = { issues };
  }
}

export interface ValidateCandidateSpecInput {
  /** The exact committed row the candidate evolves — including inactive fields. */
  readonly committed: CapabilityRow;
  /** The raw model output. Unknown on purpose: the gate owns its shape. */
  readonly candidate: unknown;
  /** The lease-frozen catalog; the only admissible dependency source. */
  readonly dependencyCatalog: readonly DependencyGenerationCatalogEntry[];
}

/**
 * Validate one authored candidate completely. Returns the validated canonical
 * candidate for the Diff stage, or throws {@link CandidateValidationError}
 * carrying every violation.
 */
export function validateCandidateSpec(input: ValidateCandidateSpecInput): CapabilitySpec {
  const parsed = promptCapabilitySpecSchema.safeParse(input.candidate);
  if (!parsed.success) {
    throw new CandidateValidationError(zodIssues(parsed.error));
  }

  const candidate = parsed.data;
  const committed = committedSpecView(input.committed);
  const issues: CandidateValidationIssue[] = [];

  if (candidate.id !== committed.id) {
    issues.push({
      path: "id",
      message: `capability id is immutable; expected "${committed.id}", got "${candidate.id}"`,
    });
  }

  validateFieldLifecycleContract(committed, candidate, issues);
  validateDependenciesAgainstCatalog(candidate, input.dependencyCatalog, issues);

  if (issues.length > 0) throw new CandidateValidationError(issues);
  return candidate;
}

// Decision 2, field by field. Candidate field names are already unique (schema
// gate), so per-name presence is the whole exactly-once story: a missing name is
// an omission (or a rename-as-replacement, which also surfaces the impostor as a
// new field), and a present name is compared attribute by attribute.
function validateFieldLifecycleContract(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
  issues: CandidateValidationIssue[],
): void {
  const committedByName = new Map(committed.schema.fields.map((field) => [field.name, field]));
  const candidateByName = new Map(candidate.schema.fields.map((field) => [field.name, field]));

  for (const committedField of committed.schema.fields) {
    issues.push(...committedFieldIssues(committedField, candidateByName.get(committedField.name)));
  }

  for (const candidateField of candidate.schema.fields) {
    if (committedByName.has(candidateField.name)) continue;
    if (candidateField.lifecycle !== "active") {
      issues.push({
        path: `schema.fields.${candidateField.name}.lifecycle`,
        message: `new field "${candidateField.name}" must be born active; introducing it inactive is invalid`,
      });
    }
  }
}

function committedFieldIssues(
  committedField: SpecField,
  returned: SpecField | undefined,
): readonly CandidateValidationIssue[] {
  if (!returned) {
    return [
      {
        path: "schema.fields",
        message: `committed field "${committedField.name}" must be returned exactly once; omission is not a hide`,
      },
    ];
  }
  const issues: CandidateValidationIssue[] = [];
  if (returned.type !== committedField.type) {
    issues.push({
      path: `schema.fields.${committedField.name}.type`,
      message: `field "${committedField.name}" type is immutable; expected "${committedField.type}", got "${returned.type}"`,
    });
  }
  const transitionIssue = lifecycleTransitionIssue(committedField, returned);
  if (transitionIssue) issues.push(transitionIssue);
  return issues;
}

// The two transitions with frozen label/required. `active → active` and the
// reactivation `inactive → active` may change label/required freely; the Diff
// effects union (decision 2).
function lifecycleTransitionIssue(
  committedField: SpecField,
  returned: SpecField,
): CandidateValidationIssue | undefined {
  if (returned.lifecycle !== "inactive") return undefined;
  if (returned.label === committedField.label && returned.required === committedField.required) {
    return undefined;
  }
  return committedField.lifecycle === "inactive"
    ? {
        path: `schema.fields.${committedField.name}`,
        message: `inactive field "${committedField.name}" must be returned identically; only reactivation may change it`,
      }
    : {
        path: `schema.fields.${committedField.name}`,
        message: `hiding "${committedField.name}" may change only its lifecycle`,
      };
}

// Decision 1: declared dependencies must come from the frozen catalog. The
// registry gate already rejected self-dependency and non-canonical ordering;
// here every remaining pair must be exactly one catalog entry — an unknown
// capability or a stale incarnation is an undeclared pair, rejected.
function validateDependenciesAgainstCatalog(
  candidate: CapabilitySpec,
  catalog: readonly DependencyGenerationCatalogEntry[],
  issues: CandidateValidationIssue[],
): void {
  const admissible = new Set(
    catalog.map((entry) => `${entry.capability_id} ${entry.incarnation_id}`),
  );
  for (const [action, dependencies] of Object.entries(candidate.read_dependencies)) {
    for (const [index, dependency] of dependencies.entries()) {
      const key = `${dependency.capability_id} ${dependency.incarnation_id}`;
      if (!admissible.has(key)) {
        issues.push({
          path: `read_dependencies.${action}[${index}]`,
          message: `dependency ${dependency.capability_id}/${dependency.incarnation_id} is not in the frozen dependency-generation catalog`,
        });
      }
    }
  }
}

function zodIssues(error: ZodError): readonly CandidateValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join(".") : "(candidate)",
    message: issue.message,
  }));
}
