// The read tokens of the capabilities an edit's linked-text refresh or a deletion's clearing writes,
// each taken on its own, apart from the request's set (ADR-0011).

import {
  type CapabilityRow,
  type ReachingRelation,
  relationsReaching,
} from "../../../registry/index.ts";
import {
  type CapabilityIncarnation,
  capabilityIncarnation,
  type ReadGateCoordinator,
  type ReadTokenSet,
} from "../../concurrency/read-gates.ts";
import { NO_REACH, type RefreshReach } from "../../data/index.ts";
import type { WireProtocolAction } from "../wire/wire-protocol.ts";

/** A save's reach, settled on the desk its transaction finds, and the tokens it took. */
export interface LinkingAdmission {
  readonly settle: (desk: () => readonly CapabilityRow[]) => RefreshReach;
  readonly release: () => void;
}

const NONE: LinkingAdmission = Object.freeze({ settle: () => NO_REACH, release: () => {} });

/**
 * Take the read token of each capability an edit or a deletion of a record of `row` may write, one
 * at a time: an edit's, down every chain; a deletion's, each holding an optional field linked to
 * it. One whose token cannot be taken is skipped, and so is one whose token closes before the write
 * reaches it. `settle`, run inside the save's transaction on the desk the save read there, takes
 * the token of each capability a relation woken, linked or reshaped since admission reaches.
 */
export function admitLinkingCapabilities(
  readGates: ReadGateCoordinator,
  row: CapabilityRow,
  catalog: readonly CapabilityRow[],
  action: WireProtocolAction,
): LinkingAdmission {
  if (action !== "update" && action !== "delete") return NONE;
  const writes = (reached: ReachingRelation) =>
    reached.holds && (action === "update" || clearedBy(row, reached));
  const tokens = new Map<string, ReadTokenSet>();
  const release = () => {
    for (const taken of tokens.values()) readGates.release(taken);
  };
  const own = sourceKey({ capability: row.id, incarnation: row.incarnation_id });
  const takeOne = (desk: readonly CapabilityIncarnation[], source: ReachingRelation["source"]) => {
    const key = sourceKey(source);
    if (key === own || tokens.has(key)) return;
    const taken = readGates.tryAcquire({
      catalog: desk,
      incarnations: [{ capabilityId: source.capability, incarnationId: source.incarnation }],
    });
    if (taken) tokens.set(key, taken);
  };
  const take = (desk: readonly CapabilityRow[]) => {
    const relations = relationsReaching(row, desk);
    const incarnations = desk.map(capabilityIncarnation);
    try {
      for (const reached of relations) if (writes(reached)) takeOne(incarnations, reached.source);
    } catch (error) {
      release();
      throw error;
    }
    return relations;
  };
  take(catalog);
  const writable = (source: ReachingRelation["source"]) => {
    const key = sourceKey(source);
    return key === own || tokens.get(key)?.signal.aborted === false;
  };
  return {
    settle: (desk) => ({ relations: take(desk()), writable }),
    release,
  };
}

/** Whether deleting a record of `row` clears the relation's field: optional, and linked to it. */
function clearedBy(row: CapabilityRow, { relation, required }: ReachingRelation): boolean {
  const { to } = relation;
  return !required && to.capability === row.id && to.incarnation === row.incarnation_id;
}

function sourceKey(source: ReachingRelation["source"]): string {
  return `${source.capability}\u0000${source.incarnation}`;
}
