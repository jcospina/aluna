// The read tokens of the capabilities an edit's linked-text refresh writes, each taken on its own,
// apart from the request's set (ADR-0011).

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

/** An edit's reach, settled on the desk the save's transaction finds, and the tokens it took. */
export interface LinkingAdmission {
  readonly settle: (desk: () => readonly CapabilityRow[]) => RefreshReach;
  readonly release: () => void;
}

const NONE: LinkingAdmission = Object.freeze({ settle: () => NO_REACH, release: () => {} });

/**
 * Take the read token of each capability an edit of `row` reaches, one at a time. One whose token
 * cannot be taken is skipped by the refresh, and so is one whose token closes before the refresh
 * reaches it. `settle`, run inside the save's transaction on the desk the save read there, takes
 * the token of each capability a relation woken or linked since admission reaches.
 */
export function admitLinkingCapabilities(
  readGates: ReadGateCoordinator,
  row: CapabilityRow,
  catalog: readonly CapabilityRow[],
  action: WireProtocolAction,
): LinkingAdmission {
  if (action !== "update") return NONE;
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
      for (const { source, holds } of relations) if (holds) takeOne(incarnations, source);
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

function sourceKey(source: ReachingRelation["source"]): string {
  return `${source.capability}\u0000${source.incarnation}`;
}
