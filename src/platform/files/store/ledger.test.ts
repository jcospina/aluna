// The file ledger's table: the two indexes that answer "the keys this record holds" and "the keys
// this incarnation owns", the states a row can be in, and the queue the cleanup worker drains.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { FIRST_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../persistence/scratch-db.test-support.ts";
import { seedFileLedgerRow } from "./ledger.test-support.ts";
import {
  deleteCleanedFile,
  ENQUEUED_FILES_SQL,
  enqueueDisplacedFile,
  enqueuePendingFile,
  enqueueRecordFiles,
  FILE_LEDGER_TABLE,
  insertPendingFile,
  isFileKey,
  mintFileKey,
  promotePendingFile,
  readEnqueuedFiles,
  readFileLedgerRow,
  reassignRecordFiles,
  recordFileCleanupFailure,
} from "./ledger.ts";

let env: ScratchDbEnv;

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-file-ledger-");
});

afterEach(() => teardownScratchDbEnv(env));

function pragma(statement: string): Record<string, unknown>[] {
  return env.conns.readwrite.query(statement).all() as Record<string, unknown>[];
}

function seed(overrides: Partial<Parameters<typeof seedFileLedgerRow>[1]> = {}): string {
  return seedFileLedgerRow(env.conns.readwrite, {
    capabilityId: "photos",
    incarnationId: FIRST_INCARNATION_ID,
    field: "photo",
    ...overrides,
  });
}

describe("the file ledger table", () => {
  test("is indexed by record and by incarnation, and its cleanup queue by its enqueued keys", () => {
    const indexes = pragma(`PRAGMA index_list(${FILE_LEDGER_TABLE})`).filter(
      (index) => index.origin === "c",
    );
    const indexed = indexes.map((index) =>
      pragma(`PRAGMA index_info(${String(index.name)})`).map((c) => c.name),
    );
    expect(indexed.sort()).toEqual([["incarnation_id"], ["key"], ["record_id"]]);
    expect(indexes.filter((index) => index.partial === 1)).toHaveLength(1);
    const plan = pragma(`EXPLAIN QUERY PLAN ${ENQUEUED_FILES_SQL}`);
    expect(plan.map((step) => String(step.detail)).join(" ")).toContain(
      `INDEX ${FILE_LEDGER_TABLE}_cleanup`,
    );
  });

  test("a fresh row is pending, unclaimed, stamped, and has no cleanup history", () => {
    const key = seed({ encoding: "utf-8" });
    expect(readFileLedgerRow(env.conns.readwrite, key)).toMatchObject({
      key,
      state: "pending",
      record_id: null,
      encoding: "utf-8",
      cleanup_attempts: 0,
      cleanup_error: null,
    });
    expect(Date.parse(readFileLedgerRow(env.conns.readwrite, key)?.created_at ?? "")).not.toBeNaN();
  });

  test("refuses a state outside the three, and a record that disagrees with its state", () => {
    expect(() => seed({ state: "archived" as "pending" })).toThrow();
    expect(() => seed({ state: "pending", recordId: "r" })).toThrow();
    expect(() => seed({ state: "owned", recordId: null })).toThrow();
    expect(() => seed({ size: -1 })).toThrow();
    expect(() => seed({ size: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => seed({ mime: "" })).toThrow();
    expect(() => seed({ state: "cleanup_enqueued", recordId: "r" })).not.toThrow();
    expect(() => seed({ state: "cleanup_enqueued" })).not.toThrow();
  });

  test("promotes a pending key once, and never one in any other state", () => {
    const key = seed();
    expect(promotePendingFile(env.conns.readwrite, key, "record-1")).toBe(true);
    expect(promotePendingFile(env.conns.readwrite, key, "record-2")).toBe(false);
    expect(readFileLedgerRow(env.conns.readwrite, key)).toMatchObject({
      state: "owned",
      record_id: "record-1",
    });
    const swept = seed({ state: "cleanup_enqueued" });
    expect(promotePendingFile(env.conns.readwrite, swept, "record-3")).toBe(false);
  });
});

describe("giving up a key", () => {
  const owner = { capabilityId: "photos", incarnationId: FIRST_INCARNATION_ID };
  const stateOf = (key: string) => readFileLedgerRow(env.conns.readwrite, key)?.state;

  test("a displaced key goes only from the field and record that own it", () => {
    const held = seed({ state: "owned", recordId: "record-1" });
    const cover = seed({ state: "owned", recordId: "record-1", field: "cover" });
    const theirs = seed({ state: "owned", recordId: "record-2" });
    const elsewhere = seed({ state: "owned", recordId: "record-1", incarnationId: "another" });
    const pending = seed();
    const displaced = { ...owner, field: "photo", recordId: "record-1" };

    for (const key of [cover, theirs, elsewhere, pending]) {
      expect(enqueueDisplacedFile(env.conns.readwrite, displaced, key)).toBe(false);
    }
    expect(enqueueDisplacedFile(env.conns.readwrite, displaced, held)).toBe(true);
    expect(enqueueDisplacedFile(env.conns.readwrite, displaced, held)).toBe(false);
    expect([held, cover, theirs, elsewhere, pending].map(stateOf)).toEqual([
      "cleanup_enqueued",
      "owned",
      "owned",
      "owned",
      "pending",
    ]);
  });

  test("a deleted record gives up every key it owns in this incarnation, and nothing else", () => {
    const held = seed({ state: "owned", recordId: "record-1" });
    const cover = seed({ state: "owned", recordId: "record-1", field: "cover" });
    const theirs = seed({ state: "owned", recordId: "record-2" });
    const elsewhere = seed({ state: "owned", recordId: "record-1", incarnationId: "another" });
    const pending = seed();

    enqueueRecordFiles(env.conns.readwrite, owner, "record-1");

    expect([held, cover, theirs, elsewhere, pending].map(stateOf)).toEqual([
      "cleanup_enqueued",
      "cleanup_enqueued",
      "owned",
      "owned",
      "pending",
    ]);
  });
});

describe("the cleanup queue", () => {
  test("holds only enqueued keys, with what their failures cost", () => {
    const [first, owned, second] = [
      seed({ state: "cleanup_enqueued" }),
      seed({ state: "owned" }),
      seed({ state: "cleanup_enqueued" }),
    ];
    recordFileCleanupFailure(env.conns.readwrite, second, "held open");
    recordFileCleanupFailure(env.conns.readwrite, owned, "never enqueued");

    const queue = readEnqueuedFiles(env.conns.readwrite);
    expect(queue.sort((a, b) => a.key.localeCompare(b.key))).toEqual(
      [
        { key: first, attempts: 0 },
        { key: second, attempts: 1 },
      ].sort((a, b) => a.key.localeCompare(b.key)),
    );
    expect(readFileLedgerRow(env.conns.readwrite, second)?.cleanup_error).toBe("held open");
    expect(readFileLedgerRow(env.conns.readwrite, owned)?.cleanup_attempts).toBe(0);
  });

  test("lets go of an enqueued row once its bytes are gone, and of no other", () => {
    const [enqueued, owned] = [seed({ state: "cleanup_enqueued" }), seed({ state: "owned" })];
    deleteCleanedFile(env.conns.readwrite, enqueued);
    deleteCleanedFile(env.conns.readwrite, enqueued);
    deleteCleanedFile(env.conns.readwrite, owned);
    expect(readFileLedgerRow(env.conns.readwrite, enqueued)).toBeNull();
    expect(readFileLedgerRow(env.conns.readwrite, owned)?.state).toBe("owned");
  });
});

describe("a record whose id changes", () => {
  test("takes every key it owns in this incarnation with it, and nothing else", () => {
    const owner = { capabilityId: "photos", incarnationId: FIRST_INCARNATION_ID };
    const held = seed({ state: "owned", recordId: "record-1" });
    const cover = seed({ state: "owned", recordId: "record-1", field: "cover" });
    const theirs = seed({ state: "owned", recordId: "record-2" });
    const elsewhere = seed({ state: "owned", recordId: "record-1", incarnationId: "another" });
    const given = seed({ state: "cleanup_enqueued", recordId: "record-1" });
    const recordOf = (key: string) => readFileLedgerRow(env.conns.readwrite, key)?.record_id;

    reassignRecordFiles(env.conns.readwrite, owner, "record-1", "renamed");

    expect([held, cover, theirs, elsewhere, given].map(recordOf)).toEqual([
      "renamed",
      "renamed",
      "record-2",
      "record-1",
      "record-1",
    ]);
  });
});

describe("an admitted upload's row", () => {
  const admitted = (key: string) => ({
    key,
    capability_id: "photos",
    incarnation_id: FIRST_INCARNATION_ID,
    field: "photo",
    kind: "image",
    mime: "image/png",
    size: 5000,
    name: "tide.png",
  });

  test("goes in pending, with no record and exactly what admission verified", () => {
    const key = mintFileKey();
    insertPendingFile(env.conns.readwrite, admitted(key));
    expect(readFileLedgerRow(env.conns.readwrite, key)).toMatchObject({
      ...admitted(key),
      record_id: null,
      state: "pending",
      encoding: null,
    });
    expect(() => insertPendingFile(env.conns.readwrite, admitted(key))).toThrow();
  });

  test("an unanswered key goes to cleanup once, and a claimed one never does", () => {
    const unanswered = seed();
    expect(enqueuePendingFile(env.conns.readwrite, unanswered)).toBe(true);
    expect(enqueuePendingFile(env.conns.readwrite, unanswered)).toBe(false);
    expect(readFileLedgerRow(env.conns.readwrite, unanswered)?.state).toBe("cleanup_enqueued");

    const owned = seed({ state: "owned" });
    expect(enqueuePendingFile(env.conns.readwrite, owned)).toBe(false);
    expect(readFileLedgerRow(env.conns.readwrite, owned)?.state).toBe("owned");
    expect(enqueuePendingFile(env.conns.readwrite, mintFileKey())).toBe(false);
  });
});

describe("a file key", () => {
  test("is minted in the one shape it is checked for", () => {
    const key = mintFileKey();
    expect(isFileKey(key)).toBe(true);
    for (const value of [key.toUpperCase(), ` ${key}`, `${key}.jpg`, "", 7, null]) {
      expect(isFileKey(value)).toBe(false);
    }
  });
});
