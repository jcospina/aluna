// The thread is copied beside the bundle and run directly, so it may import nothing
// (`scripts/build.ts`) and keeps its own copies of two things the main thread's scope also holds:
// which SQLite failures are the statement's, and what counts as a literal or a comment. These run
// both ends over the same inputs, so a copy that drifts splits one read's two ends here.

import { Database, SQLiteError } from "bun:sqlite";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { validSpec } from "../../registry/spec/spec.test-support.ts";
import { NO_SHADOW } from "./query-worker.test-support.ts";
import type {
  QueryWorkerFault,
  QueryWorkerRequest,
  QueryWorkerResponse,
} from "./query-worker-thread.ts";
import {
  assertWholeCatalogQuery,
  WholeCatalogQueryStatementError,
} from "./whole-catalog-query-scope.ts";

type Handler = (event: { data: QueryWorkerRequest }) => void;

let threadHandler: Handler | undefined;

/** The thread's own message handler, run in this process so a failure can be handed to it. */
async function thread(): Promise<(request: QueryWorkerRequest) => QueryWorkerResponse> {
  const globals = globalThis as { onmessage?: unknown; postMessage?: unknown };
  if (threadHandler === undefined) {
    const previous = globals.onmessage;
    await import("./query-worker-thread.ts");
    threadHandler = globals.onmessage as Handler;
    globals.onmessage = previous;
  }
  const handler = threadHandler;
  return (request) => {
    const posted: QueryWorkerResponse[] = [];
    const previous = globals.postMessage;
    globals.postMessage = (message: QueryWorkerResponse) => posted.push(message);
    try {
      handler({ data: request });
    } finally {
      globals.postMessage = previous;
    }
    const [answer] = posted;
    if (answer === undefined) throw new Error("the thread answered nothing");
    return answer;
  };
}

/** A real SQLite failure reporting `errno`: only bun:sqlite may construct one. */
function failureWith(errno: number): SQLiteError {
  try {
    new Database(":memory:").prepare("SELEC");
  } catch (error) {
    if (!(error instanceof SQLiteError)) throw error;
    // Its own `errno` is read-only, so the real failure stands behind one that reports `errno`.
    return Object.create(error, { errno: { value: errno } });
  }
  throw new Error("a malformed statement compiled");
}

/** What the main thread's scope makes of the same failure from its own `EXPLAIN`. */
function scopeFault(failure: SQLiteError): QueryWorkerFault {
  const database = {
    prepare: () => {
      throw failure;
    },
  };
  try {
    assertWholeCatalogQuery(database as never, [validSpec()], "SELECT 1", []);
  } catch (error) {
    return error instanceof WholeCatalogQueryStatementError ? "statement" : "connection";
  }
  throw new Error("a statement whose EXPLAIN failed was admitted");
}

const directories: string[] = [];
const connections: Database[] = [];

afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** Opens the thread on a scratch file, keeping the connection it made so it can be closed. */
function openedThread(send: (request: QueryWorkerRequest) => QueryWorkerResponse): void {
  const directory = mkdtempSync(join(tmpdir(), "omni-crud-query-thread-"));
  directories.push(directory);
  const path = join(directory, "test.db");
  new Database(path).close();
  const attach = spyOn(Database.prototype, "run");
  try {
    expect(send({ kind: "open", id: 1, path, shadow: NO_SHADOW }).kind).toBe("opened");
    connections.push(...(attach.mock.contexts as Database[]));
  } finally {
    attach.mockRestore();
  }
}

/** Every primary result code SQLite defines, and extended ones built on the statement's own. */
const RESULT_CODES = [
  ...Array.from({ length: 29 }, (_, code) => code),
  100,
  101,
  264,
  275,
  1299,
  2067,
];

describe("the thread and the scope agree on whose failure it is", () => {
  test("every SQLite result code is the statement's on both ends, or the connection's on both", async () => {
    const send = await thread();
    openedThread(send);

    for (const errno of RESULT_CODES) {
      const failure = failureWith(errno);
      const prepare = spyOn(Database.prototype, "prepare").mockImplementation(
        () =>
          ({
            all: () => {
              throw failure;
            },
            finalize: () => {},
          }) as never,
      );
      let answer: QueryWorkerResponse;
      try {
        answer = send({ kind: "read", id: 2, sql: "SELECT 1", parameters: [] });
      } finally {
        prepare.mockRestore();
      }

      expect({ errno, thread: answer.kind === "failed" ? answer.fault : answer.kind }).toEqual({
        errno,
        thread: scopeFault(failure),
      });
    }
  });
});

/** What may sit inside a literal or a comment: every character that would end one early. */
const inside = fc.string({
  unit: fc.constantFrom(";", "'", '"', "`", "*", "/", "-", "\n", " ", "a", "ATTACH ", "PRAGMA "),
  minLength: 1,
  maxLength: 12,
});

function quoted(mark: string, text: string): string {
  return `${mark}${text.replaceAll(mark, mark + mark)}${mark}`;
}

function blockComment(text: string): string {
  let body = text;
  while (body.includes("*/")) body = body.replaceAll("*/", "");
  return `/*${body}*/`;
}

describe("the thread and the scope agree on what is data", () => {
  test("a `;` or a keyword inside a literal is one read's data to the thread", async () => {
    const send = await thread();
    openedThread(send);

    fc.assert(
      fc.property(inside, (text) => {
        for (const [sql, row] of [
          [`SELECT ${quoted("'", text)} AS v`, { v: text }],
          [`SELECT 1 AS ${quoted('"', text)}`, { [text]: 1 }],
          [`SELECT 1 AS ${quoted("`", text)}`, { [text]: 1 }],
          [`--${text.replaceAll("\n", "")}\nSELECT 1 AS v`, { v: 1 }],
          [`${blockComment(text)} SELECT 1 AS v`, { v: 1 }],
        ] as const) {
          expect({ sql, answer: send({ kind: "read", id: 3, sql, parameters: [] }) }).toEqual({
            sql,
            answer: { kind: "rows", id: 3, rows: [row] },
          });
        }
      }),
      { seed: 20260926, numRuns: 300 },
    );
  });

  test("two comments hide nothing that stands between them from the thread", async () => {
    const send = await thread();
    openedThread(send);

    fc.assert(
      fc.property(inside, inside, (before, after) => {
        const [opening, closing] = [blockComment(before), blockComment(after)];
        for (const sql of [
          `${opening} PRAGMA user_version ${closing}`,
          `SELECT 1 ${opening}; SELECT 2 ${closing}`,
        ]) {
          const answer = send({ kind: "read", id: 4, sql, parameters: [] });
          expect({ sql, answer: answer.kind === "failed" ? answer.fault : answer }).toEqual({
            sql,
            answer: "statement",
          });
        }
      }),
      { seed: 20260926, numRuns: 300 },
    );
  });

  test("and a comment in front of a write is no disguise from the scope", () => {
    const untouched = {
      prepare: () => {
        throw new Error("a write was planned instead of passed to the SQLite seam");
      },
    };

    fc.assert(
      fc.property(inside, (text) => {
        for (const comment of [`--${text.replaceAll("\n", "")}\n`, blockComment(text)]) {
          const sql = `${comment} INSERT INTO widget (name) VALUES ('x')`;
          expect(assertWholeCatalogQuery(untouched as never, [], sql, []).collections).toEqual([]);
        }
      }),
      { seed: 20260926, numRuns: 300 },
    );
  });

  test("nor a write between two comments", () => {
    const untouched = {
      prepare: () => {
        throw new Error("a write was planned instead of passed to the SQLite seam");
      },
    };

    fc.assert(
      fc.property(inside, inside, (before, after) => {
        const sql = `${blockComment(before)} INSERT INTO widget (name) VALUES ('x') ${blockComment(after)}`;
        expect(assertWholeCatalogQuery(untouched as never, [], sql, []).collections).toEqual([]);
      }),
      { seed: 20260926, numRuns: 300 },
    );
  });
});
