// Prior-source admissibility — Module 4.6/04 (PLAN decision 21 ¶2; ADR-0006).
//
// Prior source is optional regeneration context, not an entitlement. Before an affected
// Handler or `item.ts` receives its old source in a regeneration prompt, deterministic
// checks must prove that source references nothing outside the candidate unit's **current**
// generation contract: no inactive or undeclared fields, no undeclared dependency data, no
// forbidden platform authority, and no imports or other context the fresh unit is not
// allowed to see. If the proof fails, the unit regenerates *without* old source.
//
// The proof is two halves, both run against the **candidate** spec and the candidate's
// frozen dependency catalog — never the committed ones the source was written for:
//
//   - **The unit's static contract.** The same checks a freshly generated unit must pass
//     (`checkHandlerSourceContract` / `checkItemRendererSourceContract`). This is what
//     catches an import, raw HTTP, raw mutation SQL, direct connection access, an item
//     renderer reading outside `ui_intent.item.shows`, or query SQL against a table this
//     Action no longer declares.
//   - **The hidden-name boundary.** No *inactive* field name and no *undeclared capability
//     table* may appear anywhere in the source — identifier, property name, object key,
//     string literal, SQL text, or comment. Those are the two names that carry data the
//     candidate unit is not allowed to see, and a dead string or a leftover comment
//     smuggles them into the prompt exactly as a live read would.
//
// What is deliberately *not* forbidden is an **active** field of the target that this
// Action's field list happens not to project. Decision 21 ¶2 says "inactive or undeclared",
// and an active field is neither: the spec's `behavior` text reaches every Action's prompt
// verbatim, and the read/search prompts authorize SQL over the target table — so a `read`
// Handler naming an active column in an ORDER BY is inside its contract, not outside it.
// Where that boundary is real it is already enforced structurally: `item.shows` by the
// item renderer's AST field-access check, and dependency scope by the query catalog check.
//
// Two deliberate properties:
//
//   - **It withholds on doubt, never admits on doubt.** The name scan is over raw source
//     text, so a capability that hides a field named after a common markup or SQL token
//     (`text`, `value`, `code`) can lose an admission it would have deserved — the platform's
//     own boilerplate contains those words. That direction is free: the unit regenerates
//     from the contract alone, which is what a v1 build does. The other direction leaks.
//   - **It is not a process sandbox** (decision 21). It governs what enters *model context*.
//     Execution safety is the Gate's, the router's, and the toolbox's job, unchanged.
//
// One channel this does not govern, noted so it is not mistaken for one it does: the Gate's
// design-lint rung quotes a *rejected unit's rendered markup* back into its own repair
// prompt. That is the Gate's failure feedback over bytes it was handed, not prior source
// entering a regeneration prompt — `generateUnitContent`, which both repair rungs use, has
// no prior-source parameter at all.

import { capabilityQueryScopeTableNames } from "../../capability-data/index.ts";
import {
  activeSpecFields,
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
} from "../../registry/index.ts";
import type { GeneratedUnitName } from "../evolution/diff-engine.ts";
import { checkHandlerSourceContract, checkItemRendererSourceContract } from "./unit-checks.ts";
import type { HandlerUnitName, UnitDescriptor } from "./units.ts";

/** The verdict on one unit's prior source: admitted, or withheld with the proof failure. */
export type PriorSourceAdmissibility =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: string };

/**
 * One unit's recorded admissibility decision — the audit line a developer reads in the
 * evolution work plan. Recorded for every unit the work plan regenerates; a copied unit
 * has none, because copy never enters model context at all (4.6/03).
 */
export interface PriorSourceDecision {
  readonly unit: GeneratedUnitName;
  readonly admitted: boolean;
  /** Why the source was withheld. Absent when it was admitted. */
  readonly reason?: string;
}

export interface PriorSourceAdmissibilityInput {
  /** The **candidate** spec — the contract the regenerated unit will be written against. */
  readonly spec: CapabilitySpec;
  readonly unit: UnitDescriptor;
  /** The committed unit's source, as read verbatim off the committed snapshot. */
  readonly source: string;
  /** The candidate's frozen dependency-generation catalog rows (Handlers only). */
  readonly dependencyCatalog?: readonly CapabilityRow[];
}

/**
 * Prove that one unit's prior source fits the candidate unit's current generation contract.
 * Deterministic: no model call, no execution, same verdict for the same inputs.
 */
export function checkPriorSourceAdmissibility(
  input: PriorSourceAdmissibilityInput,
): PriorSourceAdmissibility {
  const { spec, unit, source } = input;
  const catalog = input.dependencyCatalog ?? [];
  const contractMessage =
    unit.kind === "handler"
      ? checkHandlerSourceContract(
          spec,
          unit.name,
          source,
          catalog.map((row) => ({
            spec: capabilitySpecFromRow(row),
            incarnation_id: row.incarnation_id,
          })),
        )
      : checkItemRendererSourceContract(spec, source);
  if (contractMessage) {
    return withheld(`it no longer satisfies the unit contract — ${contractMessage}`);
  }

  const fields = namesPresent(source, inactiveFieldNames(spec, unit, catalog));
  if (fields.length > 0) {
    return withheld(
      `it names ${fields.length === 1 ? "a field" : "fields"} the candidate has made inactive: ${fields.join(", ")}`,
    );
  }

  const tables = undeclaredCapabilityTables(spec, unit, source, catalog);
  if (tables.length > 0) {
    return withheld(
      `it names capability ${tables.length === 1 ? "table" : "tables"} outside this unit's declared scope: ${tables.join(", ")}`,
    );
  }
  return { admitted: true };
}

/**
 * The admitted prior source, or `undefined`. The one call a prompt-building path should
 * make: it is impossible to hold the returned value and still be holding inadmissible bytes.
 */
export function admissiblePriorSource(input: PriorSourceAdmissibilityInput): string | undefined {
  return checkPriorSourceAdmissibility(input).admitted ? input.source : undefined;
}

function withheld(reason: string): PriorSourceAdmissibility {
  return { admitted: false, reason };
}

/**
 * Every field name whose data the candidate unit may not see: the capability's own inactive
 * fields, plus the inactive fields of each dependency this Action declares. A dependency's
 * *active* fields are in the catalog projection a regenerated Handler is given, so naming
 * one is inside the contract, not outside it.
 */
function inactiveFieldNames(
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  dependencyCatalog: readonly CapabilityRow[],
): ReadonlySet<string> {
  const inactive = new Set(hiddenFieldNamesOf(spec));
  if (unit.kind !== "handler") return inactive;

  for (const dependency of declaredDependencySpecs(spec, unit.name, dependencyCatalog)) {
    for (const name of hiddenFieldNamesOf(dependency)) inactive.add(name);
  }
  return inactive;
}

function hiddenFieldNamesOf(spec: CapabilitySpec): readonly string[] {
  const active = new Set(activeSpecFields(spec.schema.fields).map((field) => field.name));
  return spec.schema.fields.map((field) => field.name).filter((name) => !active.has(name));
}

/**
 * Capability tables this source names that are outside the unit's declared query scope.
 * The shared Handler check already rejects an undeclared table in *executable* SQL; this
 * sweeps the raw bytes, so a dropped dependency's table surviving in a comment or a dead
 * SQL constant is caught too. Field-level dependency scope needs no equivalent sweep: a
 * dependency's data is reachable only through its table, and a bare column name from a
 * capability this Action cannot query carries none of it.
 */
function undeclaredCapabilityTables(
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  source: string,
  dependencyCatalog: readonly CapabilityRow[],
): readonly string[] {
  const dependencies =
    unit.kind === "handler" ? declaredDependencySpecs(spec, unit.name, dependencyCatalog) : [];
  const allowed = new Set(
    capabilityQueryScopeTableNames({ target: spec, dependencies }).map((table) =>
      table.toLowerCase(),
    ),
  );
  const named = new Set(
    [...source.matchAll(/\bcap_[a-z0-9_]+\b/gi)].map((match) => match[0].toLowerCase()),
  );
  return [...named].filter((table) => !allowed.has(table)).sort();
}

function declaredDependencySpecs(
  spec: CapabilitySpec,
  action: HandlerUnitName,
  dependencyCatalog: readonly CapabilityRow[],
): readonly CapabilitySpec[] {
  const declared =
    action in spec.read_dependencies
      ? spec.read_dependencies[action as keyof typeof spec.read_dependencies]
      : [];
  return declared.flatMap((dependency) => {
    const row = dependencyCatalog.find(
      (candidate) =>
        candidate.id === dependency.capability_id &&
        candidate.incarnation_id === dependency.incarnation_id,
    );
    return row ? [capabilitySpecFromRow(row)] : [];
  });
}

/**
 * Which of the given names this source mentions, anywhere in its bytes. Whole-token
 * matching (`_` and `$` count as token characters) so `text` does not match inside
 * `text_element`, while `"text"`, `.text`, `text:` and a bare `text` in SQL all do.
 */
function namesPresent(source: string, names: ReadonlySet<string>): readonly string[] {
  const found = [...names].filter((name) =>
    new RegExp(`(?<![\\p{L}\\p{N}_$])${escapeRegExp(name)}(?![\\p{L}\\p{N}_$])`, "u").test(source),
  );
  return found.sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
