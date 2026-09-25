// A question over Photos never hands the model a key or a `/files/` address (Module 7 PLAN
// decision 37). The desk is real: ledger rows admitted the way the upload route admits them,
// columns built from them the way a save builds them, and statements run in the real worker. The
// proof is the exact text each prompt carries, in both the turn's prompt and the answer's.

import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";
import {
  type FileLedgerSeed,
  requireFileLedgerRow,
  seedFileLedgerRow,
} from "../../platform/files/ledger.test-support.ts";
import { FILE_LEDGER_TABLE } from "../../platform/persistence/table-names.ts";
import { CAPTION_FIELD, PHOTO_FIELD, photoSpec } from "../../registry/fields/file.test-support.ts";
import { FIRST_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import { type CapabilitySpec, readActiveRegistryCatalog } from "../../registry/index.ts";
import { capabilityTableName } from "../data/schema/ddl.ts";
import { storedFileReference } from "../data/schema/file-values.ts";
import { createQueryWorker, type QueryWorker } from "./query-worker.ts";
import {
  answers,
  nextPrompt,
  type QuestionDesk,
  questionDesk,
  reads,
  registerCapability,
  registeredSpecs,
  scriptedProvider,
} from "./question.test-support.ts";
import {
  fileKeyDigits,
  QUESTION_FILE_WITHHELD,
  questionLedger,
  scrubQuestionRows,
} from "./question-file-scrub.ts";
import {
  QUESTION_STEP_RESULT_TOO_LARGE,
  QUESTION_STEP_SCRUB_CEILING_CHARACTERS,
  questionRowsTooLargeToScrub,
  renderQuestionRows,
} from "./question-payload.ts";
import { QUESTION_DESK_SCHEMA, questionViews } from "./question-views.ts";
import { createScratchPlatforms } from "./read-scope.test-support.ts";

const OLD_PHOTO = { ...PHOTO_FIELD, name: "old_photo", lifecycle: "inactive" as const };
const TAGS = { ...CAPTION_FIELD, name: "tags", type: "string[]" as const, required: false };
const TAGGED = photoSpec([...photoSpec().schema.fields, OLD_PHOTO, TAGS]);
const SPEC = {
  ...TAGGED,
  ui_intent: {
    ...TAGGED.ui_intent,
    form: { ...TAGGED.ui_intent.form, list_inputs: [{ field: TAGS.name, mode: "repeatable" }] },
  },
} satisfies CapabilitySpec;
const TABLE = capabilityTableName(SPEC.id);
const QUESTION = "how many photos do I have, and what kind of files are they?";

const PHOTOS = [
  { mime: "image/png", size: 1_204, name: "harbour.png" },
  { mime: "image/png", size: 88_310, name: "fox at the gate.png" },
  { mime: "image/jpeg", size: 402_117, name: "IMG_4821.JPG" },
] as const;

/** A key written in fullwidth characters: the one copy only the scrub of what comes back reads. */
const fullwidth = (text: string) =>
  [...text].map((character) => String.fromCharCode(character.charCodeAt(0) + 0xfee0)).join("");
const NUL = String.fromCharCode(0);

/** What each record is for. A caption named for a key holds one, copied the way it says. */
const ROLES = ["copied", "pending", "plain", "named", "gone", "bare", "wide", "nul"] as const;
type Role = (typeof ROLES)[number];
const WITHHELD_CAPTIONS: readonly Role[] = ["copied", "pending", "gone", "bare", "wide", "nul"];
const WIDE = "wide ";

interface PhotosDesk {
  readonly desk: QuestionDesk;
  readonly ids: Record<Role, string>;
  /** Every key the ledger holds: four photos', a pending upload's and a cleaned-up file's. */
  readonly keys: string[];
}

/**
 * Four photos saved the way a save saves them, and four records with none. The fourth photo's
 * file was named after the first's key, the way a browser names a file saved from its address.
 */
function photosDesk(): PhotosDesk {
  const ids = Object.fromEntries(ROLES.map((role) => [role, randomUUID()])) as Record<Role, string>;
  const keys: string[] = [];
  const seed = (database: Database) => {
    const admit = (file: Partial<FileLedgerSeed>) =>
      seedFileLedgerRow(database, {
        capabilityId: SPEC.id,
        incarnationId: FIRST_INCARNATION_ID,
        field: PHOTO_FIELD.name,
        ...file,
      });
    const insert = database.prepare(
      `INSERT INTO ${TABLE} (id, created_at, extra, caption, photo, old_photo, tags) VALUES (?, ?, '{}', ?, ?, ?, ?)`,
    );
    const save = (role: Role, caption: string, key: string | null) => {
      const stored = key && storedFileReference(requireFileLedgerRow(database, key));
      const tags = role === "copied" ? JSON.stringify(["harbour", key]) : null;
      insert.run(ids[role], "2026-09-20 09:00:00", caption, stored, stored, tags);
    };
    const pending = admit({ state: "pending", recordId: null });
    const cleaned = admit({ state: "cleanup_enqueued", recordId: "a-deleted-record" });
    const [first, second, third] = [0, 1, 2].map((index) =>
      admit({ state: "owned", recordId: ids[ROLES[index] as Role], ...PHOTOS[index] }),
    ) as [string, string, string];
    const renamed = admit({ state: "owned", recordId: ids.named, name: `${first}.png` });
    save("copied", `copied ${first} here`, first);
    save("pending", `pending ${pending}`, second);
    save("plain", "photo 2", third);
    save("named", "renamed", renamed);
    save("gone", `gone ${cleaned}`, null);
    save("bare", `bare ${third.replaceAll("-", "").toUpperCase()}`, null);
    save("wide", `${WIDE}${fullwidth(third)}`, null);
    save("nul", `${NUL}${second}`, null);
    keys.push(first, second, third, renamed, pending, cleaned);
    insert.finalize();
  };
  const desk = questionDesk(platforms, seed, (database) => {
    registerCapability(database, SPEC, FIRST_INCARNATION_ID);
    return registeredSpecs(database);
  });
  return { desk, ids, keys };
}

/** Nothing here writes to the desk, so every suite reads the one. */
const platforms = createScratchPlatforms();
let shared: PhotosDesk;
/** The worker the question's scope would start, read directly: no scrub stands behind it. */
let worker: QueryWorker;

beforeAll(() => {
  shared = photosDesk();
  const catalog = readActiveRegistryCatalog(shared.desk.database.readonly);
  worker = createQueryWorker(shared.desk.path, questionViews(catalog));
});

afterAll(() => {
  worker.close();
  platforms.disposeAll();
});

/** Every spelling of a key a prompt could carry it in, fullwidth ones included. */
function expectNoKey(prompt: string, keys: readonly string[]): void {
  const lower = prompt.toLowerCase();
  const digits = fileKeyDigits(prompt);
  for (const key of keys) {
    expect(lower).not.toContain(key);
    expect(digits).not.toContain(fileKeyDigits(key));
    expect(digits).not.toContain(Buffer.from(key).toString("hex"));
    expect(digits).not.toContain(Buffer.from(fullwidth(key)).toString("hex"));
  }
}

/** Both prompts one read produces: the next turn's, which carries its rows, and the answer's. */
async function promptsFor(desk: QuestionDesk, sql: string, parameters: string[] = []) {
  const run = await desk.run(scriptedProvider(reads(sql, parameters), answers()), QUESTION);
  const turn = run.prompts[1];
  if (turn === undefined) throw new Error("the read did not come back");
  return { turn, answer: run.answerPrompts[0] ?? "", step: run.steps[0] };
}

/** The fullwidth caption's key, as a statement reads it back out of the caption. */
const WIDE_KEY = `substr(caption, ${WIDE.length + 1}, 36)`;
const TO_36 = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 36)";

/** Ways a statement can dress a key: halves swapped, a letter a row, hex, codes, backwards. */
function dressings(key: string, where: string): readonly (readonly [string, string])[] {
  const from = `FROM ${TABLE} ${where}`;
  const rows = `FROM n, ${TABLE} ${where}`;
  return [
    ["in capitals", `SELECT upper(${key}) AS k ${from}`],
    ["in halves, reversed", `SELECT substr(${key}, 17) AS b, substr(${key}, 1, 16) AS a ${from}`],
    ["a character a row beside its index", `${TO_36} SELECT i, substr(${key}, i, 1) AS c ${rows}`],
    ["hex-encoded", `SELECT hex(${key}) AS k ${from}`],
    ["hex-encoded three times", `SELECT hex(hex(hex(${key}))) AS k ${from}`],
    ["as a blob", `SELECT CAST(${key} AS BLOB) AS k ${from}`],
    [
      "as character codes",
      `${TO_36} SELECT group_concat(unicode(substr(${key}, i, 1))) AS k ${rows}`,
    ],
    ["backwards", `${TO_36} SELECT group_concat(substr(${key}, 37 - i, 1), '') AS k ${rows}`],
  ];
}

interface ReadBack {
  readonly id: string;
  readonly caption: string;
  readonly photo: string | null;
}

describe("a question over Photos", () => {
  test("hands the model every file's kind, type, size and name, and none of its keys", async () => {
    const { desk, ids, keys } = shared;
    const { turn, answer, step } = await promptsFor(
      desk,
      `SELECT id, caption, photo FROM ${TABLE}`,
    );
    if (step?.result.outcome !== "rows") throw new Error("the read did not come back");
    const rendered = renderQuestionRows(step.result.rows);
    const read = new Map((JSON.parse(rendered) as ReadBack[]).map((row) => [row.id, row]));

    for (const prompt of [turn, answer]) {
      expect(prompt).toContain(rendered);
      expectNoKey(prompt, keys);
      expect(prompt).not.toContain(FILE_URL_PREFIX);
    }
    PHOTOS.forEach(({ mime, size, name }, index) => {
      const photo = read.get(ids[ROLES[index] as Role])?.photo;
      expect(photo).toBe(JSON.stringify({ kind: "image", mime, size, name }));
    });
    // A file named after a key keeps its kind, type and size, and loses its name.
    expect(JSON.parse(read.get(ids.named)?.photo ?? "{}")).toMatchObject({
      kind: "image",
      name: QUESTION_FILE_WITHHELD,
    });
    for (const role of ROLES) {
      const withheld = WITHHELD_CAPTIONS.includes(role);
      expect({ role, withheld: read.get(ids[role])?.caption === QUESTION_FILE_WITHHELD }).toEqual({
        role,
        withheld,
      });
    }
  });

  test("can still count its photos by type, in what the model reads", async () => {
    const { desk } = shared;
    const { turn, answer } = await promptsFor(
      desk,
      `SELECT json_extract(photo, '$.mime') AS type, count(*) AS how_many FROM ${TABLE} WHERE photo IS NOT NULL GROUP BY type ORDER BY type`,
    );
    const rows = JSON.stringify([
      { type: "image/jpeg", how_many: 2 },
      { type: "image/png", how_many: 2 },
    ]);
    expect(turn).toContain(rows);
    expect(answer).toContain(rows);
  });
});

describe("the worker holds no key a statement can reach", () => {
  test("a file column comes as its kind, type, size and name, never its key", async () => {
    const rows = await worker.read(
      `SELECT photo, json_extract(photo, '$.key') AS k FROM ${TABLE} WHERE photo IS NOT NULL`,
    );
    expect(rows.map(({ k }) => k)).toEqual([0, 1, 2, 3].map(() => null));
    expectNoKey(JSON.stringify(rows), shared.keys);
  });

  test("a copy in text is withheld before any statement reads it, all but the fullwidth one", async () => {
    const { ids } = shared;
    const rows = await worker.read(`SELECT id, caption FROM ${TABLE}`);
    const raw = new Map(rows.map((row) => [row.id, row.caption]));
    for (const role of WITHHELD_CAPTIONS) {
      const atSource = raw.get(ids[role]) === QUESTION_FILE_WITHHELD;
      expect({ role, atSource }).toEqual({ role, atSource: role !== "wide" });
    }
  });

  test("a list holding a key comes as a list, holding the withheld phrase alone", async () => {
    const rows = await worker.read(`SELECT tags FROM ${TABLE} WHERE id = ?`, [shared.ids.copied]);
    expect(rows).toEqual([{ tags: JSON.stringify([QUESTION_FILE_WITHHELD]) }]);
  });

  test("nor does what SQLite says of a bad path quote one", async () => {
    const read = worker.read(`SELECT json_extract('{}', photo) AS k FROM ${TABLE}`);
    await expect(read).rejects.toThrow(/bad JSON path/);
    await read.catch((error: Error) => expectNoKey(error.message, shared.keys));
  });

  test("nor a table or column the table bound refuses, the ledger's key included", async () => {
    await expect(worker.read(`SELECT key FROM ${FILE_LEDGER_TABLE}`)).rejects.toThrow(
      /no such column/,
    );
    expect(await worker.read(`SELECT * FROM ${FILE_LEDGER_TABLE}`)).toEqual([]);
    for (const column of ["extra", OLD_PHOTO.name]) {
      await expect(worker.read(`SELECT ${column} FROM ${TABLE}`)).rejects.toThrow(/no such column/);
    }
  });

  test("and a write naming the file's own schema fails read-only before it reads", async () => {
    const { desk, keys } = shared;
    const underneath = `${QUESTION_DESK_SCHEMA}.${TABLE}`;
    const { turn, step } = await promptsFor(
      desk,
      `UPDATE ${underneath} SET caption = json_extract('{}', (SELECT photo FROM ${underneath} LIMIT 1))`,
    );
    expect(step?.result).toMatchObject({ outcome: "failed" });
    expect(step?.result.outcome === "failed" && step.result.message).toContain("readonly database");
    expectNoKey(turn, keys);
  });

  test("and no schema name reaches the table underneath", async () => {
    const { desk, keys } = shared;
    for (const schema of ["main", QUESTION_DESK_SCHEMA]) {
      const { turn, step } = await promptsFor(desk, `SELECT photo FROM ${schema}.${TABLE}`);
      expect(step?.result.outcome).toBe("failed");
      expectNoKey(turn, keys);
    }
  });
});

describe("a copy only the scrub of what comes back can read", () => {
  const ONLY = `WHERE caption LIKE '${WIDE}%'`;

  for (const [how, sql] of dressings(WIDE_KEY, ONLY)) {
    test(`is never handed to the model ${how}`, async () => {
      const { desk, keys } = shared;
      const { turn, answer, step } = await promptsFor(desk, sql);
      if (step?.result.outcome !== "rows") throw new Error("the read did not come back");
      // Most dressings hide from a search of the prompt, so every text still holding a digit is
      // what proves the scrub read it: a hyphen or an index is all that may stay.
      const kept = step.result.rows.flatMap((row) =>
        Object.values(row).filter(
          (value) =>
            typeof value === "string" &&
            value !== QUESTION_FILE_WITHHELD &&
            /[0-9a-f]/i.test(value.normalize("NFKC")),
        ),
      );
      expect(kept).toEqual([]);
      expectNoKey(turn, keys);
      expectNoKey(answer, keys);
    });
  }

  test("is withheld from what SQLite says about a statement it broke", async () => {
    const { desk, keys } = shared;
    const { turn, step } = await promptsFor(
      desk,
      `SELECT json_extract('{}', ${WIDE_KEY}) FROM ${TABLE} ${ONLY}`,
    );
    expect(step?.result.outcome).toBe("failed");
    expectNoKey(turn, keys);
    expect(turn).toContain(QUESTION_FILE_WITHHELD);
  });

  test("is withheld from a statement and the values it was bound to, before either is weighed", async () => {
    const { desk, keys } = shared;
    const key = keys[0] as string;
    const { turn, answer, step } = await promptsFor(
      desk,
      `SELECT count(*) AS how_many FROM ${TABLE} WHERE caption <> '${key}' AND caption <> ?`,
      [key],
    );
    expect(step?.call?.sql).toBe(QUESTION_FILE_WITHHELD);
    expect(step?.call?.parameters).toEqual([QUESTION_FILE_WITHHELD]);
    for (const prompt of [turn, answer]) {
      expectNoKey(prompt, keys);
      expect(prompt).toContain(QUESTION_FILE_WITHHELD);
    }
  });
});

describe("a key the ledger takes after a question was asked", () => {
  test("is withheld from the next question, pending or being cleaned up", async () => {
    const desk = questionDesk(platforms, undefined, (database) => {
      registerCapability(database, SPEC, FIRST_INCARNATION_ID);
      return registeredSpecs(database);
    });
    const sql = `SELECT caption FROM ${TABLE}`;
    expect((await promptsFor(desk, sql)).step?.result).toMatchObject({ outcome: "rows" });

    const database = desk.database.readwrite;
    const admit = (seed: Partial<FileLedgerSeed>) =>
      seedFileLedgerRow(database, {
        capabilityId: SPEC.id,
        incarnationId: FIRST_INCARNATION_ID,
        field: PHOTO_FIELD.name,
        ...seed,
      });
    const keys = [
      admit({ state: "pending", recordId: null }),
      admit({ state: "cleanup_enqueued", recordId: "a-deleted-record" }),
    ];
    const insert = database.prepare(
      `INSERT INTO ${TABLE} (id, created_at, extra, caption) VALUES (?, '2026-09-21 09:00:00', '{}', ?)`,
    );
    for (const key of keys) insert.run(randomUUID(), `${WIDE}${fullwidth(key)}`);
    insert.finalize();

    const { turn, answer, step } = await promptsFor(desk, sql);
    expect(step?.result).toEqual({
      outcome: "rows",
      rows: keys.map(() => ({ caption: QUESTION_FILE_WITHHELD })),
    });
    expectNoKey(turn, keys);
    expectNoKey(answer, keys);
  });
});

describe("rows far past the cap", () => {
  test("are refused before the scrub reads them", async () => {
    const { desk } = shared;
    const { step } = await promptsFor(
      desk,
      `SELECT printf('%.*c', ${QUESTION_STEP_SCRUB_CEILING_CHARACTERS}, 'x') AS t FROM ${TABLE} LIMIT 1`,
    );
    expect(step?.result).toEqual({ outcome: "failed", message: QUESTION_STEP_RESULT_TOO_LARGE });
  });

  test("are counted cell by cell, name and value", () => {
    const name = "t";
    const at = (length: number) => [{ [name]: "x".repeat(length - name.length) }];
    expect(questionRowsTooLargeToScrub(at(QUESTION_STEP_SCRUB_CEILING_CHARACTERS))).toBe(false);
    expect(questionRowsTooLargeToScrub(at(QUESTION_STEP_SCRUB_CEILING_CHARACTERS + 1))).toBe(true);
  });
});

describe("the scrub, value by value", () => {
  const key = randomUUID();
  const ledger = questionLedger([key]);
  const empty = questionLedger([]);
  const address = `${FILE_URL_PREFIX}${key.slice(0, 8)}`;

  test("replaces an address however it is escaped", () => {
    const tail = key.slice(0, 8);
    const escaped = [
      `see ${address}`,
      JSON.stringify({ url: address }).replaceAll("/", "\\/"),
      JSON.stringify({ url: address }).replaceAll("/", "\\\\/"),
      `${FILE_URL_PREFIX.replaceAll("/", "\\u002f")}${tail}`,
      `${FILE_URL_PREFIX.replaceAll("/", "\uff0f")}${tail}`,
      encodeURIComponent(encodeURIComponent(encodeURIComponent(encodeURIComponent(address)))),
      `%2F${address.slice(1)}`,
      `${FILE_URL_PREFIX.replaceAll("/", "&#47;")}${tail}`,
      `${FILE_URL_PREFIX.slice(0, 3)}\u200b${FILE_URL_PREFIX.slice(3)}${tail}`,
      `${FILE_URL_PREFIX.slice(0, 3)}\u202e${FILE_URL_PREFIX.slice(3)}${tail}`,
    ];
    expect(scrubQuestionRows([Object.fromEntries(escaped.entries())], empty)).toEqual([
      Object.fromEntries(escaped.map((_, index) => [index, QUESTION_FILE_WITHHELD])),
    ]);
  });

  test("leaves a path with no key after it, and a uuid the ledger does not hold", () => {
    const rows = [
      {
        a: "/Users/me/Files/taxes",
        b: `https://example.com${FILE_URL_PREFIX}report.pdf`,
        c: `WHERE note LIKE '%${FILE_URL_PREFIX}%'`,
        d: randomUUID(),
        e: 3,
        f: null,
      },
    ];
    expect(scrubQuestionRows(rows, ledger)).toEqual(rows);
  });

  test("survives an entity no code point answers to", () => {
    const rows = [{ a: `&#${"9".repeat(400)};`, b: `&#x${"f".repeat(300)};` }];
    expect(scrubQuestionRows(rows, empty)).toEqual(rows);
  });

  test("withholds only the cells a key runs through", () => {
    const rows = [{ a: key.slice(0, 18), n: null, count: 3, b: key.slice(18), c: "stays" }];
    expect(scrubQuestionRows(rows, ledger)).toEqual([
      { a: QUESTION_FILE_WITHHELD, n: null, count: 3, b: QUESTION_FILE_WITHHELD, c: "stays" },
    ]);
  });

  test("shows a blob as its bytes in hex, not as a map of numbers", () => {
    const [row] = scrubQuestionRows([{ b: new Uint8Array([0xab, 0x01]) }], empty);
    expect(row).toEqual({ b: "X'AB01'" });
  });

  test("takes a reference whose name holds an address with it", () => {
    const stored = JSON.stringify({
      key,
      kind: "image",
      mime: "image/png",
      size: 1,
      name: address,
    });
    expect(scrubQuestionRows([{ photo: stored }], empty)).toEqual([
      { photo: QUESTION_FILE_WITHHELD },
    ]);
  });

  test("withholds a ledger key in any case, and no other uuid", () => {
    const other = randomUUID();
    expect(scrubQuestionRows([{ a: key.toUpperCase(), b: other }], ledger)).toEqual([
      { a: QUESTION_FILE_WITHHELD, b: other },
    ]);
  });
});

describe("the catalog", () => {
  test("describes a file column by its kind, type, size and name, and never by a key", () => {
    const { desk } = shared;
    const prompt = nextPrompt(QUESTION, registeredSpecs(desk.database.readwrite), []);
    const lines = prompt.split("\n");
    const at = lines.findIndex((line) => line.startsWith(`    - ${PHOTO_FIELD.name}:`));
    const described = lines.slice(at, at + 2).join("\n");

    for (const family of PHOTO_FIELD.accepts ?? []) expect(described).toContain(family);
    for (const part of ["kind", "mime", "size", "name"]) expect(described).toContain(part);
    expect(described).not.toMatch(/\bkey\b/i);
  });
});
