// Candidate-spec validation: the AI authors one complete candidate spec for an evolving
// capability, and the platform validates it here — **before any DDL or unit generation** —
// against the current committed spec and the lease-frozen dependency-generation catalog. A
// candidate that fails never reaches the Diff stage: rejection is loud and total, never a
// partial acceptance or a silent all-Handler fallback. A candidate that passes emerges as
// the validated canonical value the Diff Engine compares against the committed spec.
//
// Three layers, in order:
//
//   1. The registry's own spec gate (`capabilitySpecSchema`) — structural shape, the
//      fixed five-Action inventory, Action ownership in errors/dependencies, list-input
//      coverage, reserved names, active-only presentation references. Its strict objects
//      also reject every platform-owned lifecycle key (`incarnation_id`, `version`, build
//      id, snapshot metadata, `artifacts_path`) and any patch/migration/regeneration shape
//      — the AI authors a complete spec, nothing else.
//   2. The cross-spec field-lifecycle contract: each committed field returns exactly once
//      with immutable name and type; `inactive → inactive` is identical; `active →
//      inactive` changes only lifecycle; reactivation may also change label/required; a new
//      field is born active. Omission is invalid — it is never a soft hide.
//   3. Frozen-catalog resolution: every declared dependency pair must be exactly one
//      catalog entry. The catalog was captured under the build lease, so this cannot race a
//      concurrent build.

import type { ZodError } from "zod";
import {
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecSchema,
  isChoiceFieldType,
  type SpecField,
} from "../../registry/index.ts";
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
    subject: row.subject,
    ground: row.ground,
    companion: row.companion,
    noun: row.noun,
    schema: row.schema,
    ui_intent: row.ui_intent,
    behavior: row.behavior,
    behavioral_errors: row.behavioral_errors,
    tools: row.tools,
    read_dependencies: row.read_dependencies,
    prompt_context: row.prompt_context,
  };
}

/**
 * The three authored facts the logo was drawn from. Evolution preserves them
 * byte-for-byte; none of them is ever a change fact.
 */
export const LOGO_BIRTH_FACTS = ["subject", "ground", "companion"] as const;

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
  const parsed = capabilitySpecSchema.safeParse(input.candidate);
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
  // The logo's birth facts. A logo is made once and never remade (ADR-0007 L7), so a
  // candidate that moved either one would leave the spec describing artwork nothing is
  // allowed to redraw. They are refused here by name rather than left to the Diff
  // Engine's residual check, so the rejection says which fact moved and why.
  for (const fact of LOGO_BIRTH_FACTS) {
    if (candidate[fact] !== committed[fact]) {
      issues.push({
        path: fact,
        message: `${fact} is a logo birth fact and is immutable; expected "${committed[fact]}", got "${candidate[fact]}"`,
      });
    }
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
  if (returned.type === committedField.type) {
    issues.push(...choiceOptionIssues(committedField, returned));
  }
  const transitionIssue = lifecycleTransitionIssue(committedField, returned);
  if (transitionIssue) issues.push(transitionIssue);
  return issues;
}

/**
 * A committed choice value is stored data. Rows already hold it, so it may never be
 * removed or renamed — every committed value must still be there, and anything else is an
 * append. Refusing here, before the Diff, is what guarantees a stored row can never become
 * undeclared data.
 *
 * Everything an option carries *besides* its value is presentation and moves freely: its
 * label, its note, the group it stands under, whether it is still offered, and the order
 * the options are drawn in. Order in particular: it was frozen while a choice had only one
 * arrangement, and it is a View fact now that groups give a field a second one.
 *
 * A group id is stored data of a different kind — not a record's, but the options' own
 * reference. It may not be renamed, and a group may not be removed while an option still
 * names it; a heading is wording and changes like a label does.
 */
function choiceOptionIssues(
  committedField: SpecField,
  returned: SpecField,
): readonly CandidateValidationIssue[] {
  if (!isChoiceFieldType(committedField.type)) return [];
  const returnedValues = new Set((returned.values ?? []).map((option) => option.value));

  for (const option of committedField.values ?? []) {
    if (returnedValues.has(option.value)) continue;
    return [
      {
        path: `schema.fields.${committedField.name}.values`,
        message:
          `choice value "${option.value}" is stored data and is immutable; ` +
          "committed option values may only be appended to, never removed or renamed",
      },
    ];
  }
  return choiceGroupIssues(committedField, returned);
}

/**
 * A group id is fixed once committed. Its two halves are enforced in the two places that
 * can see them: dropping a group an option still stands under is refused by the spec gate,
 * which requires every named group to be declared, and *renaming* one is refused here.
 *
 * A rename is not a shape a candidate can state — it is a drop and an add — so it is
 * recognized by what it does: a committed group disappears and every option that stood
 * under it arrives, together and alone, under one id the committed spec never declared.
 * Anything else is a real restructure and is admitted. Splitting a group into two new ones
 * moves its options to more than one id; emptying one moves them to a group that already
 * existed, or out of grouping; merging two into one leaves that id holding more options
 * than either group had.
 *
 * This binds one evolution, which is the one a model authors. It cannot bind two: a group
 * id is not stored data — only this field's own options refer to it, and they move in the
 * same candidate — so any spec-valid arrangement stays reachable in two steps. What the
 * rule buys is that a heading reworded in place stays the same group, rather than becoming
 * a new one the Diff cannot tell from a restructure.
 */
function choiceGroupIssues(
  committedField: SpecField,
  returned: SpecField,
): readonly CandidateValidationIssue[] {
  const declared = new Set((returned.groups ?? []).map((group) => group.id));
  const committedIds = new Set((committedField.groups ?? []).map((group) => group.id));

  for (const group of committedField.groups ?? []) {
    if (declared.has(group.id)) continue;
    if (!isRenamedGroup(committedField, returned, group.id, committedIds)) continue;
    return [
      {
        path: `schema.fields.${committedField.name}.groups`,
        message:
          `option group "${group.id}" cannot be renamed; a group id is fixed once ` +
          "committed, while its heading is wording and may change freely",
      },
    ];
  }
  return [];
}

function isRenamedGroup(
  committedField: SpecField,
  returned: SpecField,
  groupId: string,
  committedIds: ReadonlySet<string>,
): boolean {
  const returnedByValue = new Map((returned.values ?? []).map((option) => [option.value, option]));
  const members = (committedField.values ?? []).filter((option) => option.group === groupId);
  const landings = new Set(
    members.map((option) => returnedByValue.get(option.value)?.group ?? null),
  );
  if (landings.size !== 1) return false;

  const [landing] = [...landings];
  if (landing === null || landing === undefined || committedIds.has(landing)) return false;
  // Nothing else joined it, or this is a merge into a new group rather than a rename.
  return (
    (returned.values ?? []).filter((option) => option.group === landing).length === members.length
  );
}

// The two transitions with a frozen definition. `active → active` and the reactivation
// `inactive → active` may change label/required/max_length freely; the Diff effects union.
function lifecycleTransitionIssue(
  committedField: SpecField,
  returned: SpecField,
): CandidateValidationIssue | undefined {
  if (returned.lifecycle !== "inactive") return undefined;
  if (
    returned.label === committedField.label &&
    returned.required === committedField.required &&
    // A hidden field keeps its column and its values, so it keeps the bound they were
    // written under. Letting a hide tighten one would put values a reactivation then
    // reveals outside a limit nothing ever scanned for.
    returned.max_length === committedField.max_length &&
    sameChoiceOptions(committedField, returned)
  ) {
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

/**
 * Soft-hide preserves a choice's declaration exactly — every option's value, label, note,
 * group and disabled state, in the authored order, and the group headings above them.
 * Hiding a field changes its lifecycle and nothing else, so reactivating it later brings
 * back the control that was there rather than a quietly different one.
 */
function sameChoiceOptions(committedField: SpecField, returned: SpecField): boolean {
  return (
    frozenJson(committedField.values) === frozenJson(returned.values) &&
    frozenJson(committedField.groups) === frozenJson(returned.groups)
  );
}

/** One collection as an order-preserving string, for an exactly-as-it-was comparison. */
function frozenJson(collection: readonly object[] | undefined): string {
  return JSON.stringify(
    (collection ?? []).map((entry) =>
      Object.fromEntries(Object.entries(entry).sort(([left], [right]) => (left < right ? -1 : 1))),
    ),
  );
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
    catalog.map((entry) => `${entry.capability_id}\u0000${entry.incarnation_id}`),
  );
  for (const [action, dependencies] of Object.entries(candidate.read_dependencies)) {
    for (const [index, dependency] of dependencies.entries()) {
      const key = `${dependency.capability_id}\u0000${dependency.incarnation_id}`;
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
