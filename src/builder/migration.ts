// Migration apply stage — Module 2, Epic 2.5 (ARCH §6.2 "Capability Builder"
// step 2, §9.3, PLAN flow step 4).
//
// The stage does not author SQL. It receives the validated capability spec and
// delegates DDL derivation/application to the deterministic mapper from Epic 2.2.
// The transaction wrapper keeps the migration rollbackable until downstream
// builder work finishes, so a later gate or commit failure leaves no cap_* table.

import type { Database } from "bun:sqlite";

import { applyCapabilityTableDdl, type CapabilityTableDdl } from "../capability-data/index.ts";
import { withWriteTransaction } from "../db.ts";
import type { CapabilitySpec } from "../registry/index.ts";

export interface ApplyCapabilityMigrationInput {
  readonly database: Database;
  readonly spec: CapabilitySpec;
}

// What the metrics writer will eventually persist for this stage. The writer is
// Epic 2.7; this stage produces the measurement and the table identity.
export interface CapabilityMigrationResult {
  readonly ddl: CapabilityTableDdl;
  readonly tableName: string;
  readonly durationMs: number;
}

export interface CapabilityMigrationTransactionResult<T> {
  readonly migration: CapabilityMigrationResult;
  readonly value: T;
}

export function applyCapabilityMigration(
  input: ApplyCapabilityMigrationInput,
): CapabilityMigrationResult {
  const startedAt = performance.now();
  const ddl = applyCapabilityTableDdl(input.spec, input.database);
  const durationMs = performance.now() - startedAt;

  return {
    ddl,
    tableName: ddl.tableName,
    durationMs,
  };
}

export async function withCapabilityMigrationTransaction<T>(
  input: ApplyCapabilityMigrationInput,
  afterApply: (migration: CapabilityMigrationResult) => T | Promise<T>,
): Promise<CapabilityMigrationTransactionResult<T>> {
  return withWriteTransaction(input.database, async () => {
    const migration = applyCapabilityMigration(input);
    const value = await afterApply(migration);
    return { migration, value };
  });
}
