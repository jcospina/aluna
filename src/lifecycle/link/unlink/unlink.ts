// Unlink (ADR-0011): the broken chain inside a linked field takes its
// relation off the registry row and forgets every pick the field made, in one platform write under
// the platform-write lease, as Link writes one. Every record keeps the text it holds, the field is
// plain text again, and no version is made. There is no "change target": Unlink, then Link.

import type { Database } from "bun:sqlite";
import { deleteFieldLinkRows } from "../../../platform/links/link-table.ts";
import {
  type CapabilityRow,
  getCapability,
  holdingRelations,
  listCapabilities,
  relationOf,
  removeCapabilityRelation,
  sameRelation,
} from "../../../registry/index.ts";
import { type CapabilityLinkDeps, isAsRead, type LinkPress } from "../front-half.ts";
import type { LinkEnd } from "../rules.ts";

export type CapabilityUnlinkDeps = Omit<CapabilityLinkDeps, "onAdmitted">;

export type CapabilityUnlinkOutcome =
  /** The relation and its link rows are gone. `source` is the row without it. */
  | { readonly status: "unlinked"; readonly source: CapabilityRow }
  /** The field holds no relation that still holds: none to take, or a dormant one left alone. */
  | { readonly status: "not_linked"; readonly source: LinkEnd }
  /** An end or the relation is not what the press read: `moved` is that end now, or null. */
  | { readonly status: "stale"; readonly moved: CapabilityRow | null };

/**
 * A short platform write, queued FIFO behind a build as Link's is: a press landing as one starts
 * waits, then applies, or is stale when the build moved either end the press read. The press is
 * Link's, both ends and the target field, so a relation a build left dormant is never taken.
 */
export async function unlinkCapabilityField(
  press: LinkPress,
  deps: CapabilityUnlinkDeps,
): Promise<CapabilityUnlinkOutcome> {
  const looked = deps.readonlyDatabase && readSource(press, deps.readonlyDatabase);
  if (looked && "status" in looked) return looked;
  return deps.mutationCoordinator.withPlatformWrite(
    () => unlinkUnderLease(press, deps),
    deps.signal ? { signal: deps.signal } : {},
  );
}

function unlinkUnderLease(press: LinkPress, deps: CapabilityUnlinkDeps): CapabilityUnlinkOutcome {
  if (deps.signal?.aborted) return { status: "stale", moved: null };
  const read = readSource(press, deps.database);
  if ("status" in read) return read;
  const expectation = {
    capabilityId: read.id,
    incarnationId: read.incarnation_id,
    version: read.version,
    relations: read.relations,
  };
  const { capabilityId, field } = press.source;
  const written = deps.database.transaction(() => {
    const row = removeCapabilityRelation(expectation, field, deps.database);
    if (row) deleteFieldLinkRows(deps.database, row.id, field);
    return row;
  })();
  if (!written) return { status: "stale", moved: getCapability(capabilityId, deps.database) };
  return { status: "unlinked", source: written };
}

/** The source row when it, the target and the field's relation are all as the press read them. */
function readSource(
  press: LinkPress,
  database: Database,
): CapabilityRow | Exclude<CapabilityUnlinkOutcome, { status: "unlinked" }> {
  const catalog = listCapabilities(database);
  const source = catalog.find((row) => row.id === press.source.capabilityId);
  if (!isAsRead(source, press.source)) return { status: "stale", moved: source ?? null };
  const relation = relationOf(holdingRelations(source, catalog), press.source.field);
  if (!relation)
    return { status: "not_linked", source: { row: source, field: press.source.field } };
  const target = catalog.find((row) => row.id === press.target.capabilityId);
  if (!isAsRead(target, press.target)) return { status: "stale", moved: target ?? null };
  const pressed = {
    field: press.source.field,
    to: { capability: target.id, incarnation: target.incarnation_id, field: press.target.field },
  };
  return sameRelation(relation, pressed) ? source : { status: "stale", moved: source };
}
