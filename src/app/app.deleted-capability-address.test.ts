// A second tab, held open on a capability the first tab is deleting, and the address it
// is left holding afterwards (PLAN decision 21; issue 5.9/03).
//
// Nothing here is new machinery. The brief interval before the tombstone commits is three
// things the platform already answers — an aborted read, `409 read_unavailable` on new
// reads, `422` on pending writes — and what follows it is the desk itself. These tests are
// what pins that the second tab is never told a comfortable lie: not a fabricated success
// for the read that was cut off, and not a blank page for the address that outlived its
// capability.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { PlatformDatabase } from "../persistence/db.ts";
import { createReadGateCoordinator } from "../read-gates/index.ts";
import type { CapabilityRow } from "../registry/index.ts";
import type { CapabilityContext, CapabilityHandler } from "../router/contract.ts";
import {
  formBody,
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../router/router.test-support.ts";
import type { HandlerLoader } from "../router/router.ts";
import { NOT_FOUND_NOTICE } from "../web/index.ts";
import { createApp } from "./app.ts";

function deletionTarget(dir: string): CapabilityRow {
  const target = notesRow();
  return {
    ...target,
    artifacts_path: join(dir, "artifacts", target.id, target.incarnation_id, "v1"),
    seed: 184206,
    logo: { status: "absent", attempts: 0 },
  };
}

function confirmation(incarnationId: string): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams({ incarnation_id: incarnationId, restore_surface: "neutral" }),
  };
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

/**
 * Let the parked handler go and let both requests settle, whatever happened above.
 *
 * Without this a single failed assertion leaves a capability handler suspended on a
 * promise nobody will resolve, and `afterEach` then closes the database and removes the
 * directory out from under it — so one readable failure arrives as a pile of unhandled
 * rejections from a shared `bun test` process instead.
 */
async function settle(
  release: { resolve: () => void },
  ...pending: Array<Promise<unknown> | Response | null>
): Promise<void> {
  release.resolve();
  await Promise.allSettled(pending.filter((request) => request !== null));
}

/**
 * Wait until the deletion's drain has actually taken the gate, rather than sleeping and
 * hoping. The coordinator is the one thing both the route and this test can see, so the
 * test asks it instead of guessing how many turns of the loop the confirm route takes.
 */
async function whenClosing(
  readGates: ReturnType<typeof createReadGateCoordinator>,
  capabilityId: string,
): Promise<void> {
  for (let turn = 0; turn < 1000; turn += 1) {
    if (
      readGates
        .snapshot()
        .some((gate) => gate.capabilityId === capabilityId && gate.state === "closing")
    ) {
      return;
    }
    await new Promise((settle) => setTimeout(settle, 0));
  }
  throw new Error("The deletion never closed the read gate.");
}

describe("a second tab held open while its capability is deleted", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("the in-flight read is cut off and says so, and the drain gets its token back", async () => {
    const target = deletionTarget(dir);
    install(conns, target);
    const readGates = createReadGateCoordinator();
    const entered = deferred();
    const releaseHandler = deferred();
    const app = createApp({
      readGates,
      artifactsRoot: join(dir, "artifacts"),
      capabilityRouter: {
        databases: conns,
        loadHandler: readLoader(async ({ query }) => {
          entered.resolve();
          await releaseHandler.promise;
          query.all({ sql: "SELECT 1 AS value", result: [{ alias: "value", type: "number" }] });
          return "<p>must not reach the second tab</p>";
        }),
        loadItemRenderer: async () => () => "<span>item</span>",
      },
    });

    const inFlight = app.request("/capability/notes/read");
    let deletion: Promise<Response> | null = null;

    try {
      await entered.promise;
      const confirmed = app.request(
        "/capability-deletion/notes/confirm",
        confirmation(target.incarnation_id),
      );
      deletion = Promise.resolve(confirmed);
      await whenClosing(readGates, "notes");
      releaseHandler.resolve();

      // The read that was cut off is answered as what it is. Nothing is invented in its
      // place — no empty collection standing in for records nobody read, and not the
      // handler's own body, which never ran to the end.
      const refused = await inFlight;
      const body = await refused.text();
      expect(refused.status).toBe(409);
      expect(body).toContain('data-error-code="read_unavailable"');
      expect(body).not.toContain("must not reach the second tab");

      expect((await confirmed).status).toBe(200);
      // The token came back at the refusal, the only reason the drain could finish.
      expect(readGates.snapshot().some((gate) => gate.capabilityId === "notes")).toBe(false);
    } finally {
      await settle(releaseHandler, inFlight, deletion);
    }
  });

  test("a read and a write arriving during the drain are refused where each asked", async () => {
    const target = deletionTarget(dir);
    install(conns, target);
    const readGates = createReadGateCoordinator();
    const entered = deferred();
    const releaseHandler = deferred();
    const app = createApp({
      readGates,
      artifactsRoot: join(dir, "artifacts"),
      capabilityRouter: {
        databases: conns,
        loadHandler: readLoader(async ({ query }) => {
          entered.resolve();
          await releaseHandler.promise;
          query.all({ sql: "SELECT 1 AS value", result: [{ alias: "value", type: "number" }] });
          return "<p>held</p>";
        }),
        loadItemRenderer: async () => () => "<span>item</span>",
      },
    });

    const holding = app.request("/capability/notes/read");
    let deletion: Promise<Response> | null = null;

    try {
      await entered.promise;
      const confirmed = app.request(
        "/capability-deletion/notes/confirm",
        confirmation(target.incarnation_id),
      );
      deletion = Promise.resolve(confirmed);
      await whenClosing(readGates, "notes");

      // The window asking again gets the 409 its own surface renders (5.8/03 routes it by
      // which element asked, and this is the response that routing keys on).
      const nextRead = await app.request("/capability/notes", {
        headers: { "HX-Request": "true" },
      });
      expect(nextRead.status).toBe(409);
      expect(await nextRead.text()).toContain('data-error-code="read_unavailable"');

      // A pending write is a 422 retargeted at the form's own error node — the surface it
      // arrived from, not the prompt bar and not a new component.
      const pendingWrite = await app.request(
        "/capability/notes/create",
        formBody({ text: "late" }),
      );
      expect(pendingWrite.status).toBe(422);
      expect(pendingWrite.headers.get("HX-Retarget")).toBe("#notes-create-error");
      expect(await pendingWrite.text()).toContain('data-error-code="read_unavailable"');

      releaseHandler.resolve();
      expect((await holding).status).toBe(409);
      expect((await confirmed).status).toBe(200);
    } finally {
      await settle(releaseHandler, holding, deletion);
    }
  });
});

describe("the address a deleted capability leaves behind", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("reloading it afterwards loads the bare desk with its notice", async () => {
    const target = deletionTarget(dir);
    install(conns, target);
    const app = createApp({
      artifactsRoot: join(dir, "artifacts"),
      capabilityRouter: { databases: conns },
    });

    expect(
      (await app.request("/capability-deletion/notes/confirm", confirmation(target.incarnation_id)))
        .status,
    ).toBe(200);

    const reloaded = await app.request("/capability/notes");
    const page = await reloaded.text();

    expect(page).toContain("<!doctype html>");
    expect(page).toContain(
      `<div id="prompt-notice" class="prompt__notice" aria-live="polite">${NOT_FOUND_NOTICE}</div>`,
    );
    // The desk without the capability that is gone. What the window does with this page is
    // the client's answer and is proved where it lives (`addressAsks`,
    // `src/presentation/desk-window-address.test.ts`).
    expect(page).not.toContain("capability-logo-notes");
    expect(reloaded.status).toBe(404);
  });
});
