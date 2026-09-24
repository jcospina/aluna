// The file ledger's table: every column PLAN decision 21 names, the two indexes that answer "the
// keys this record holds" and "the keys this incarnation owns", and the states a row can be in.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { FIRST_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../persistence/scratch-db.test-support.ts";
import { seedFileLedgerRow } from "./ledger.test-support.ts";
import {
  enqueueDisplacedFile,
  enqueueRecordFiles,
  FILE_LEDGER_TABLE,
  isFileKey,
  mintFileKey,
  promotePendingFile,
  readFileLedgerRow,
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
  test("holds every column the ledger names", () => {
    const columns = pragma(`PRAGMA table_info(${FILE_LEDGER_TABLE})`).map((column) => column.name);
    expect(columns).toEqual([
      "key",
      "capability_id",
      "incarnation_id",
      "field",
      "record_id",
      "state",
      "kind",
      "mime",
      "size",
      "name",
      "encoding",
      "created_at",
      "cleanup_attempts",
      "cleanup_error",
    ]);
  });

  test("is indexed by record and by incarnation", () => {
    const indexed = pragma(`PRAGMA index_list(${FILE_LEDGER_TABLE})`)
      .filter((index) => index.origin === "c")
      .map((index) => pragma(`PRAGMA index_info(${String(index.name)})`).map((c) => c.name));
    expect(indexed.sort()).toEqual([["incarnation_id"], ["record_id"]]);
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
    expect(readFileLedgerRow(env.conns.readwrite, key)?.created_at).toBeTruthy();
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

describe("a file key", () => {
  test("is minted in the one shape it is checked for", () => {
    const key = mintFileKey();
    expect(isFileKey(key)).toBe(true);
    for (const value of [key.toUpperCase(), ` ${key}`, `${key}.jpg`, "", 7, null]) {
      expect(isFileKey(value)).toBe(false);
    }
  });
});
