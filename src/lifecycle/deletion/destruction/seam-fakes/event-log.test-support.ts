// The Module 8 acceptance fake for the Event Log half of the cleanup seam (PLAN decision 35,
// ADR-0006, ARCH §6.3 Event Log). Two properties have to hold before M8 can extend M4's deletion
// without guessing from free text, and both are provable now.
//
// Ownership provenance is server-derived: an event's incarnation set comes from the admitted
// route/query/read-token context, never from a label the client or the model supplied. The fake
// accepts client-claimed incarnations and payloads and then ignores them, so *not trusted* is an
// assertion rather than a comment. Ingestion is atomic and current-only, so a batch derived before
// a deletion and presented after it is rejected whole and cannot resurrect purged content.
//
// The store shape is the fixed one `../installed-payloads.ts` purges. M8 installs it by platform
// migration; the tests install it on demand, which makes the core purge exercisable before M8.

import type { Database } from "bun:sqlite";
import { getCapability } from "../../../../registry/index.ts";
import type {
  CapabilityIncarnation,
  ReadGateCoordinator,
  ReadTokenSet,
} from "../../../../runtime/concurrency/read-gates.ts";
import {
  EVENT_LOG_OWNERSHIP_TABLE,
  EVENT_LOG_TABLE,
  isInstalledEventLogPresent,
} from "../../installed-payloads.ts";

/** Install the fixed Event Log store M8 will own. Idempotent. */
export function installFakeEventLogStore(database: Database): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS ${EVENT_LOG_TABLE} (
       id          TEXT PRIMARY KEY,
       recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
       route       TEXT NOT NULL,
       action      TEXT NOT NULL,
       payload     TEXT NOT NULL,
       redacted    INTEGER NOT NULL DEFAULT 0
     ) STRICT;`,
  );
  database.exec(
    `CREATE TABLE IF NOT EXISTS ${EVENT_LOG_OWNERSHIP_TABLE} (
       event_id       TEXT NOT NULL,
       capability_id  TEXT NOT NULL,
       incarnation_id TEXT NOT NULL,
       PRIMARY KEY (event_id, capability_id, incarnation_id)
     ) STRICT;`,
  );
}

/**
 * `live`: the route's read-token set *is* the admitted incarnation set, target plus declared read
 * dependencies. `queued` was derived server-side earlier; revalidation at append makes it safe.
 */
export type AdmittedEventContext =
  | {
      readonly kind: "live";
      readonly route: string;
      readonly action: string;
      readonly tokens: ReadTokenSet;
    }
  | {
      readonly kind: "queued";
      readonly route: string;
      readonly action: string;
      readonly derivedAt: string;
      readonly ownership: readonly CapabilityIncarnation[];
    };

export interface ProposedEvent {
  readonly id: string;
  /** Canonical payload production input — server-side record state, not client text. */
  readonly records: readonly Record<string, unknown>[];
  /** Client- or model-supplied. Recorded here only so the tests can prove it is ignored. */
  readonly claimedIncarnations?: readonly CapabilityIncarnation[];
  /** Client- or model-supplied. Never becomes the stored payload. */
  readonly claimedPayload?: string;
}

export interface EventIngestionDeps {
  readonly database: Database;
  readonly registryReadonly: Database;
  readonly readGates: ReadGateCoordinator;
}

export type EventIngestionRejection =
  | "incarnation_not_current"
  | "no_derived_ownership"
  | "read_ownership_lost"
  | "store_not_installed";

export type EventIngestionResult =
  | {
      readonly status: "appended";
      readonly events: number;
      readonly ownership: readonly CapabilityIncarnation[];
    }
  | {
      readonly status: "rejected";
      readonly reason: EventIngestionRejection;
      readonly incarnation?: CapabilityIncarnation;
    };

function compareIncarnations(left: CapabilityIncarnation, right: CapabilityIncarnation): number {
  return (
    left.capabilityId.localeCompare(right.capabilityId) ||
    left.incarnationId.localeCompare(right.incarnationId)
  );
}

/**
 * The complete ownership set, derived server-side. Claimed labels never reach this function: the
 * only inputs are the admitted route context and the token set the platform itself issued.
 */
export function deriveEventOwnership(
  context: AdmittedEventContext,
): readonly CapabilityIncarnation[] {
  const derived = context.kind === "live" ? context.tokens.incarnations : context.ownership;
  return Object.freeze(
    [...derived]
      .map(({ capabilityId, incarnationId }) => ({ capabilityId, incarnationId }))
      .sort(compareIncarnations),
  );
}

/**
 * Canonical, server-side payload production. The stored payload is built from the
 * records the platform read, never from anything the caller wrote.
 */
export function canonicalEventPayload(context: AdmittedEventContext, event: ProposedEvent): string {
  return JSON.stringify({
    route: context.route,
    action: context.action,
    records: event.records,
  });
}

function isPairCurrent(pair: CapabilityIncarnation, deps: EventIngestionDeps): boolean {
  const gate = deps.readGates
    .snapshot()
    .find(
      (entry) =>
        entry.capabilityId === pair.capabilityId && entry.incarnationId === pair.incarnationId,
    );
  if (gate?.state !== "active") return false;
  const row = getCapability(pair.capabilityId, deps.registryReadonly);
  return row?.incarnation_id === pair.incarnationId;
}

/**
 * Append the whole validated batch or nothing; a closing, tombstoned or replaced pair rejects it.
 * Synchronous end to end: an `await` between check and append needs ARCH §6.3's write instead.
 */
export function ingestCapabilityEvents(
  context: AdmittedEventContext,
  events: readonly ProposedEvent[],
  deps: EventIngestionDeps,
): EventIngestionResult {
  if (!isInstalledEventLogPresent(deps.database)) {
    return { status: "rejected", reason: "store_not_installed" };
  }
  const ownership = deriveEventOwnership(context);
  if (ownership.length === 0) return { status: "rejected", reason: "no_derived_ownership" };
  if (context.kind === "live" && context.tokens.signal.aborted) {
    return { status: "rejected", reason: "read_ownership_lost" };
  }
  for (const pair of ownership) {
    if (!isPairCurrent(pair, deps)) {
      return { status: "rejected", reason: "incarnation_not_current", incarnation: pair };
    }
  }

  deps.database.transaction(() => {
    for (const event of events) {
      deps.database.run(
        `INSERT INTO ${EVENT_LOG_TABLE} (id, route, action, payload, redacted)
         VALUES (?, ?, ?, ?, 0)`,
        [event.id, context.route, context.action, canonicalEventPayload(context, event)],
      );
      for (const pair of ownership) {
        deps.database.run(
          `INSERT INTO ${EVENT_LOG_OWNERSHIP_TABLE} (event_id, capability_id, incarnation_id)
           VALUES (?, ?, ?)`,
          [event.id, pair.capabilityId, pair.incarnationId],
        );
      }
    }
  })();

  return { status: "appended", events: events.length, ownership };
}

export interface StoredEventRow {
  readonly id: string;
  readonly route: string;
  readonly action: string;
  readonly payload: string;
  readonly redacted: boolean;
  readonly ownership: readonly CapabilityIncarnation[];
}

/** Read the store back — the evidence half of the seam. */
export function listFakeEventLogRows(database: Database): readonly StoredEventRow[] {
  const rows = database
    .query(`SELECT id, route, action, payload, redacted FROM ${EVENT_LOG_TABLE} ORDER BY id`)
    .all() as { id: string; route: string; action: string; payload: string; redacted: number }[];
  return rows.map((row) => ({
    id: row.id,
    route: row.route,
    action: row.action,
    payload: row.payload,
    redacted: row.redacted === 1,
    ownership: (
      database
        .query(
          `SELECT capability_id, incarnation_id FROM ${EVENT_LOG_OWNERSHIP_TABLE}
            WHERE event_id = ? ORDER BY capability_id, incarnation_id`,
        )
        .all(row.id) as { capability_id: string; incarnation_id: string }[]
    ).map((owner) => ({
      capabilityId: owner.capability_id,
      incarnationId: owner.incarnation_id,
    })),
  }));
}
