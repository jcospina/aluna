// A capability's relations (ADR-0011): which of its single-line text fields show another
// capability's field. They live on the registry row beside the logo seed, never in the spec a
// model writes, and changing one makes no version.
//
// Parsing checks the shape alone. Whether a relation still holds is decided where it is used, so a
// hidden field or a deleted target never stops a row loading.

import { z } from "zod";

import { isLongTextField } from "./fields/form-intent.ts";
import { incarnationIdSchema } from "./identifiers.ts";
import type { SpecField, UiFormIntent } from "./spec/spec.ts";
import { allUnique, sqlNameText } from "./spec/spec-text.ts";

export const relationSchema = z.strictObject({
  field: sqlNameText,
  to: z.strictObject({
    capability: sqlNameText,
    incarnation: incarnationIdSchema,
    field: sqlNameText,
  }),
});
export type Relation = z.infer<typeof relationSchema>;

export const relationsSchema = z
  .array(relationSchema)
  .refine(
    (relations) => allUnique(relations.map((relation) => relation.field)),
    "a field holds at most one relation",
  );

/** A `string` field the form does not draw as long text. */
export function isSingleLineTextField(
  form: Pick<UiFormIntent, "long_text">,
  field: Pick<SpecField, "name" | "type">,
): boolean {
  return field.type === "string" && !isLongTextField(form, field.name);
}

/** Either end of a relation: an active single-line text field. */
export function isLinkableField(
  form: Pick<UiFormIntent, "long_text">,
  field: Pick<SpecField, "name" | "type" | "lifecycle">,
): boolean {
  return field.lifecycle === "active" && isSingleLineTextField(form, field);
}

/** A source with no length limit takes any target; one with a limit takes a target held to it. */
export function fitsLength(sourceLimit: number | undefined, targetLimit: number | undefined) {
  if (sourceLimit === undefined) return true;
  return targetLimit !== undefined && targetLimit <= sourceLimit;
}

/** What `holdingRelations` reads of a capability: its fields, its form and its relations. */
export interface RelatedCapability {
  readonly id: string;
  readonly incarnation_id: string;
  readonly schema: { readonly fields: readonly SpecField[] };
  readonly ui_intent: { readonly form: Pick<UiFormIntent, "long_text"> };
  readonly relations: readonly Relation[];
}

/**
 * The relations of `row` that hold against the active `catalog`: both ends active single-line
 * text fields, the target in the lifetime the relation pinned, and no longer than the source
 * allows (ADR-0011, rule 4). Any other is dormant, which the form and the pick route treat as
 * absent.
 */
export function holdingRelations(
  row: RelatedCapability,
  catalog: readonly RelatedCapability[],
): Relation[] {
  const linkable = (capability: RelatedCapability, name: string) =>
    capability.schema.fields.find(
      (field) => field.name === name && isLinkableField(capability.ui_intent.form, field),
    );
  return row.relations.filter((relation) => {
    const source = linkable(row, relation.field);
    const { capability, incarnation } = relation.to;
    const target = catalog.find(
      (candidate) => candidate.id === capability && candidate.incarnation_id === incarnation,
    );
    const targetField = target ? linkable(target, relation.to.field) : undefined;
    if (!source || !targetField) return false;
    return fitsLength(source.max_length, targetField.max_length);
  });
}

/** A relation that holds, pointing at a capability, and the capability whose field it is. */
export interface PointingRelation<Source extends RelatedCapability> {
  readonly source: Source;
  readonly relation: Relation;
}

/**
 * The relations that hold pointing at `target`'s lifetime, one per linking field, in the desk's
 * order and each source's own. A record of `target` lists the records linking to it by these, so
 * a capability linking through two fields counts twice.
 */
export function relationsPointingAt<Source extends RelatedCapability>(
  target: Pick<RelatedCapability, "id" | "incarnation_id">,
  catalog: readonly Source[],
): PointingRelation<Source>[] {
  const holding = new Map(catalog.map((each) => [each.id, holdingRelations(each, catalog)]));
  return relationsInto(target, catalog, holding, false).map(({ found, source }) => ({
    source,
    relation: found.relation,
  }));
}

/** A relation on the desk, the capability whose field it is, and whether it holds. */
export interface ReachingRelation {
  readonly source: { readonly capability: string; readonly incarnation: string };
  readonly relation: Relation;
  readonly holds: boolean;
  /** Whether the linking field must hold a value, which keeps it from a deleted target's clearing. */
  readonly required: boolean;
}

/**
 * The relations the linked-text refresh and a record's deletion reach from `row` (ADR-0011): each
 * that holds, down every chain, and each dormant one pointing at a capability the walk reaches,
 * whose link rows a cleared text or a deleted record lets go.
 */
export function relationsReaching(
  row: Pick<RelatedCapability, "id" | "incarnation_id">,
  catalog: readonly RelatedCapability[],
): ReachingRelation[] {
  const holding = new Map(catalog.map((each) => [each.id, holdingRelations(each, catalog)]));
  const reaching: ReachingRelation[] = [];
  const reached = new Set([row.id]);
  const frontier = [row];
  for (let target = frontier.shift(); target !== undefined; target = frontier.shift()) {
    for (const { found, source } of relationsInto(target, catalog, holding, true)) {
      reaching.push(found);
      if (!found.holds || reached.has(source.id)) continue;
      reached.add(source.id);
      frontier.push(source);
    }
  }
  return reaching;
}

/** The relations pointing at `target`'s lifetime, with their sources: those that hold, or all. */
function relationsInto<Source extends RelatedCapability>(
  target: Pick<RelatedCapability, "id" | "incarnation_id">,
  catalog: readonly Source[],
  holding: ReadonlyMap<string, readonly Relation[]>,
  dormantToo: boolean,
): { readonly found: ReachingRelation; readonly source: Source }[] {
  return catalog.flatMap((source) =>
    source.relations
      .filter(({ to }) => to.capability === target.id && to.incarnation === target.incarnation_id)
      .map((relation) => {
        const holds = holding.get(source.id)?.some((each) => sameRelation(each, relation)) ?? false;
        const field = source.schema.fields.find(({ name }) => name === relation.field);
        const found = {
          source: { capability: source.id, incarnation: source.incarnation_id },
          relation,
          holds,
          required: field?.required ?? true,
        };
        return { found, source };
      })
      .filter(({ found }) => dormantToo || found.holds),
  );
}

/** Whether two relations are the same: one field pointing at one target field in one lifetime. */
export function sameRelation(a: Relation, b: Relation): boolean {
  return (
    a.field === b.field &&
    a.to.capability === b.to.capability &&
    a.to.incarnation === b.to.incarnation &&
    a.to.field === b.to.field
  );
}

/** The relation one field holds, if it holds one. */
export function relationOf(
  relations: readonly Relation[],
  fieldName: string,
): Relation | undefined {
  return relations.find((relation) => relation.field === fieldName);
}
