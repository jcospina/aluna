// Routing-refusal and failure slices of the deterministic capability router (Epic 2.3):
// unknown capabilities, undeclared actions, wrong HTTP method/action pairs, a throwing
// handler kept friendly, and the hand-written fixture's transitional inventory. Shared
// setup and fixtures live in router.test-support.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "../app.ts";
import type { PlatformDatabase } from "../db.ts";
import {
  boomRow,
  createCapabilityDataTool,
  install,
  makeSpyLoader,
  NOTES_ARTIFACTS,
  notesRow,
  notesSpec,
  setupRouterTest,
  teardownRouterTest,
} from "./router.test-support.ts";

describe("deterministic capability router — routing refusals and failures", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("an unknown capability fails cleanly, in product voice, before any handler loads", async () => {
    const spy = makeSpyLoader();
    const app = createApp({ capabilityRouter: { databases: conns, loadHandler: spy.loadHandler } });

    const res = await app.request("/capability/ghost/read");

    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toMatch(/can't find that/i);
    // No internals leak (ARCH §9.7), and no handler load was even attempted.
    expect(body).not.toMatch(/handler|capability|registry|undefined|stack/i);
    expect(spy.calls).toHaveLength(0);
  });

  test("an action the capability does not declare is refused before any handler loads", async () => {
    // The transitional row declares exactly create/read; a future Action must be
    // refused before any corresponding file could be loaded.
    install(conns, notesRow());
    const spy = makeSpyLoader();
    const app = createApp({ capabilityRouter: { databases: conns, loadHandler: spy.loadHandler } });

    const res = await app.request("/capability/notes/update", { method: "POST" });

    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/can't find that/i);
    expect(spy.calls).toHaveLength(0);
  });

  test("wrong HTTP method and action pairs are refused before generated code loads", async () => {
    install(conns, notesRow());
    const spy = makeSpyLoader();
    let itemLoads = 0;
    const app = createApp({
      capabilityRouter: {
        databases: conns,
        loadHandler: spy.loadHandler,
        loadItemRenderer: async () => {
          itemLoads += 1;
          return () => "<span>never</span>";
        },
      },
    });

    const getCreate = await app.request("/capability/notes/create");
    const postRead = await app.request("/capability/notes/read", { method: "POST" });

    expect(getCreate.status).toBe(404);
    expect(postRead.status).toBe(404);
    expect(spy.calls).toHaveLength(0);
    expect(itemLoads).toBe(0);
    expect(createCapabilityDataTool(notesSpec(), conns).select()).toEqual([]);
  });

  test("a handler that throws surfaces a friendly failure, never a stack trace or internals", async () => {
    install(conns, boomRow());
    const app = createApp({ capabilityRouter: { databases: conns } });

    const res = await app.request("/capability/boom/read");

    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toMatch(/something went sideways/i);
    // The thrown message — deliberately internals-flavored — must not reach the UI.
    expect(body).not.toContain("Simulated");
    expect(body).not.toMatch(/internal|stack|\bError\b/);
  });

  test("the hand-written fixture is exactly the M4.1 transitional inventory and every unit honors its boundary", () => {
    expect(readdirSync(resolve(NOTES_ARTIFACTS)).sort()).toEqual([
      "create.ts",
      "item.ts",
      "read.ts",
    ]);

    for (const file of ["item.ts", "create.ts", "read.ts"]) {
      const source = readFileSync(resolve(NOTES_ARTIFACTS, file), "utf8");
      expect(source).not.toMatch(/^\s*import\b/m); // no module imports
      expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i); // no mutation SQL
      // no raw HTTP — the handler never sees the request, a response, or parsing
      expect(source).not.toContain("c.req");
      expect(source).not.toContain("parseBody");
      expect(source).not.toContain("Request");
      expect(source).not.toContain("Response");
    }

    expect(readFileSync(resolve(NOTES_ARTIFACTS, "create.ts"), "utf8")).toContain(
      "return present(note)",
    );
    expect(readFileSync(resolve(NOTES_ARTIFACTS, "read.ts"), "utf8")).toContain("present(note)");
  });
});
