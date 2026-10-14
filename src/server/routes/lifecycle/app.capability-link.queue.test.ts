import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { capabilityLinkUrl } from "#shell/core/routes.js";
import { until } from "../../../platform/async.test-support.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { compareAndSwapCapability, getCapability } from "../../../registry/index.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../../runtime/concurrency/mutation-coordinator.ts";
import {
  setupRouterTest,
  teardownRouterTest,
} from "../../../runtime/router/dispatch/router.test-support.ts";
import { createTestApp } from "../../isolated-app.test-support.ts";
import {
  AUTHORS,
  BOOKS,
  type DeskCapability,
  deskRow,
  installDesk,
  noticeCode,
} from "./link.test-support.ts";

let dir: string;
let conns: PlatformDatabase;

beforeEach(() => {
  ({ dir, conns } = setupRouterTest());
  installDesk(conns);
});

afterEach(() => {
  teardownRouterTest(dir, conns);
});

/** A coordinator a build is holding, and the way to let it go. */
async function runningBuild() {
  const mutationCoordinator = createMutationCoordinator();
  const lease = await mutationCoordinator.acquireBuild(mutationCoordinator.reserveBuild());
  return { mutationCoordinator, finish: () => mutationCoordinator.release(lease) };
}

const queuedPlatformWrites = (coordinator: MutationCoordinator) =>
  coordinator.snapshot().queuedTickets.filter((ticket) => ticket.kind === "platform").length;

/** Books' author picked from Authors' name, as the chooser read both at version 1. */
function linkAuthor(mutationCoordinator: MutationCoordinator, signal?: AbortSignal) {
  const body = new URLSearchParams({
    incarnation_id: BOOKS.incarnation,
    version: "1",
    target: AUTHORS.id,
    target_field: "name",
    target_incarnation_id: AUTHORS.incarnation,
    target_version: "1",
  });
  return createTestApp({ capabilityRouter: { databases: conns }, mutationCoordinator }).request(
    capabilityLinkUrl("books", "author"),
    { method: "POST", body, ...(signal ? { signal } : {}) },
  );
}

/** What a build activating version 2 does to a row: everything moves but the relations. */
function evolve(capability: DeskCapability): void {
  compareAndSwapCapability(
    { ...deskRow(capability), version: 2 },
    {
      state: "active",
      capabilityId: capability.id,
      incarnationId: capability.incarnation,
      version: 1,
    },
    conns.readwrite,
  );
}

const relations = () => getCapability("books", conns.readonly)?.relations ?? [];

describe("a press while a build holds the lease", () => {
  test("waits its turn behind the build, then applies", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    const answer = linkAuthor(mutationCoordinator);

    await until(() => queuedPlatformWrites(mutationCoordinator) === 1);
    expect(relations()).toEqual([]);
    finish();

    expect((await answer).status).toBe(204);
    expect(relations()).toEqual([
      {
        field: "author",
        to: { capability: "authors", incarnation: AUTHORS.incarnation, field: "name" },
      },
    ]);
  });

  for (const [end, capability] of [
    ["the source", BOOKS],
    ["the target", AUTHORS],
  ] as const) {
    test(`is refused as stale when the build changed ${end}, and nothing is written`, async () => {
      const { mutationCoordinator, finish } = await runningBuild();
      const answer = linkAuthor(mutationCoordinator);
      await until(() => queuedPlatformWrites(mutationCoordinator) === 1);
      evolve(capability);
      finish();

      const response = await answer;
      expect(response.status).toBe(409);
      expect(noticeCode(await response.text())).toBe("link_stale");
      expect(relations()).toEqual([]);
    });
  }

  test("whose connection closes while it waits leaves the queue and writes nothing", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    const leaving = new AbortController();
    const answer = linkAuthor(mutationCoordinator, leaving.signal);
    await until(() => queuedPlatformWrites(mutationCoordinator) === 1);

    leaving.abort();
    await Promise.resolve(answer).catch(() => undefined);
    expect(queuedPlatformWrites(mutationCoordinator)).toBe(0);
    finish();
    await until(() => mutationCoordinator.snapshot().activeLease === null);
    expect(relations()).toEqual([]);
  });

  test("a press against a source already gone never joins the queue", async () => {
    const { mutationCoordinator, finish } = await runningBuild();
    evolve(BOOKS);
    const response = await linkAuthor(mutationCoordinator);
    expect(response.status).toBe(409);
    expect(queuedPlatformWrites(mutationCoordinator)).toBe(0);
    finish();
  });
});
