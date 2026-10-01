// A file field's column: TEXT holding one JSON reference object, the way a `string[]` column
// holds its array, and nullable, so a record with no photo stores nothing at all.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { fileUrl } from "../../../platform/files/file-url.ts";
import { mintFileKey } from "../../../platform/files/store/ledger.ts";
import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../registry/fields/file.test-support.ts";
import {
  applyAdditiveCapabilityMigration,
  applyCapabilityTableDdl,
  CapabilityDataValidationError,
  createCapabilityQueryPort,
  deriveAdditiveCapabilityMigration,
} from "../index.ts";
import {
  fileKeyFromProjection,
  keylessStoredFileReference,
  projectStoredFileList,
  projectStoredFileReference,
} from "./file-values.ts";
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

describe("a stored reference as generated code sees it", () => {
  test("names its file by the address the key is served from, and cannot be changed", () => {
    const key = mintFileKey();
    const stored = JSON.stringify({ ...JSON.parse(REFERENCE), key });
    const projection = projectStoredFileReference(PHOTO_FIELD.name, stored);
    expect(projection.url).toBe(fileUrl(key));
    expect(fileKeyFromProjection(projection)).toBe(key);
    expect(Object.isFrozen(projection)).toBe(true);
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
      ).toThrow(CapabilityDataValidationError);
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

const storedFile = (name: string) => ({ ...JSON.parse(REFERENCE), key: mintFileKey(), name });

function insertAlbum(database: Database, album: string | null, id = crypto.randomUUID()): void {
  database
    .query(`INSERT INTO "cap_photos" ("id", "caption", "album") VALUES (?, 'A trip', ?)`)
    .run(id, album);
}

describe("a file list's column", () => {
  test("holds nothing or one JSON array, and refuses any other shape", () => {
    const database = new Database(":memory:");
    try {
      applyCapabilityTableDdl(photoSpec([CAPTION_FIELD, ALBUM_FIELD]), database);
      insertAlbum(database, null);
      insertAlbum(database, "[]");
      insertAlbum(database, JSON.stringify([storedFile("a.jpg"), storedFile("b.jpg")]));
      for (const wrong of [REFERENCE, '"a.jpg"', "not json", "42"]) {
        expect(() => insertAlbum(database, wrong)).toThrow(/CHECK constraint failed/);
      }
    } finally {
      database.close();
    }
  });

  test("arrives by evolution holding NULL in older records, which a read carries as []", () => {
    const database = new Database(":memory:");
    try {
      const committed = photoSpec([CAPTION_FIELD]);
      applyCapabilityTableDdl(committed, database);
      database.query(`INSERT INTO "cap_photos" ("id", "caption") VALUES ('a', 'Before')`).run();
      const evolved = photoSpec([CAPTION_FIELD, ALBUM_FIELD]);
      applyAdditiveCapabilityMigration(
        deriveAdditiveCapabilityMigration(committed, evolved),
        database,
      );
      expect(database.query(`SELECT "album" FROM "cap_photos"`).get()).toEqual({ album: null });
      const query = createCapabilityQueryPort(database, { target: evolved });
      const [record] = query.records({ sql: 'SELECT "id" AS "target_id" FROM "cap_photos"' });
      expect(record?.record.fields).toMatchObject({ caption: "Before", album: [] });
    } finally {
      database.close();
    }
  });
});

describe("a stored file list as generated code sees it", () => {
  test("keeps its order, each file named by its address, and cannot be changed", () => {
    const files = [storedFile("b.jpg"), storedFile("a.jpg"), storedFile("c.jpg")];
    const list = projectStoredFileList(ALBUM_FIELD.name, JSON.stringify(files));
    expect(list.map((file) => file.name)).toEqual(["b.jpg", "a.jpg", "c.jpg"]);
    expect(list.map(fileKeyFromProjection)).toEqual(files.map((file) => file.key));
    expect(Object.isFrozen(list)).toBe(true);
    expect(list.every((file) => Object.isFrozen(file))).toBe(true);
  });

  test("is [] for NULL and for an empty list", () => {
    expect(projectStoredFileList(ALBUM_FIELD.name, null)).toEqual([]);
    expect(projectStoredFileList(ALBUM_FIELD.name, "[]")).toEqual([]);
  });

  test("fails closed on any other shape, or a file listed twice", () => {
    const one = storedFile("a.jpg");
    const wrong = [REFERENCE, "not json", "[1]", JSON.stringify([one, one]), JSON.stringify([{}])];
    for (const value of [...wrong, 42]) {
      expect(() => projectStoredFileList(ALBUM_FIELD.name, value)).toThrow(ALBUM_FIELD.name);
    }
  });

  test("reaches a question without a single key", () => {
    const files = [storedFile("a.jpg"), storedFile("b.pdf")];
    const shown = keylessStoredFileReference(JSON.stringify(files));
    expect(JSON.parse(shown ?? "null")).toEqual(
      files.map(({ kind, mime, size, name }) => ({ kind, mime, size, name })),
    );
    for (const file of files) expect(shown).not.toContain(file.key);
    expect(keylessStoredFileReference("[]")).toBeUndefined();
    expect(keylessStoredFileReference(JSON.stringify([files[0], "x"]))).toBeUndefined();
  });
});
