// The link step's relations are checked again as the activation writes them: a target in a
// lifetime the step did not read is dropped, a loop the answer would close is refused, and a write
// that fails is undone alone while the activation goes on.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../platform/persistence/scratch-db.test-support.ts";
import {
  FIFTH_INCARNATION_ID,
  SEVENTH_INCARNATION_ID,
  SIXTH_INCARNATION_ID,
} from "../../registry/incarnations.test-support.ts";
import { getCapability, type Relation } from "../../registry/index.ts";
import * as store from "../../registry/store/store.ts";
import { install } from "../../runtime/router/dispatch/router.test-support.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS,
  BOOKS_INCARNATION,
  deskRow,
  MEMOS,
  textField,
} from "../../server/routes/lifecycle/link.test-support.ts";
import { admittedRelations, writeLinkStepRelations } from "./link-relations.ts";

let env: ScratchDbEnv;

const subjectTo = (field: string, incarnation: string): Relation => ({
  field: "subject",
  to: { capability: BOOKS.id, incarnation, field },
});

/** Runs `work` inside an open write transaction, the way an activation holds one. */
function inActivation<T>(database: Database, work: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    return work();
  } finally {
    if (database.inTransaction) database.exec("COMMIT");
  }
}

describe("the link step's relations at activation", () => {
  beforeEach(() => {
    env = createScratchDbEnv("omni-crud-link-step-write-");
    install(env.conns, deskRow(AUTHORS));
    install(env.conns, deskRow(BOOKS));
    install(env.conns, deskRow(MEMOS));
  });

  afterEach(() => {
    teardownScratchDbEnv(env);
  });

  test("a relation pinned to a lifetime its target no longer has is dropped", () => {
    // Books in Authors' lifetime: one field Books has, one only the capability of that lifetime has.
    const written = inActivation(env.conns.readwrite, () =>
      writeLinkStepRelations(env.conns.readwrite, deskRow(MEMOS), [
        subjectTo("author", AUTHORS_INCARNATION),
        subjectTo("name", AUTHORS_INCARNATION),
        subjectTo("title", BOOKS_INCARNATION),
      ]),
    );

    expect(written.relations).toStrictEqual([subjectTo("title", BOOKS_INCARNATION)]);
    expect(getCapability(MEMOS.id, env.conns.readonly)).toStrictEqual(written);
  });

  test("a relation closing a loop through one the same answer admitted is dropped", () => {
    const capability = (id: string, incarnation: string, ...names: readonly string[]) =>
      deskRow({
        id,
        label: id,
        noun: id,
        plural: id,
        incarnation,
        fields: names.map((name) => textField(name, name)),
      });
    const source = capability("loans", FIFTH_INCARNATION_ID, "a", "b");
    const toSource = (field: string) => ({
      field: "f",
      to: { capability: "loans", incarnation: FIFTH_INCARNATION_ID, field },
    });
    const pointsAtB = { ...capability("x", SIXTH_INCARNATION_ID, "f"), relations: [toSource("b")] };
    const pointsAtA = {
      ...capability("y", SEVENTH_INCARNATION_ID, "f"),
      relations: [toSource("a")],
    };

    const admitted = admittedRelations(
      source,
      [
        { field: "b", target: pointsAtA, targetField: "f" },
        { field: "a", target: pointsAtB, targetField: "f" },
      ],
      [source, pointsAtB, pointsAtA],
    );

    expect(admitted.map(({ field }) => field)).toStrictEqual(["b"]);
  });

  test("a write that fails is undone alone, and the activation's transaction goes on", () => {
    const database = env.conns.readwrite;
    const failing = spyOn(store, "writeCapabilityRelations").mockImplementation(() => {
      throw new Error("disk hiccup");
    });
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    try {
      inActivation(database, () => {
        const relations = [subjectTo("title", BOOKS_INCARNATION)];
        const written = writeLinkStepRelations(database, deskRow(MEMOS), relations);
        expect(written.relations).toStrictEqual([]);
        expect(database.inTransaction).toBe(true);
      });
    } finally {
      failing.mockRestore();
      quiet.mockRestore();
    }
    expect(getCapability(MEMOS.id, env.conns.readonly)?.relations).toStrictEqual([]);
  });

  test("an error after which SQLite has ended the activation's transaction ends the activation", () => {
    const database = env.conns.readwrite;
    const ending = spyOn(store, "writeCapabilityRelations").mockImplementation(() => {
      database.exec("ROLLBACK");
      throw new Error("database or disk is full");
    });
    try {
      inActivation(database, () => {
        const relations = [subjectTo("title", BOOKS_INCARNATION)];
        expect(() => writeLinkStepRelations(database, deskRow(MEMOS), relations)).toThrow();
        expect(database.inTransaction).toBe(false);
      });
    } finally {
      ending.mockRestore();
    }
  });
});
