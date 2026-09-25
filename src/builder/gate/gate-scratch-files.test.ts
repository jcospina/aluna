// The Gate's scratch ledger is the platform's own (Module 7 PLAN decision 38): built by the same
// schema the migrations apply, and checked by the same rule the router applies to a save.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { requireFileLedgerRow } from "../../platform/files/ledger.test-support.ts";
import { FILE_LEDGER_TABLE } from "../../platform/files/ledger.ts";
import { runMigrations } from "../../platform/persistence/migrations.ts";
import { PHOTO_FIELD, photoSpec } from "../../registry/fields/file.test-support.ts";
import {
  deriveCapabilityTableDdl,
  FILE_CLEAR_VALUE,
  RecordChangedError,
} from "../../runtime/data/index.ts";
import { withScratch } from "./gate.test-support.ts";
import {
  mintScratchFile,
  scratchFileProjection,
  scratchStoredFile,
  scratchSubmission,
} from "./gate-scratch-files.ts";
import { scratchFileName } from "./gate-scratch-names.ts";

function ledgerSchema(database: Database): unknown[] {
  return database
    .query("SELECT type, name, sql FROM sqlite_master WHERE tbl_name = ? ORDER BY name")
    .all(FILE_LEDGER_TABLE);
}

describe("a scratch database's ledger", () => {
  test("is built exactly as the platform's migrations build it", () => {
    const migrated = new Database(":memory:");
    try {
      runMigrations(migrated);
      withScratch(photoSpec(), (database) =>
        expect(ledgerSchema(database)).toEqual(ledgerSchema(migrated)),
      );
    } finally {
      migrated.close();
    }
  });
});

describe("a scratch save", () => {
  const { tableName } = deriveCapabilityTableDdl(photoSpec());
  const holding = (database: Database, id: string) =>
    database
      .query(`INSERT INTO "${tableName}" ("id", "caption", "photo") VALUES (?, ?, ?)`)
      .run(id, "A day", scratchStoredFile(database, photoSpec(), PHOTO_FIELD, id, "held.jpg"));

  test("claims a pending file on create and hands the Handler its projection", () => {
    withScratch(photoSpec(), (database) => {
      const { key } = mintScratchFile(database, photoSpec(), PHOTO_FIELD, "fresh.jpg");
      const input = { values: { photo: key }, submittedFields: new Set(["photo"]) };
      const { input: saved, binding } = scratchSubmission(photoSpec(), input, database);
      expect(saved.values.photo).toMatchObject({
        url: expect.stringContaining(key),
        name: "fresh.jpg",
      });
      expect(binding.submitted.get("photo")?.write).toBe("claim");
    });
  });

  test("keeps, clears or refuses on an edit by what the record holds now", () => {
    withScratch(photoSpec(), (database) => {
      holding(database, "record");
      const held = JSON.parse(
        String(
          (database.query(`SELECT "photo" FROM "${tableName}"`).get() as { photo: string }).photo,
        ),
      ) as { key: string };
      const edit = (photo: string) =>
        scratchSubmission(
          photoSpec(),
          { values: { photo }, submittedFields: new Set(["photo"]) },
          database,
          "record",
        ).binding.submitted.get("photo")?.write;
      expect(edit(held.key)).toBe("keep");
      expect(edit(FILE_CLEAR_VALUE)).toBe("clear");
      expect(() => edit("")).toThrow(RecordChangedError);
      expect(requireFileLedgerRow(database, held.key).state).toBe("owned");
    });
  });
});

describe("a probe's file", () => {
  test("is the same file every time, so only the field under test moves a probe", () => {
    const name = scratchFileName("probe");
    expect(scratchFileProjection(photoSpec(), PHOTO_FIELD, name)).toEqual(
      scratchFileProjection(photoSpec(), PHOTO_FIELD, name),
    );
  });
});

describe("the scratch ledger's place in the module graph", () => {
  // The Gate once reached the router through this module, and a process that loaded the router
  // first met the Gate half-initialized: `Cannot access … before initialization`.
  test.each([
    "src/runtime/router/dispatch/router.ts",
    "src/server/http/index.ts",
  ])("lets %s load first in a fresh process", (entry) => {
    const cwd = mkdtempSync(join(tmpdir(), "aluna-import-order-"));
    try {
      const source = `await import(${JSON.stringify(resolve(import.meta.dir, "../../..", entry))});`;
      const run = Bun.spawnSync(["bun", "-e", source], { cwd, stderr: "pipe", stdout: "pipe" });
      expect(run.stderr.toString()).not.toContain("before initialization");
      expect(run.exitCode).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
