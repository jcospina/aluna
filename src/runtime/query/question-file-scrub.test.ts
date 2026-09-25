// A question over Photos never hands the model a key or a `/files/` address (Module 7 PLAN
// decision 37). The desk is real: ledger rows admitted the way the upload route admits them,
// columns built from them the way a save builds them, and statements run in the real worker. The
// proof is the exact text each prompt carries, in both the turn's prompt and the answer's.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { FILE_URL_PREFIX } from "../../platform/files/file-url.ts";
import {
  type FileLedgerSeed,
  requireFileLedgerRow,
  seedFileLedgerRow,
} from "../../platform/files/ledger.test-support.ts";
import { readFileLedgerKeys } from "../../platform/files/ledger.ts";
import { PHOTO_FIELD, photoSpec } from "../../registry/fields/file.test-support.ts";
import { FIRST_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import { readActiveRegistryCatalog } from "../../registry/index.ts";
import { CAPABILITY_TABLE_PREFIX } from "../data/index.ts";
import { storedFileReference } from "../data/schema/file-values.ts";
import { NO_SHADOW } from "./query-worker.test-support.ts";
import { createQueryWorker } from "./query-worker.ts";
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
  questionFileKeysIn,
  questionLedger,
  scrubQuestionRows,
} from "./question-file-scrub.ts";
import {
  QUESTION_STEP_RESULT_TOO_LARGE,
  QUESTION_STEP_SCRUB_CEILING_BYTES,
  questionRowsTooLargeToScrub,
  renderQuestionRows,
} from "./question-payload.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "./read-scope.test-support.ts";
import { catalogShadow } from "./whole-catalog-read-scope.ts";

let platforms: ScratchPlatforms;

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => {
  platforms.disposeAll();
});

const OLD_PHOTO = { ...PHOTO_FIELD, name: "old_photo", lifecycle: "inactive" as const };
const SPEC = photoSpec([...photoSpec().schema.fields, OLD_PHOTO]);
const TABLE = `${CAPABILITY_TABLE_PREFIX}${SPEC.id}`;
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
      `INSERT INTO ${TABLE} (id, created_at, extra, caption, photo, old_photo) VALUES (?, ?, '{}', ?, ?, ?)`,
    );
    const save = (role: Role, caption: string, key: string | null) => {
      const stored = key && storedFileReference(requireFileLedgerRow(database, key));
      insert.run(ids[role], "2026-09-20 09:00:00", caption, stored, stored);
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

/** A caption's key, as a statement reads it back out of the caption it was copied into. */
const COPIED_KEY = "substr(caption, 8, 36)";
const WIDE_KEY = `substr(caption, ${WIDE.length + 1}, 36)`;
const TO_36 = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 36)";

/** Ways a statement can dress a key: halves swapped, a letter a row, hex, codes, backwards. */
function dressings(key: string, where = ""): readonly (readonly [string, string])[] {
  const from = `FROM ${TABLE} ${where}`;
  const rows = `FROM n, ${TABLE} ${where}`;
  return [
    ["in capitals", `SELECT upper(${key}) AS k ${from}`],
    ["in halves, reversed", `SELECT substr(${key}, 17) AS b, substr(${key}, 1, 16) AS a ${from}`],
    ["a character a row beside its index", `${TO_36} SELECT i, substr(${key}, i, 1) AS c ${rows}`],
    ["hex-encoded", `SELECT hex(${key}) AS k ${from}`],
    ["hex-encoded three times", `SELECT hex(hex(hex(${key}))) AS k ${from}`],
    ["as a blob", `SELECT unhex(replace(${key}, '-', '')) AS k ${from}`],
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
    const { desk, ids, keys } = photosDesk();
    const { turn, answer, step } = await promptsFor(
      desk,
      `SELECT id, caption, photo FROM ${TABLE}`,
    );
    if (step?.result.outcome !== "rows") throw new Error("the read did not come back");
    const rendered = renderQuestionRows(step.result);
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

  test("withholds every copy but the fullwidth one before any statement reads it", async () => {
    const { desk, ids } = photosDesk();
    const { step } = await promptsFor(desk, `SELECT id, caption FROM ${TABLE}`);
    if (step?.result.outcome !== "rows") throw new Error("the read did not come back");
    const raw = new Map(step.result.rows.map((row) => [row.id, row.caption]));
    for (const role of WITHHELD_CAPTIONS) {
      const atSource = raw.get(ids[role]) === QUESTION_FILE_WITHHELD;
      expect({ role, atSource }).toEqual({ role, atSource: role !== "wide" });
    }
  });

  test("can still count its photos by type, in what the model reads", async () => {
    const { desk } = photosDesk();
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
  test("its file columns come without one, an inactive field's too", async () => {
    const { desk } = photosDesk();
    const shadow = catalogShadow(readActiveRegistryCatalog(desk.database.readonly));
    const worker = createQueryWorker(desk.path, shadow);
    try {
      const rows = await worker.read(
        `SELECT json_extract(photo, '$.key') AS k, json_extract(old_photo, '$.key') AS o, json_type(old_photo) AS t FROM ${TABLE} WHERE photo IS NOT NULL`,
      );
      expect(rows).toEqual([0, 1, 2, 3].map(() => ({ k: null, o: null, t: "object" })));
    } finally {
      worker.close();
    }
  });

  const READS: readonly (readonly [string, string])[] = [
    ...dressings("json_extract(photo, '$.key')").map(
      ([how, sql]) => [`the file column's, ${how}`, sql] as const,
    ),
    ...dressings("json_extract(photo, '$.name')").map(
      ([how, sql]) => [`a file name's, ${how}`, sql] as const,
    ),
    ...dressings(COPIED_KEY).map(([how, sql]) => [`the copies', ${how}`, sql] as const),
    ["in what SQLite says of a bad path", `SELECT json_extract('{}', photo) AS k FROM ${TABLE}`],
    ["whole, from every row at once", `SELECT json_group_array(json(photo)) AS k FROM ${TABLE}`],
  ];

  for (const [how, sql] of READS) {
    test(`so nothing of a key comes back: ${how}`, async () => {
      const { desk, keys } = photosDesk();
      const { turn, answer } = await promptsFor(desk, sql);
      expectNoKey(turn, keys);
      expectNoKey(answer, keys);
    });
  }

  test("and a write naming the file's own schema fails read-only before it reads", async () => {
    const { desk, keys } = photosDesk();
    const worker = createQueryWorker(desk.path, NO_SHADOW);
    const [attached] = await worker.read("SELECT name FROM pragma_database_list WHERE file <> ''");
    worker.close();
    const underneath = `${String(attached?.name)}.${TABLE}`;
    const { turn, step } = await promptsFor(
      desk,
      `UPDATE ${underneath} SET caption = json_extract('{}', (SELECT photo FROM ${underneath} LIMIT 1))`,
    );
    expect(step?.result).toMatchObject({ outcome: "failed" });
    expect(step?.result.outcome === "failed" && step.result.message).toContain("readonly database");
    expectNoKey(turn, keys);
  });

  test("and no schema name reaches the table underneath", async () => {
    const { desk, keys } = photosDesk();
    const worker = createQueryWorker(desk.path, NO_SHADOW);
    const [attached] = await worker.read("SELECT name FROM pragma_database_list WHERE file <> ''");
    worker.close();
    for (const schema of ["main", String(attached?.name)]) {
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
      const { desk, keys } = photosDesk();
      const { turn, answer } = await promptsFor(desk, sql);
      expectNoKey(turn, keys);
      expectNoKey(answer, keys);
    });
  }

  test("is withheld from what SQLite says about a statement it broke", async () => {
    const { desk, keys } = photosDesk();
    const { turn, step } = await promptsFor(
      desk,
      `SELECT json_extract('{}', ${WIDE_KEY}) FROM ${TABLE} ${ONLY}`,
    );
    expect(step?.result.outcome).toBe("failed");
    expectNoKey(turn, keys);
    expect(turn).toContain(QUESTION_FILE_WITHHELD);
  });

  test("is withheld from a statement and the values it was bound to, before either is weighed", async () => {
    const { desk, keys } = photosDesk();
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

describe("rows far past the cap", () => {
  test("are refused before the scrub reads them", async () => {
    const { desk } = photosDesk();
    const { step } = await promptsFor(
      desk,
      `SELECT printf('%.*c', ${QUESTION_STEP_SCRUB_CEILING_BYTES}, 'x') AS t FROM ${TABLE} LIMIT 1`,
    );
    expect(step?.result).toEqual({ outcome: "failed", message: QUESTION_STEP_RESULT_TOO_LARGE });
  });

  test("are counted cell by cell, name and value", () => {
    const name = "t";
    const at = (length: number) => [{ [name]: "x".repeat(length - name.length) }];
    expect(questionRowsTooLargeToScrub(at(QUESTION_STEP_SCRUB_CEILING_BYTES))).toBe(false);
    expect(questionRowsTooLargeToScrub(at(QUESTION_STEP_SCRUB_CEILING_BYTES + 1))).toBe(true);
  });
});

describe("the scrub, value by value", () => {
  const key = randomUUID();
  const ledger = questionLedger([key]);
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
    expect(scrubQuestionRows([Object.fromEntries(escaped.entries())], new Set())).toEqual([
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
    expect(scrubQuestionRows(rows, ledger.keys)).toEqual(rows);
  });

  test("survives an entity no code point answers to", () => {
    const rows = [{ a: `&#${"9".repeat(400)};`, b: `&#x${"f".repeat(300)};` }];
    expect(scrubQuestionRows(rows, new Set())).toEqual(rows);
  });

  test("withholds only the cells a key runs through", () => {
    const rows = [{ a: key.slice(0, 18), n: null, count: 3, b: key.slice(18), c: "stays" }];
    expect(scrubQuestionRows(rows, questionFileKeysIn(rows, ledger))).toEqual([
      { a: QUESTION_FILE_WITHHELD, n: null, count: 3, b: QUESTION_FILE_WITHHELD, c: "stays" },
    ]);
  });

  test("shows a blob as its bytes in hex, not as a map of numbers", () => {
    const [row] = scrubQuestionRows([{ b: new Uint8Array([0xab, 0x01]) }], new Set());
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
    expect(scrubQuestionRows([{ photo: stored }], new Set())).toEqual([
      { photo: QUESTION_FILE_WITHHELD },
    ]);
  });

  test("finds only the ledger's keys, however the rows spell them", () => {
    const found = questionFileKeysIn([{ a: key.toUpperCase(), b: randomUUID() }], ledger);
    expect([...found]).toEqual([...ledger.keys]);
  });

  test("reads the ledger in every state", () => {
    const { desk, keys } = photosDesk();
    expect(new Set(readFileLedgerKeys(desk.database.readonly))).toEqual(new Set(keys));
  });
});

describe("the catalog", () => {
  test("describes a file column by its kind, type, size and name, and never by a key", () => {
    const { desk } = photosDesk();
    const prompt = nextPrompt(QUESTION, registeredSpecs(desk.database.readwrite), []);
    const lines = prompt.split("\n");
    const at = lines.findIndex((line) => line.startsWith(`    - ${PHOTO_FIELD.name}:`));
    const described = lines.slice(at, at + 2).join("\n");

    for (const family of PHOTO_FIELD.accepts ?? []) expect(described).toContain(family);
    for (const part of ["kind", "mime", "size", "name"]) expect(described).toContain(part);
    expect(described).not.toMatch(/\bkey\b/i);
  });

  test("is read through views that list every column its spec knows, inactive ones too", () => {
    const { desk } = photosDesk();
    const shadow = catalogShadow(readActiveRegistryCatalog(desk.database.readonly));
    expect(shadow.tables).toEqual([
      {
        table: TABLE,
        columns: [
          { name: "id", reading: "value" },
          { name: "created_at", reading: "value" },
          { name: "extra", reading: "text" },
          { name: "caption", reading: "text" },
          { name: PHOTO_FIELD.name, reading: "file" },
          { name: OLD_PHOTO.name, reading: "file" },
        ],
      },
    ]);
  });
});
