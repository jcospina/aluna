import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import { createReadGateCoordinator } from "../read-gates/index.ts";
import {
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../router/router.test-support.ts";
import { createApp } from "./app.ts";

describe("read-gate living preview", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("shows live per-incarnation state from the same coordinator capability routes use", async () => {
    const row = notesRow();
    install(conns, row);
    const readGates = createReadGateCoordinator();
    const app = createApp({
      readGates,
      capabilityRouter: { databases: conns },
    });

    const page = await (await app.request("/demo/read-gates")).text();
    expect(page).toContain("Per-incarnation read gates");
    expect(page).toContain(row.incarnation_id);
    expect(page).toContain('hx-get="/demo/read-gates/state"');
    expect(page).toContain('hx-trigger="load, every 400ms"');
    expect(page).toContain(`/demo/read-gates/${row.id}/hold`);
    expect(page).toContain(`/demo/read-gates/${row.id}/close`);

    const catalog = [{ capabilityId: row.id, incarnationId: row.incarnation_id }];
    const tokens = readGates.tryAcquire({ catalog, incarnations: catalog });
    expect(tokens).toBeDefined();
    const held = await (await app.request("/demo/read-gates/state")).text();
    expect(held).toContain("active");
    expect(held).toMatch(/<td>1<\/td>/);
    expect(tokens && readGates.release(tokens)).toBe(true);

    const closing = await readGates.closeAndDrain(catalog[0] as (typeof catalog)[number]);
    const closingState = await (await app.request("/demo/read-gates/state")).text();
    expect(closingState).toContain("closing");
    expect(closingState).toMatch(/<td>0<\/td>/);
    expect(readGates.reopen(closing)).toBe(true);
  });

  test("the close exercise owns deletion admission and cannot disturb a busy runtime", async () => {
    const row = notesRow();
    install(conns, row);
    const readGates = createReadGateCoordinator();
    const mutationCoordinator = createMutationCoordinator();
    const recordLease = mutationCoordinator.tryAcquireRecordWrite();
    expect(recordLease).toBeDefined();
    const app = createApp({
      mutationCoordinator,
      readGates,
      capabilityRouter: { databases: conns },
    });

    const response = await app.request(`/demo/read-gates/${row.id}/close`, { method: "POST" });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("no gate was closed");
    expect(readGates.snapshot()[0]).toMatchObject({ state: "active", readerCount: 0 });
    expect(recordLease && mutationCoordinator.release(recordLease)).toBe(true);
  });
});
