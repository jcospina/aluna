import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createApp } from "../app/app.ts";
import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import { createReadGateCoordinator, ReadGateReleasedError } from "../read-gates/index.ts";
import type { ReadDependencies } from "../registry/index.ts";
import type { CapabilityContext, CapabilityHandler } from "./contract.ts";
import {
  formBody,
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "./router.test-support.ts";
import type { HandlerLoader } from "./router.ts";

const SHELVES_INCARNATION = "22222222-2222-4222-8222-222222222222";
const TASKS_INCARNATION = "33333333-3333-4333-8333-333333333333";
const ACTIONS = ["create", "read", "update", "delete", "search"] as const;
type TestAction = (typeof ACTIONS)[number];
const ACTION_INCARNATIONS: Record<TestAction, string> = {
  create: "44444444-4444-4444-8444-444444444444",
  read: "55555555-5555-4555-8555-555555555555",
  update: "66666666-6666-4666-8666-666666666666",
  delete: "77777777-7777-4777-8777-777777777777",
  search: "88888888-8888-4888-8888-888888888888",
};

function shelvesRow() {
  return notesRow({
    id: "shelves",
    label: "Shelves",
    incarnation_id: SHELVES_INCARNATION,
    prompt_context: "Stores shelf names.",
  });
}

function tasksRow() {
  return notesRow({
    id: "tasks",
    label: "Tasks",
    incarnation_id: TASKS_INCARNATION,
    prompt_context: "Stores tasks.",
  });
}

function notesReadingShelves(
  action: TestAction = "read",
  id = "notes",
  incarnationId = notesRow().incarnation_id,
) {
  const dependency = { capability_id: "shelves", incarnation_id: SHELVES_INCARNATION };
  const readDependencies: ReadDependencies = {
    create: [],
    read: [],
    update: [],
    delete: [],
    search: [],
  };
  readDependencies[action] = [dependency];
  return notesRow({
    id,
    incarnation_id: incarnationId,
    label: id,
    read_dependencies: readDependencies,
  });
}

function actionRequest(
  action: TestAction,
  capabilityId = "notes",
): readonly [string, RequestInit?] {
  const path = `/capability/${capabilityId}/${action}`;
  if (action === "create") return [path, formBody({ text: "Held" })];
  if (action === "update") {
    return [path, formBody({ __aluna_record_id: "record-1", text: "Held" }, ["text"])];
  }
  if (action === "delete") {
    return [path, formBody({ __aluna_record_id: "record-1" }, [])];
  }
  return [path];
}

function mutationErrorRegion(action: "create" | "update" | "delete"): string {
  return action === "update" ? "edit" : action;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function readLoader(body: (context: CapabilityContext) => Promise<string>): HandlerLoader {
  return async () => body as CapabilityHandler;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one shared database harness covers the complete five-Action ownership matrix.
describe("capability router read-gate ownership", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("one captured Action catalog holds target and declared dependency until the Handler settles", async () => {
    install(conns, shelvesRow());
    install(conns, notesReadingShelves());
    const readGates = createReadGateCoordinator();
    const entered = deferred();
    const finish = deferred();
    const app = createApp({
      readGates,
      capabilityRouter: {
        databases: conns,
        loadHandler: readLoader(async () => {
          entered.resolve();
          await finish.promise;
          return "<p>joined read complete</p>";
        }),
        loadItemRenderer: async () => () => "<span>item</span>",
      },
    });

    const request = app.request("/capability/notes/read");
    await entered.promise;
    expect(readGates.snapshot()).toEqual([
      {
        capabilityId: "notes",
        incarnationId: notesRow().incarnation_id,
        state: "active",
        readerCount: 1,
      },
      {
        capabilityId: "shelves",
        incarnationId: SHELVES_INCARNATION,
        state: "active",
        readerCount: 1,
      },
    ]);

    const draining = readGates.closeAndDrain({
      capabilityId: "shelves",
      incarnationId: SHELVES_INCARNATION,
    });
    finish.resolve();
    expect((await request).status).toBe(409);
    const closing = await draining;
    expect(readGates.snapshot().every(({ readerCount }) => readerCount === 0)).toBe(true);
    expect(readGates.reopen(closing)).toBe(true);
  });

  test("one closing dependency refuses the whole set before generated code begins", async () => {
    install(conns, shelvesRow());
    install(conns, notesReadingShelves());
    install(conns, tasksRow());
    const readGates = createReadGateCoordinator();
    readGates.synchronizeCatalog([
      { capabilityId: "notes", incarnationId: notesRow().incarnation_id },
      { capabilityId: "shelves", incarnationId: SHELVES_INCARNATION },
      { capabilityId: "tasks", incarnationId: TASKS_INCARNATION },
    ]);
    const closing = await readGates.closeAndDrain({
      capabilityId: "shelves",
      incarnationId: SHELVES_INCARNATION,
    });
    let handlerLoads = 0;
    const app = createApp({
      readGates,
      capabilityRouter: {
        databases: conns,
        loadHandler: async () => {
          handlerLoads += 1;
          return async () => "<p>unrelated read</p>";
        },
        loadItemRenderer: async () => () => "<span>item</span>",
      },
    });

    const refused = await app.request("/capability/notes/read");
    expect(refused.status).toBe(409);
    expect(await refused.text()).not.toMatch(/gate|token|incarnation|dependency/i);
    expect(handlerLoads).toBe(0);
    expect(readGates.snapshot().find(({ capabilityId }) => capabilityId === "notes")).toMatchObject(
      {
        readerCount: 0,
      },
    );

    expect((await app.request("/capability/tasks/read")).status).toBe(200);
    expect(handlerLoads).toBe(1);
    expect(readGates.reopen(closing)).toBe(true);
  });

  test("all five Actions hold their complete target and dependency set through Handler settlement", async () => {
    install(conns, shelvesRow());
    for (const action of ACTIONS) {
      const capabilityId = `notes_${action}`;
      const incarnationId = ACTION_INCARNATIONS[action];
      install(conns, notesReadingShelves(action, capabilityId, incarnationId));
      const readGates = createReadGateCoordinator();
      const entered = deferred();
      const finish = deferred();
      const app = createApp({
        readGates,
        capabilityRouter: {
          databases: conns,
          loadHandler: readLoader(async () => {
            entered.resolve();
            await finish.promise;
            return `<p>${action} complete</p>`;
          }),
          loadItemRenderer: async () => () => "<span>item</span>",
        },
      });

      const [path, init] = actionRequest(action, capabilityId);
      const request = app.request(path, init);
      await entered.promise;
      expect(readGates.snapshot().filter(({ readerCount }) => readerCount > 0)).toEqual([
        {
          capabilityId,
          incarnationId,
          state: "active",
          readerCount: 1,
        },
        {
          capabilityId: "shelves",
          incarnationId: SHELVES_INCARNATION,
          state: "active",
          readerCount: 1,
        },
      ]);
      finish.resolve();
      expect((await request).status).toBe(200);
      expect(readGates.snapshot().every(({ readerCount }) => readerCount === 0)).toBe(true);
    }
  });

  test("all five Actions refuse atomically before generated code and mutation refusals retarget", async () => {
    install(conns, shelvesRow());
    for (const action of ACTIONS) {
      const capabilityId = `notes_${action}`;
      const incarnationId = ACTION_INCARNATIONS[action];
      install(conns, notesReadingShelves(action, capabilityId, incarnationId));
      const readGates = createReadGateCoordinator();
      readGates.synchronizeCatalog([
        { capabilityId, incarnationId },
        { capabilityId: "shelves", incarnationId: SHELVES_INCARNATION },
      ]);
      const closing = await readGates.closeAndDrain({
        capabilityId: "shelves",
        incarnationId: SHELVES_INCARNATION,
      });
      let handlerLoads = 0;
      const app = createApp({
        readGates,
        capabilityRouter: {
          databases: conns,
          loadHandler: async () => {
            handlerLoads += 1;
            return async () => "<p>must not run</p>";
          },
        },
      });

      const [path, init] = actionRequest(action, capabilityId);
      const response = await app.request(path, init);
      if (action === "create" || action === "update" || action === "delete") {
        expect(response.status).toBe(422);
        expect(response.headers.get("HX-Retarget")).toBe(
          `#${capabilityId}-${mutationErrorRegion(action)}-error`,
        );
        expect(response.headers.get("HX-Reswap")).toBe("innerHTML");
        expect(await response.text()).toContain('data-error-code="read_unavailable"');
      } else {
        expect(response.status).toBe(409);
      }
      expect(handlerLoads).toBe(0);
      expect(
        readGates.snapshot().find((entry) => entry.capabilityId === capabilityId),
      ).toMatchObject({ readerCount: 0 });
      expect(readGates.reopen(closing)).toBe(true);
    }
  });

  test("a close-signalled route observes cancellation through its query boundary", async () => {
    install(conns, notesRow());
    const readGates = createReadGateCoordinator();
    const entered = deferred();
    const continueHandler = deferred();
    const app = createApp({
      readGates,
      capabilityRouter: {
        databases: conns,
        loadHandler: readLoader(async ({ query }) => {
          entered.resolve();
          await continueHandler.promise;
          query.all({ sql: "SELECT 1 AS value", result: [{ alias: "value", type: "number" }] });
          return "<p>must not complete</p>";
        }),
        loadItemRenderer: async () => () => "<span>item</span>",
      },
    });

    const request = app.request("/capability/notes/read");
    await entered.promise;
    const draining = readGates.closeAndDrain({
      capabilityId: "notes",
      incarnationId: notesRow().incarnation_id,
    });
    continueHandler.resolve();
    expect((await request).status).toBe(409);
    const closing = await draining;
    expect(readGates.snapshot()[0]).toMatchObject({ state: "closing", readerCount: 0 });
    expect(readGates.reopen(closing)).toBe(true);
  });
});

describe("capability route read-gate finally boundaries", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("Handler failure and direct-View refusal both preserve exact reader counts", async () => {
    install(conns, notesRow());
    const readGates = createReadGateCoordinator();
    const app = createApp({
      readGates,
      capabilityRouter: {
        databases: conns,
        loadHandler: readLoader(async () => {
          throw new Error("failed read");
        }),
        loadItemRenderer: async () => () => "<span>item</span>",
      },
    });

    expect((await app.request("/capability/notes/read")).status).toBe(500);
    expect(readGates.snapshot()[0]?.readerCount).toBe(0);
    const closing = await readGates.closeAndDrain({
      capabilityId: "notes",
      incarnationId: notesRow().incarnation_id,
    });
    expect((await app.request("/capability/notes")).status).toBe(409);
    expect(readGates.snapshot()[0]).toMatchObject({ state: "closing", readerCount: 0 });
    expect(readGates.reopen(closing)).toBe(true);
  });

  test("a record mutation holds its read token and write lease through the full transaction", async () => {
    install(conns, notesRow());
    const readGates = createReadGateCoordinator();
    const mutationCoordinator = createMutationCoordinator();
    const entered = deferred();
    const finish = deferred();
    const app = createApp({
      readGates,
      mutationCoordinator,
      capabilityRouter: {
        databases: conns,
        loadHandler: readLoader(async () => {
          entered.resolve();
          await finish.promise;
          return "<p>created</p>";
        }),
        loadItemRenderer: async () => () => "<span>item</span>",
      },
    });

    const request = app.request("/capability/notes/create", formBody({ text: "Held" }));
    await entered.promise;
    expect(readGates.snapshot()[0]?.readerCount).toBe(1);
    expect(mutationCoordinator.snapshot().activeLease?.kind).toBe("record");
    finish.resolve();
    expect((await request).status).toBe(200);
    expect(readGates.snapshot()[0]?.readerCount).toBe(0);
    expect(mutationCoordinator.snapshot().activeLease).toBeNull();
  });

  test("a retained query port loses ownership as soon as its route settles", async () => {
    install(conns, notesRow());
    let retainedQuery: CapabilityContext["query"] | undefined;
    const app = createApp({
      capabilityRouter: {
        databases: conns,
        loadHandler: readLoader(async ({ query }) => {
          retainedQuery = query;
          return "<p>done</p>";
        }),
        loadItemRenderer: async () => () => "<span>item</span>",
      },
    });

    expect((await app.request("/capability/notes/read")).status).toBe(200);
    expect(retainedQuery).toBeDefined();
    expect(() =>
      retainedQuery?.all({
        sql: "SELECT 1 AS value",
        result: [{ alias: "value", type: "number" }],
      }),
    ).toThrow(ReadGateReleasedError);
  });
});
