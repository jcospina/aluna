import type { CapabilityRow, CapabilitySpec } from "../../registry/index.ts";
import { canonicalCapabilityLabel } from "../../registry/index.ts";
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

/** The same projection from a stored row, whose label is the one the user may have renamed. */
export function renderableFromRow(row: CapabilityRow): RenderableCapability {
  return {
    id: row.id,
    incarnationId: row.incarnation_id,
    label: canonicalCapabilityLabel(row),
    noun: row.noun,
    schema: row.schema,
    form: row.ui_intent.form,
    actions: row.tools,
  };
}
