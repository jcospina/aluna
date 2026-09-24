// A file field's column: TEXT holding one JSON reference object, the way a `string[]` column
// holds its array, and nullable, so a record with no photo stores nothing at all.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { CAPTION_FIELD, photoSpec } from "../../../registry/fields/file.test-support.ts";
import {
  applyAdditiveCapabilityMigration,
  applyCapabilityTableDdl,
  createCapabilityQueryPort,
  deriveAdditiveCapabilityMigration,
} from "../index.ts";
import { tableColumns } from "./table-shape.test-support.ts";

const REFERENCE = JSON.stringify({
  key: "k",
  kind: "image",
  mime: "image/jpeg",
  size: 1,
  name: "IMG_4821.JPG",
});

function insertPhoto(database: Database, photo: string | null): void {
  database
    .query(`INSERT INTO "cap_photos" ("id", "caption", "photo") VALUES (?, 'A day out', ?)`)
    .run(crypto.randomUUID(), photo);
}

describe("a file field's column", () => {
  test("is nullable TEXT", () => {
    const database = new Database(":memory:");
    try {
      const ddl = applyCapabilityTableDdl(photoSpec(), database);
      const photo = tableColumns(database, ddl.tableName).find((column) => column.name === "photo");
      expect(photo).toMatchObject({ type: "TEXT", notnull: 0 });
    } finally {
      database.close();
    }
  });

  test("holds nothing or one JSON object, and refuses any other shape", () => {
    const database = new Database(":memory:");
    try {
      applyCapabilityTableDdl(photoSpec(), database);
      insertPhoto(database, null);
      insertPhoto(database, REFERENCE);
      for (const wrong of ["[]", '"IMG_4821.JPG"', "not json", "42"]) {
        expect(() => insertPhoto(database, wrong)).toThrow(/CHECK constraint failed/);
      }
    } finally {
      database.close();
    }
  });

  test("arrives by an additive migration that leaves every existing record empty", () => {
    const database = new Database(":memory:");
    try {
      const committed = photoSpec([CAPTION_FIELD]);
      applyCapabilityTableDdl(committed, database);
      database.query(`INSERT INTO "cap_photos" ("id", "caption") VALUES ('a', 'Before')`).run();

      const migration = deriveAdditiveCapabilityMigration(committed, photoSpec());
      expect(migration.statements).toHaveLength(1);
      expect(migration.statements[0]).toStartWith(
        'ALTER TABLE "cap_photos" ADD COLUMN "photo" TEXT',
      );
      applyAdditiveCapabilityMigration(migration, database);

      expect(database.query(`SELECT "photo" FROM "cap_photos" WHERE "id" = 'a'`).get()).toEqual({
        photo: null,
      });
      expect(() => insertPhoto(database, "[]")).toThrow(/CHECK constraint failed/);
    } finally {
      database.close();
    }
  });
});

describe("reading a file column through the query port", () => {
  test("a Handler may not declare one as a projected column yet", () => {
    const database = new Database(":memory:");
    try {
      applyCapabilityTableDdl(photoSpec(), database);
      const query = createCapabilityQueryPort(database, { target: photoSpec() });
      expect(() =>
        query.all({
          sql: 'SELECT "photo" FROM "cap_photos"',
          result: [{ alias: "photo", type: "file" as "string" }],
        }),
      ).toThrow('Invalid query result type "file" for alias "photo".');
    } finally {
      database.close();
    }
  });

  test("a record read carries an empty file field as null", () => {
    const database = new Database(":memory:");
    try {
      applyCapabilityTableDdl(photoSpec(), database);
      insertPhoto(database, null);
      const query = createCapabilityQueryPort(database, { target: photoSpec() });
      const [record] = query.records({ sql: 'SELECT "id" AS "target_id" FROM "cap_photos"' });
      expect(record?.record.fields).toMatchObject({ caption: "A day out", photo: null });
    } finally {
      database.close();
    }
  });
});
