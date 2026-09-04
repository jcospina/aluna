// The collection count, computed for one records response (CONTEXT.md, "Count sidecar").
//
// The matched half of a filtered count is never re-derived — the capability's `search`
// Handler owns its filter, and the platform cannot re-run it without re-running generated
// SQL it does not own — so it is counted off the very answer being sent. That is why the
// sidecar is built *from* the fragment rather than beside it.
//
// **One round trip, a second read.** The count runs after the Handler's own `SELECT`
// returns, on the same read-only connection but not inside a transaction with it — the
// connection is a platform singleton every concurrent read shares, so a transaction
// around an `await` here would enclose other requests' reads. A commit landing between
// the two reads makes the label disagree with the rendered rows for exactly as long
// as the next read takes, which is the same window in which the rendered rows are
// themselves one commit behind. Closing it needs a per-request read connection, which is
// a change to the platform's data access, not to the count. What the count refuses to do
// is state the incoherent pair that window can produce — see
// `filteredCollectionCountSentence`.
//
// It costs one `COUNT(*)` per collection open, per back-from-record and per post-create
// refresh — a covering-index scan of the capability's table. Crossing
// `CapabilityQueryPort.all` makes that four statements rather than one: the port's scope
// check reads `sqlite_master`, `EXPLAIN`s the count and reads the target's column layout
// before the count itself runs. Around 43µs against a 500-row table, which is nothing at
// desk scale and is named here because it is on the hot read path.

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
 * The sidecar to prefix one Handler answer with, or `""` for an action that is not a
 * records response.
 *
 * A count that cannot be taken is not a broken read: the records still answer, and the
 * label says nothing rather than something untrue. A read whose lease was revoked
 * mid-request is that case and not a fault — the capability is being taken away — so it
 * leaves no error in the log.
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
