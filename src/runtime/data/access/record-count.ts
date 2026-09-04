// How many records a capability holds.
//
// A `count` is a read, and reading is free (ARCH §3), so this is taken through the
// physically read-only connection and creates no registry, version, artifact, cache or
// read-dependency state. It counts the capability's canonical table whole, which is the
// same row set the platform's canonical read renders (`selectCapabilityRows`): the table
// carries no soft-delete column for the two to disagree over.
//
// **It does not go through `CapabilityQueryPort.all`,** which is where a platform-owned
// read of capability data would otherwise belong. That method leaves the shared read-only
// connection pinned to the snapshot it read: after one `all`, every later read on that
// connection — including the registry lookup that resolves a capability's artifacts —
// answers from before any subsequent commit, on a fresh statement and with no transaction
// open. `records` does not do this and neither does a direct query, so the count reads
// directly and takes with it the two things the port was worth having for: the spec is
// validated before its table is named, and the read lease is honoured, so a count running
// while a deletion drains the capability is cancelled the way every other read of it is.

import type { Database } from "bun:sqlite";

import { type CapabilitySpec, capabilitySpecSchema } from "../../../registry/index.ts";
import { sqlIdentifier } from "../internal.ts";
import { deriveCapabilityTableDdl } from "../schema/ddl.ts";
import { assertReadOwnership } from "./read-ownership.ts";

interface CountRow {
  readonly count: number | bigint;
}

/** The number of records stored for `spec`, read through `database`. */
export function countCapabilityRecords(
  spec: CapabilitySpec,
  database: Database,
  signal?: AbortSignal,
): number {
  assertReadOwnership(signal);
  const { tableName } = deriveCapabilityTableDdl(capabilitySpecSchema.parse(spec));
  const row = database
    .query(`SELECT COUNT(*) AS "count" FROM ${sqlIdentifier(tableName)}`)
    .get() as CountRow | null;
  return row === null ? 0 : Number(row.count);
}
