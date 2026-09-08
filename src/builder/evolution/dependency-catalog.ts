// The dependency-generation catalog.
//
// While mutation ownership is held, candidate generation receives an immutable catalog of every
// other capability's generation identity — id, incarnation, label, prompt_context and
// `active_schema`. It is the only admissible source for a candidate's `read_dependencies`: a
// pair that does not resolve here is rejected before DDL or unit generation.
//
// Two exclusions are the contract, not an optimization: inactive external fields are not
// generation context, and the evolving capability itself is absent, self-dependency being
// implicit. Freshness is the caller's — build the catalog under the build lease, so no
// concurrent write can change dependency state mid-generation.

import { activeSpecFields, type CapabilityRow, type SpecField } from "../../registry/index.ts";

/** One dependency the model may declare — the exact ADR-0006 catalog entry shape. */
export interface DependencyGenerationCatalogEntry {
  readonly capability_id: string;
  readonly incarnation_id: string;
  readonly label: string;
  readonly prompt_context: string;
  readonly active_schema: { readonly fields: readonly SpecField[] };
}

/**
 * Project registry rows into the frozen dependency-generation catalog: every other capability's
 * active incarnation, active fields only. Call this while the build lease is held.
 */
export function buildDependencyGenerationCatalog(
  rows: readonly CapabilityRow[],
  forCapabilityId: string,
): readonly DependencyGenerationCatalogEntry[] {
  return rows
    .filter((row) => row.id !== forCapabilityId)
    .map((row) => ({
      capability_id: row.id,
      incarnation_id: row.incarnation_id,
      label: row.label,
      prompt_context: row.prompt_context,
      active_schema: { fields: activeSpecFields(row.schema.fields) },
    }));
}
