// Which fields can link (ADR-0011), decided once for the route that writes a relation and the
// chooser that offers one, so the list never offers what the write refuses.

import {
  type CapabilityRow,
  isLinkableField,
  relationOf,
  type SpecField,
} from "../../registry/index.ts";

/** Why one pair cannot link. A test names each rule by this code, never by its sentence. */
export type LinkRefusalCode =
  | "source_not_linkable"
  | "source_already_linked"
  | "target_is_source"
  | "target_not_linkable"
  | "target_too_long"
  | "link_would_loop";

/** One end of a prospective relation: a capability as the registry holds it, and a field name. */
export interface LinkEnd {
  readonly row: CapabilityRow;
  readonly field: string;
}

/** The field a pair's end names, when it is one the relation could hold. */
export function linkableField(end: LinkEnd): SpecField | undefined {
  const field = end.row.schema.fields.find((candidate) => candidate.name === end.field);
  return field && isLinkableField(end.row.ui_intent.form, field) ? field : undefined;
}

/** Why the source end cannot take a new relation at all, whatever it would point at. */
export function sourceRefusal(source: LinkEnd): LinkRefusalCode | null {
  if (!linkableField(source)) return "source_not_linkable";
  if (relationOf(source.row.relations, source.field)) return "source_already_linked";
  return null;
}

/**
 * Why `source` cannot point at `target`, or null when every rule admits the pair. `catalog` is the
 * active registry the pair was read from, which the loop rule walks.
 */
export function linkRefusal(
  source: LinkEnd,
  target: LinkEnd,
  catalog: readonly CapabilityRow[],
): LinkRefusalCode | null {
  const refused = sourceRefusal(source);
  if (refused) return refused;
  if (target.row.id === source.row.id) return "target_is_source";
  const targetField = linkableField(target);
  if (!targetField) return "target_not_linkable";
  if (!fits(linkableField(source)?.max_length, targetField.max_length)) return "target_too_long";
  if (reaches(target, source, catalog)) return "link_would_loop";
  return null;
}

/** A source with no length limit takes anything; one with a limit takes a target held to it. */
function fits(sourceLimit: number | undefined, targetLimit: number | undefined): boolean {
  if (sourceLimit === undefined) return true;
  return targetLimit !== undefined && targetLimit <= sourceLimit;
}

/**
 * Whether following relations from `start` arrives at `goal`. Dormant relations count, so reviving
 * a field can never close a loop; one whose target incarnation is gone leads nowhere.
 */
function reaches(start: LinkEnd, goal: LinkEnd, catalog: readonly CapabilityRow[]): boolean {
  const visited = new Set<string>();
  let at: LinkEnd | undefined = start;
  while (at && !visited.has(endKey(at))) {
    if (endKey(at) === endKey(goal)) return true;
    visited.add(endKey(at));
    at = followed(at, catalog);
  }
  return false;
}

function endKey(end: LinkEnd): string {
  return `${end.row.id}\u0000${end.field}`;
}

/** Where one end's relation leads: nowhere when it holds none or its target's lifetime is over. */
function followed(end: LinkEnd, catalog: readonly CapabilityRow[]): LinkEnd | undefined {
  const relation = relationOf(end.row.relations, end.field);
  if (!relation) return undefined;
  const { capability, incarnation, field } = relation.to;
  const row = catalog.find((r) => r.id === capability && r.incarnation_id === incarnation);
  return row ? { row, field } : undefined;
}

/** A field `source` could point at, with the spec it was admitted on. */
export interface LinkTarget extends LinkEnd {
  readonly spec: SpecField;
}

/** Every field `source` could point at, in catalog then schema order. */
export function linkTargets(source: LinkEnd, catalog: readonly CapabilityRow[]): LinkTarget[] {
  return catalog.flatMap((row) =>
    row.schema.fields
      .map((spec) => ({ row, field: spec.name, spec }))
      .filter((target) => linkRefusal(source, target, catalog) === null),
  );
}
