import type { CapabilityRow, CapabilitySpec } from "../../registry/index.ts";
import { canonicalCapabilityLabel, holdingRelations } from "../../registry/index.ts";
import type { RenderableCapability } from "./field-renderer.ts";

/**
 * The renderable projection of a capability, from either of the two things that carry one.
 *
 * Four call sites built this by hand, so a field added to {@link RenderableCapability} had to be
 * remembered four times. `item` is deliberately not included: it narrows which fields the item
 * renderer sees, and two of those call sites want the all-active-fields fallback instead. A caller
 * that wants it spreads it on, where the choice is visible.
 */
export function renderableFromSpec(spec: CapabilitySpec): RenderableCapability {
  return {
    id: spec.id,
    label: spec.label,
    noun: spec.noun,
    schema: spec.schema,
    form: spec.ui_intent.form,
    actions: spec.tools,
  };
}

/**
 * The same projection from a stored row, whose label is the one the user may have renamed. Its
 * linked fields are read against the active `catalog`, since a relation whose target end stopped
 * holding draws no dropdown.
 */
export function renderableFromRow(
  row: CapabilityRow,
  catalog: readonly CapabilityRow[],
): RenderableCapability {
  return {
    id: row.id,
    incarnationId: row.incarnation_id,
    label: canonicalCapabilityLabel(row),
    noun: row.noun,
    relations: row.relations,
    linkedFields: holdingRelations(row, catalog).map((relation) => relation.field),
    schema: row.schema,
    form: row.ui_intent.form,
    actions: row.tools,
  };
}
