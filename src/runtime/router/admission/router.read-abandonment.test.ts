import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createApp } from "../../../app/app.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { createReadGateCoordinator } from "../../concurrency/read-gates.ts";
import type { CapabilityContext, CapabilityHandler } from "../contract.ts";
import {
  formBody,
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../dispatch/router.test-support.ts";
import type { HandlerLoader } from "../dispatch/router.ts";

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

describe("a read is abandoned when its reader goes away", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  // The server half of the content region's release rule. The browser aborts the request
  // when the region's content is replaced or the region is put away; the read token has
  // to come back then, not at whatever the handler deadline happens to be — otherwise a
  // deletion drain waits on a reader who has already navigated away.
  test("the read token comes back at the abort, not at the handler deadline", async () => {
    install(conns, notesRow());
    const readGates = createReadGateCoordinator();
    const entered = deferred();
    const handlerTimeoutMs = 30_000;
    const app = createApp({
      capabilityRouter: {
        databases: conns,
        readGates,
        handlerTimeoutMs,
        loadItemRenderer: async () => () => "<li></li>",
        loadHandler: readLoader(() => {
          entered.resolve();
          return new Promise<string>(() => undefined);
        }),
      },
    });

    const client = new AbortController();
    const request = app.request("/capability/notes/read", { signal: client.signal });
    await entered.promise;
    expect(readGates.snapshot()).toMatchObject([{ capabilityId: "notes", readerCount: 1 }]);

    const startedAt = Date.now();
    client.abort();
    const response = await request;

    expect(response.status).toBe(499);
    expect(Date.now() - startedAt).toBeLessThan(handlerTimeoutMs);
    expect(readGates.snapshot()).toMatchObject([{ capabilityId: "notes", readerCount: 0 }]);

    // Which is the whole point: a deletion drain started right now succeeds instead of
    // waiting out a handler nobody is listening to.
    const lease = await readGates.closeAndDrain(
      { capabilityId: "notes", incarnationId: notesRow().incarnation_id },
      { timeoutMs: 50 },
    );
    expect(readGates.finalizeClose(lease)).toBe(true);
  });

  test("a write is never abandoned: the person walked away, the record still lands", async () => {
    install(conns, notesRow());
    const readGates = createReadGateCoordinator();
    const entered = deferred();
    const finish = deferred();
    const app = createApp({
      capabilityRouter: {
        databases: conns,
        readGates,
        loadItemRenderer: async () => () => "<li></li>",
        loadHandler: readLoader(async (context) => {
          const { mutation } = context as unknown as {
            mutation: { create(values: Record<string, unknown>): unknown };
          };
          entered.resolve();
          await finish.promise;
          mutation.create({ text: "landed anyway" });
          return "<p>created</p>";
        }),
      },
    });

    const client = new AbortController();
    const request = app.request("/capability/notes/create", {
      ...formBody({ text: "landed anyway" }),
      signal: client.signal,
    });
    await entered.promise;
    client.abort();
    finish.resolve();

    const response = await request;
    expect(response.status).toBe(200);
    expect(conns.readonly.query("SELECT text FROM cap_notes").all()).toEqual([
      { text: "landed anyway" },
    ]);
  });
});
