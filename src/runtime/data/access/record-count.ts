// How many records a capability holds.
//
// A `count` is a read, and reading is free (ARCH §3), so this is taken through the
// physically read-only connection and creates no registry, version, artifact, cache or
// read-dependency state. It counts the capability's canonical table whole, which is the
// same row set the platform's canonical read renders (`selectCapabilityRows`): the table
// carries no soft-delete column for the two to disagree over.
//
// It goes through `CapabilityQueryPort.all`, where a platform-owned read of capability
// data belongs, so the statement is scoped to the capability's own table by the same check
// every Handler read crosses. The spec is still parsed before its table is named, and the
// read lease is still honoured, so a count running while a deletion drains the capability
// is cancelled the way every other read of it is.

import type { Database } from "bun:sqlite";

import { type CapabilitySpec, capabilitySpecSchema } from "../../../registry/index.ts";
import { CapabilityDataValidationError, sqlIdentifier } from "../internal.ts";
import { deriveCapabilityTableDdl } from "../schema/ddl.ts";
import { createCapabilityQueryPort } from "../tool.ts";

/** The number of records stored for `spec`, read through `database`. */
export function countCapabilityRecords(
  spec: CapabilitySpec,
  database: Database,
  signal?: AbortSignal,
): number {
  const target = capabilitySpecSchema.parse(spec);
  const { tableName } = deriveCapabilityTableDdl(target);
  const [row] = createCapabilityQueryPort(database, { target, signal }).all({
    sql: `SELECT COUNT(*) AS "count" FROM ${sqlIdentifier(tableName)}`,
    result: [{ alias: "count", type: "number" }],
  });
  // A count that cannot be read is not zero records. The caller renders no label at all
  // rather than state a number the collection would visibly disagree with.
  if (typeof row?.count !== "number") {
    throw new CapabilityDataValidationError(`Capability "${target.id}" returned no count.`);
  }
  return row.count;
}
