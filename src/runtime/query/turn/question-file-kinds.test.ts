// A question can count, group and filter a desk's files by kind (Module 7 PLAN decisions 20 and
// 37). The statements run are the catalog's own, with this desk's table and columns written in, so
// what the model is taught is what is proven to answer. The desk is real: ledger rows, columns
// built from them the way a save builds them, and the real worker behind the scripted loop.

import type { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { admittedTypes, usualExtension } from "../../../platform/files/admission/admission.ts";
import { FILE_URL_PREFIX } from "../../../platform/files/file-url.ts";
import {
  requireFileLedgerRow,
  seedFileLedgerRow,
} from "../../../platform/files/store/ledger.test-support.ts";
import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  PHOTO_FIELD,
  photoSpec,
} from "../../../registry/fields/file.test-support.ts";
import { FIRST_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import {
  type CapabilitySpec,
  FILE_FAMILIES,
  type FileFamily,
  type SpecField,
} from "../../../registry/index.ts";
import { CapabilityDataValidationError } from "../../data/index.ts";
import { capabilityTableName } from "../../data/schema/ddl.ts";
import { storedFileList, storedFileReference } from "../../data/schema/file-values.ts";
import {
  answers,
  nextPrompt,
  type QuestionDesk,
  questionDesk,
  reads,
  registerCapability,
  registeredSpecs,
  scriptedProvider,
} from "../question.test-support.ts";
import { createScratchPlatforms } from "../scope/read-scope.test-support.ts";
import { assertWholeCatalogQuery } from "../scope/whole-catalog-query-scope.ts";
import { fileKeyDigits } from "../step/question-file-scrub.ts";
import { renderQuestionRows } from "../step/question-payload.ts";
import type { QueryWorkerRow } from "../worker/query-worker.ts";
import {
  QUESTION_FILE_COLUMN,
  QUESTION_FILE_LIST,
  QUESTION_FILE_RULES,
  QUESTION_FILE_SQL,
  QUESTION_FILE_TABLE,
} from "./question-turn-prompt.ts";

const CLIP: SpecField = { ...PHOTO_FIELD, name: "clip", accepts: ["video", "document"] };
/** Named like a column of json_each's own, which an unqualified argument would read instead. */
const ATTACHMENTS: SpecField = {
  ...ALBUM_FIELD,
  name: "path",
  accepts: ["image", "video", "document"],
};
/** A field called kind, holding words that are no file's kind, for a statement to mistake. */
const KIND: SpecField = { ...CAPTION_FIELD, name: "kind", required: false };
const SPEC = photoSpec([CAPTION_FIELD, KIND, CLIP, ATTACHMENTS]);
const TABLE = capabilityTableName(SPEC.id);
const QUESTION = "how many videos are in my notes?";

interface File {
  readonly kind: FileFamily;
  readonly mime: string;
  readonly name: string;
}

const VIDEO: File = { kind: "video", mime: "video/mp4", name: "harbour.mp4" };
const PDF: File = { kind: "document", mime: "application/pdf", name: "plan.pdf" };
const WORD: File = {
  kind: "document",
  mime: admittedTypes("document").find((mime) => usualExtension(mime) === "docx") ?? "",
  name: "plan.docx",
};
const PHOTO: File = { kind: "image", mime: "image/png", name: "fox.png" };

/** Two records hold a video that reads alike: same kind, type, size and name, two files. */
const NOTES: readonly {
  caption: string;
  kind: string | null;
  clip: File | null;
  attachments: readonly File[] | null;
}[] = [
  { caption: "harbour", kind: "trip", clip: VIDEO, attachments: [PHOTO, PDF, PHOTO] },
  { caption: "fox", kind: "work", clip: VIDEO, attachments: [VIDEO, VIDEO] },
  { caption: "taxes", kind: "trip", clip: PDF, attachments: [PDF, WORD] },
  { caption: "added before attachments", kind: "work", clip: null, attachments: null },
  { caption: "nothing attached", kind: "trip", clip: null, attachments: [] },
  { caption: "unsorted", kind: null, clip: null, attachments: [PHOTO, PHOTO, PHOTO] },
];

const platforms = createScratchPlatforms();
const keys: string[] = [];

function seed(database: Database): void {
  const insert = database.prepare(
    `INSERT INTO ${TABLE} (id, created_at, extra, caption, kind, clip, path) VALUES (?, '2026-10-01 09:00:00', '{}', ?, ?, ?, ?)`,
  );
  for (const note of NOTES) {
    const id = randomUUID();
    const admit = (field: SpecField, file: File) => {
      const key = seedFileLedgerRow(database, {
        capabilityId: SPEC.id,
        incarnationId: FIRST_INCARNATION_ID,
        field: field.name,
        state: "owned",
        recordId: id,
        size: 4_096,
        ...file,
      });
      keys.push(key);
      return requireFileLedgerRow(database, key);
    };
    const clip = note.clip && storedFileReference(admit(CLIP, note.clip));
    const attachments =
      note.attachments && storedFileList(note.attachments.map((file) => admit(ATTACHMENTS, file)));
    insert.run(id, note.caption, note.kind, clip, attachments);
  }
  insert.finalize();
}

const desk: QuestionDesk = questionDesk(platforms, seed, (database) => {
  registerCapability(database, SPEC, FIRST_INCARNATION_ID);
  return registeredSpecs(database);
});

afterAll(() => platforms.disposeAll());

function written(sql: string): string {
  return sql
    .replaceAll(QUESTION_FILE_TABLE, TABLE)
    .replaceAll(QUESTION_FILE_COLUMN, CLIP.name)
    .replaceAll(QUESTION_FILE_LIST, ATTACHMENTS.name);
}

/** No key in any spelling the scrub reads, and no address. */
function expectNothingOfAFile(prompt: string): void {
  const digits = fileKeyDigits(prompt);
  for (const key of keys) {
    expect(prompt.toLowerCase()).not.toContain(key);
    expect(digits).not.toContain(fileKeyDigits(key));
  }
  expect(prompt).not.toContain(FILE_URL_PREFIX);
}

/** One read through the loop: the rows that reached the model, and how the question ended. */
async function ask(sql: string, parameters: (string | number)[] = []) {
  const run = await desk.run(scriptedProvider(reads(sql, parameters), answers()), QUESTION);
  const step = run.steps[0];
  if (step?.result.outcome !== "rows") throw new Error(`the read failed: ${sql}`);
  const { rows } = step.result;
  const { ending } = run.result;
  // A read that matched nothing ends the question before an answer is asked for (6.4/04).
  const reached = [run.prompts[1], ...(ending === "answered" ? [run.answerPrompts[0]] : [])];
  for (const prompt of reached) expect(prompt).toContain(renderQuestionRows(rows));
  for (const prompt of [...run.prompts, ...run.answerPrompts]) expectNothingOfAFile(prompt);
  return { rows, ending };
}

/** How a question that read `expected` rows of a listing ends. */
const endingFor = (expected: readonly unknown[]) =>
  expected.length > 0 ? "answered" : "nothing_found";

function tally(files: readonly File[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { kind } of files) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

function byKind(rows: readonly QueryWorkerRow[]): Record<string, unknown> {
  return Object.fromEntries(rows.map((row) => [row.kind, row.files]));
}

/** Whether `files` holds more than `more` of `kind`, the number read the way SQLite casts it. */
const holding = (files: readonly File[] | null, kind: string, more: number | string) =>
  (files ?? []).filter((file) => file.kind === kind).length > Number(more);

const captionsHolding = (holds: (note: (typeof NOTES)[number]) => boolean) =>
  NOTES.filter(holds)
    .map(({ caption }) => caption)
    .sort();

describe("a question over a desk's files", () => {
  test("counts a file column's files by kind, two that read alike as two", async () => {
    const { rows, ending } = await ask(written(QUESTION_FILE_SQL.countByKind));
    const clips = NOTES.flatMap(({ clip }) => (clip ? [clip] : []));
    expect({ counts: byKind(rows), ending }).toEqual({ counts: tally(clips), ending: "answered" });
  });

  test("groups a file[] column's files by kind across every record", async () => {
    const { rows, ending } = await ask(written(QUESTION_FILE_SQL.countListByKind));
    const files = NOTES.flatMap(({ attachments }) => attachments ?? []);
    expect({ counts: byKind(rows), ending }).toEqual({ counts: tally(files), ending: "answered" });
  });

  test("filters records by the kind a file column holds", async () => {
    const where = written(QUESTION_FILE_SQL.holdsKind);
    for (const kind of FILE_FAMILIES) {
      const sql = `SELECT t.caption AS note FROM ${TABLE} AS t WHERE ${where} ORDER BY note`;
      const { rows, ending } = await ask(sql, [kind]);
      const notes = captionsHolding(({ clip }) => clip?.kind === kind);
      expect({ kind, notes: rows.map(({ note }) => note), ending }).toEqual({
        kind,
        notes,
        ending: endingFor(notes),
      });
    }
  });

  test("filters records by a kind anywhere in a file[] column, nulls and empties holding none", async () => {
    const where = written(QUESTION_FILE_SQL.listHoldsKind);
    for (const kind of FILE_FAMILIES) {
      const sql = `SELECT t.caption AS note FROM ${TABLE} AS t WHERE ${where} ORDER BY note`;
      const { rows, ending } = await ask(sql, [kind]);
      const notes = captionsHolding(
        ({ attachments }) => !!attachments?.some((f) => f.kind === kind),
      );
      expect({ kind, notes: rows.map(({ note }) => note), ending }).toEqual({
        kind,
        notes,
        ending: endingFor(notes),
      });
    }
  });

  test("filters records by how many files of a kind a file[] column holds", async () => {
    const where = written(QUESTION_FILE_SQL.listCountsKind);
    // The number may come bound as text, which SQLite ranks above every integer uncast.
    for (const kind of FILE_FAMILIES) {
      for (const more of [0, 1, "1", 2]) {
        const sql = `SELECT t.caption AS note ${where} ORDER BY note`;
        const { rows, ending } = await ask(sql, [kind, more]);
        const notes = captionsHolding(({ attachments }) => holding(attachments, kind, more));
        expect({ kind, more, notes: rows.map(({ note }) => note), ending }).toEqual({
          kind,
          more,
          notes,
          ending: endingFor(notes),
        });
      }
    }
  });

  test("finds a record by how many files it holds, shown by a column it leaves empty", async () => {
    const where = written(QUESTION_FILE_SQL.listCountsKind);
    const { rows, ending } = await ask(`SELECT t.kind AS kind ${where}`, ["image", 2]);
    const found = NOTES.filter(({ attachments }) => holding(attachments, "image", 2));
    expect({ rows, ending }).toEqual({
      rows: found.map(({ kind }) => ({ kind })),
      ending: "answered",
    });
    expect(found.map(({ kind }) => kind)).toEqual([null]);
  });

  test("counts a file column's files and a file[] column's together by kind", async () => {
    const { rows, ending } = await ask(written(QUESTION_FILE_SQL.countBothByKind));
    const files = NOTES.flatMap(({ clip, attachments }) => [
      ...(clip ? [clip] : []),
      ...(attachments ?? []),
    ]);
    expect({ counts: byKind(rows), ending }).toEqual({ counts: tally(files), ending: "answered" });
  });

  test("hands the model a file[] column read whole without a key or an address", async () => {
    const { rows } = await ask(`SELECT caption AS note, path FROM ${TABLE} ORDER BY note`);
    for (const row of rows) {
      const note = NOTES.find(({ caption }) => caption === row.note);
      const files = JSON.parse(String(row.path)) as Record<string, unknown>[];
      expect(files.map(({ kind, mime, name }) => ({ kind, mime, name }))).toEqual(
        (note?.attachments ?? []).map(({ kind, mime, name }) => ({ kind, mime, name })),
      );
      for (const file of files)
        expect(Object.keys(file).sort()).toEqual(["kind", "mime", "name", "size"]);
    }
  });
});

describe("the table bound", () => {
  // It counts `OpenRead`, and a virtual table opens with `VOpen`, so an FTS5 table added later
  // would be read without ever appearing among the tables a statement opens.
  const bounded = questionDesk(platforms, seed, (database) => {
    registerCapability(database, SPEC, FIRST_INCARNATION_ID);
    database.exec("CREATE VIRTUAL TABLE sneak USING fts5(body)");
    return registeredSpecs(database);
  });
  const specs = registeredSpecs(bounded.database.readonly);
  const admit = (sql: string) => () =>
    assertWholeCatalogQuery(bounded.database.readonly, specs, sql, []);

  test("admits json_each and json_tree over a value it may read", () => {
    for (const sql of Object.values(QUESTION_FILE_SQL)) {
      const statement = sql.startsWith("SELECT")
        ? sql
        : sql.startsWith("FROM")
          ? `SELECT t.id AS record ${sql}`
          : `SELECT t.id AS record FROM <table> AS t WHERE ${sql}`;
      const bound = written(statement).replace("?", "'video'").replace("?", "1");
      expect(admit(bound)).not.toThrow();
    }
    expect(admit(`SELECT t.value AS v FROM ${TABLE}, json_tree(${TABLE}.path) AS t`)).not.toThrow();
  });

  test("refuses every other virtual table, and json_each over a column it may not read", () => {
    for (const sql of [
      "SELECT body AS b FROM sneak",
      "SELECT e.value AS v, s.body AS b FROM json_each('[1]') AS e, sneak AS s",
      "SELECT e.value AS v FROM json_each((SELECT body FROM sneak)) AS e",
      `SELECT e.value AS v FROM ${TABLE}, json_each(${TABLE}.extra) AS e`,
    ]) {
      expect(admit(sql)).toThrow(CapabilityDataValidationError);
    }
  });
});

describe("the catalog", () => {
  const prompt = nextPrompt(QUESTION, registeredSpecs(desk.database.readwrite), []);
  const lines = prompt.split("\n");

  function described(field: SpecField): string {
    const at = lines.findIndex((line) => line.startsWith(`    - ${field.name}:`));
    const end = lines.findIndex((line, index) => index > at && !line.startsWith("      "));
    return lines.slice(at, end).join("\n");
  }

  /** Whether `token` is a word of its own in `text`, rather than part of a type or another word. */
  function standsAlone(text: string, token: string): boolean {
    const escaped = token.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return new RegExp(`(?<![\\w/+-]|\\w\\.)${escaped}(?![\\w/+-]|\\.\\w)`).test(text);
  }

  test("tells the model how to read files by kind, naming every kind and no key", () => {
    for (const rule of QUESTION_FILE_RULES) expect(prompt).toContain(rule);
    const [kinds = ""] = QUESTION_FILE_RULES;
    for (const kind of FILE_FAMILIES)
      expect({ kind, named: standsAlone(kinds, kind) }).toEqual({ kind, named: true });
    const rules = QUESTION_FILE_RULES.join("\n");
    expect(rules).not.toMatch(/\bkey\b/i);
  });

  test("describes each file column by the kinds and types it can hold, and never by a key", () => {
    for (const field of [CLIP, ATTACHMENTS]) {
      const description = described(field);
      for (const kind of FILE_FAMILIES) {
        const accepted = field.accepts?.includes(kind) ?? false;
        for (const mime of admittedTypes(kind)) {
          expect({ kind, mime, listed: standsAlone(description, mime) }).toEqual({
            kind,
            mime,
            listed: accepted,
          });
        }
        expect({ kind, named: standsAlone(description, kind) }).toEqual({ kind, named: accepted });
      }
      expect(description).not.toMatch(/\bkey\b/i);
    }
  });

  test("tells a file[] column from a file column holding the same kinds", () => {
    const clips: SpecField = { ...CLIP, name: "clips", type: "file[]" };
    const both = nextPrompt(QUESTION, [photoSpec([CAPTION_FIELD, CLIP, clips])], []).split("\n");
    const shapeOf = (field: SpecField) =>
      both[both.findIndex((line) => line.startsWith(`    - ${field.name}:`)) + 1];
    expect(shapeOf(clips)).not.toEqual(shapeOf(CLIP));
  });

  test("adds the file rules and no others when any collection has a file column", () => {
    const rulesOf = (specs: readonly CapabilitySpec[]) => {
      const all = nextPrompt(QUESTION, specs, []).split("\n");
      return all.slice(all.indexOf("Rules:"), all.indexOf("Reads left:"));
    };
    const plain = photoSpec([CAPTION_FIELD]);
    const hidden = photoSpec([CAPTION_FIELD, { ...CLIP, lifecycle: "inactive" }]);
    const clips = { ...photoSpec([CAPTION_FIELD, CLIP]), id: "clips" };
    const told = rulesOf([plain, clips]);

    for (const rule of QUESTION_FILE_RULES) expect(told).toContain(rule);
    expect(told.filter((line) => !QUESTION_FILE_RULES.includes(line))).toEqual(rulesOf([plain]));
    expect(rulesOf([hidden])).toEqual(rulesOf([plain]));
  });
});
