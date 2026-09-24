// Candidate-spec validation: the AI authors one complete candidate spec, and the platform
// validates it here — before any DDL or unit generation — against the committed spec and the
// lease-frozen dependency catalog. A failing candidate never reaches the Diff stage; rejection is
// loud and total, never a partial acceptance or a silent all-Handler fallback.
//
// Three layers, in order. The registry's own spec gate covers structural shape; its strict
// objects also reject every platform-owned lifecycle key and any patch or migration shape,
// because the AI authors a complete spec and nothing else. The cross-spec field-lifecycle
// contract (decision 2) follows. Finally, every declared dependency pair must resolve to one
// entry of the catalog captured under the build lease, so this cannot race a concurrent build.

import type { ZodError } from "zod";
import {
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecSchema,
  isChoiceFieldType,
  type SpecField,
  sameOrderedStrings,
} from "../../../registry/index.ts";
import type { DependencyGenerationCatalogEntry } from "../dependency-catalog.ts";

/**
 * The committed row's authored-spec view. It strips lifecycle metadata rather than re-parsing
 * through `capabilitySpecFromRow`: that strict label would leave an older row unable to evolve.
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
 * The total rejection: every violation found, never just the first. `diagnostic` mirrors the
 * issues so `buildDemoErrorPreview` surfaces them in the developer panel unchanged.
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
  /**
   * What the calling stage refuses besides the contract, read from the raw candidate so it is
   * reported with the contract's issues in one rejection, a shape error's included.
   */
  readonly stageIssues?: (candidate: unknown) => readonly CandidateValidationIssue[];
}

/**
 * Validate one authored candidate completely, returning the canonical value for the Diff
 * stage or throwing {@link CandidateValidationError} with every violation.
 */
export function validateCandidateSpec(input: ValidateCandidateSpecInput): CapabilitySpec {
  const parsed = capabilitySpecSchema.safeParse(input.candidate);
  const stageIssues = input.stageIssues?.(input.candidate) ?? [];
  if (!parsed.success) {
    throw new CandidateValidationError([...zodIssues(parsed.error), ...stageIssues]);
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
  // A logo is made once and never remade (ADR-0007 L7), so a moved birth fact would describe
  // artwork nothing may redraw. Named here, not left to the residual check, so it says which.
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
  issues.push(...stageIssues);

  if (issues.length > 0) throw new CandidateValidationError(issues);
  return candidate;
}

// Decision 2, field by field. Candidate names are already unique (schema gate), so per-name
// presence is the whole exactly-once story; a rename surfaces as an omission plus a new field.
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
 * A committed choice value is stored data, so it may only be appended to — never removed or
 * renamed, or a stored row would become undeclared data. Everything else moves freely.
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
 * A group id is fixed once committed, while its heading is wording. A rename has no shape of its
 * own, so it is caught by what it does — the spec gate refuses a group an option still names.
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

// A rename, not a restructure: splitting lands options on more than one id, emptying on an
// existing one. The rule binds one evolution — any arrangement stays reachable in two steps.
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
    // A hidden field keeps its column and values, so it keeps their bound: a hide that
    // tightened one would reveal values outside a limit nothing ever scanned for.
    returned.max_length === committedField.max_length &&
    sameOrderedStrings(committedField.accepts ?? [], returned.accepts ?? []) &&
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
 * Soft-hide preserves a choice's declaration exactly, so reactivating the field later brings
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

// Decision 1: declared dependencies must come from the frozen catalog. Every remaining pair
// must be exactly one entry — an unknown capability or a stale incarnation is rejected.
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
