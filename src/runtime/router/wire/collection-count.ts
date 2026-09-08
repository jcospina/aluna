// The collection count, computed for one records response (CONTEXT.md, "Count sidecar"). The
// matched half of a filtered count is never re-derived — the `search` Handler owns its filter — so
// it is counted off the answer being sent, which is why the sidecar is built from the fragment.
//
// The count runs after the Handler's `SELECT`, on the same read-only connection but outside a
// transaction with it: that connection is a platform singleton, so a transaction around an `await`
// would enclose other requests' reads. A commit between the two reads makes the label disagree
// with the rows, and closing that window needs a per-request read connection. Until then the count
// refuses to state the incoherent pair — see `filteredCollectionCountSentence`.
//
// One `COUNT(*)` per collection open, per back-from-record and per post-create refresh, which is
// four statements across `CapabilityQueryPort.all`: around 43µs against a 500-row table, hot path.

import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  collectionCountSentence,
  countRenderedItems,
  filteredCollectionCountSentence,
  renderCollectionCountSidecar,
} from "../../../presentation/index.ts";
import type { CapabilitySpec } from "../../../registry/index.ts";
import { countCapabilityRecords } from "../../data/index.ts";
import type { WireProtocolAction } from "./wire-protocol.ts";

/** What one records answer needs to state its own count. */
export interface CollectionCountInput {
  readonly spec: CapabilitySpec;
  readonly databases: PlatformDatabase;
  /** The route's read lease — the count is cancelled with every other read of this capability. */
  readonly signal: AbortSignal;
  readonly noun: string;
  readonly action: WireProtocolAction;
  /** The scrubbed answer this sidecar will ride on, and the source of the matched half. */
  readonly fragment: string;
}

/**
 * The sidecar to prefix one Handler answer with, or `""` for a non-records action. A count that
 * cannot be taken says nothing rather than something untrue; a revoked lease logs no error.
 */
export function collectionCountSidecar(input: CollectionCountInput): string {
  const { spec, databases, signal, noun, action, fragment } = input;
  if (action !== "read" && action !== "search") return "";

  try {
    const total = countCapabilityRecords(spec, databases.readonly, signal);
    return renderCollectionCountSidecar(
      action === "search"
        ? filteredCollectionCountSentence(countRenderedItems(fragment), total, noun)
        : collectionCountSentence(total, noun),
    );
  } catch (error) {
    if (!signal.aborted) console.error(`Capability ${spec.id} could not be counted:`, error);
    return renderCollectionCountSidecar("");
  }
}
