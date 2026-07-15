// Routing-refusal and failure slices of the deterministic capability router (Epic 2.3):
// unknown capabilities, undeclared actions, wrong HTTP method/action pairs, a throwing
// handler kept friendly, and the hand-written fixture's transitional inventory. Shared
// setup and fixtures live in router.test-support.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "../app.ts";
import type { PlatformDatabase } from "../db.ts";
import type { CapabilityRow } from "../registry/index.ts";
import type { CapabilityContext, CapabilityInput } from "./contract.ts";
import {
  boomRow,
  formBody,
  install,
  makeSpyLoader,
  NOTES_ARTIFACTS,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "./router.test-support.ts";
import type { HandlerLoader } from "./router.ts";

const FULL_ACTIONS = ["create", "read", "update", "delete", "search"] as const;

// Issue 4.2/03 owns the router matrix before 4.2/04 admits the second persisted
// authored shape. This lookup-only row lets the route boundary be exercised now
// without weakening the registry's exact transitional two-Action validation.
function fullActionRouteRow(): CapabilityRow {
  const base = notesRow();
  const createRequired = base.behavioral_errors[0];
  if (!createRequired) throw new Error("notes fixture is missing its required-fields case");
  return {
    ...base,
    tools: [...FULL_ACTIONS],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    behavioral_errors: [createRequired, { ...createRequired, action: "update" }],
  } as CapabilityRow;
}

function urlEncoded(entries: readonly [string, string][]): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(entries).toString(),
  };
}

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

  test("a transitional capability refuses every unadvertised future Action before any code loads", async () => {
    // The transitional row declares exactly create/read; a future Action must be
    // refused before any corresponding file could be loaded.
    install(conns, notesRow());
    const spy = makeSpyLoader();
    const app = createApp({ capabilityRouter: { databases: conns, loadHandler: spy.loadHandler } });

    for (const [action, method] of [
      ["update", "POST"],
      ["delete", "POST"],
      ["search", "GET"],
    ] as const) {
      const res = await app.request(`/capability/notes/${action}`, { method });
      expect(res.status).toBe(404);
      expect(await res.text()).toMatch(/can't find that/i);
    }
    expect(spy.calls).toHaveLength(0);
  });
});

describe("deterministic capability router — admitted method/Action matrix", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("the five admitted method/Action pairs route with Action-specific parsed input", async () => {
    const calls: Array<{ action: string; input: CapabilityInput }> = [];
    const loadHandler: HandlerLoader = async (_artifactsPath, action) => {
      return async ({ input }: CapabilityContext) => {
        calls.push({ action, input });
        return `<p>${action} reached</p>`;
      };
    };
    const routerDeps = {
      databases: conns,
      loadHandler,
      loadItemRenderer: async () => () => "<span>item</span>",
    } as const;
    install(conns, notesRow());
    const transitionalApp = createApp({ capabilityRouter: routerDeps });
    const fullActionApp = createApp({
      capabilityRouter: {
        ...routerDeps,
        lookupCapability: () => fullActionRouteRow(),
      },
    });

    const requests: Array<() => Response | Promise<Response>> = [
      () => fullActionApp.request("/capability/notes/read"),
      () => fullActionApp.request("/capability/notes/search?q=milk"),
      () =>
        transitionalApp.request(
          "/capability/notes/create",
          formBody({ text: "Milk", pinned: "true" }),
        ),
      () =>
        fullActionApp.request(
          "/capability/notes/update",
          urlEncoded([
            ["text", "Oat milk"],
            ["__aluna_present", "text"],
            ["__aluna_record_id", "record-1"],
          ]),
        ),
      () =>
        fullActionApp.request(
          "/capability/notes/delete",
          urlEncoded([["__aluna_record_id", "record-1"]]),
        ),
    ];

    for (const request of requests) {
      const response = await request();
      expect(response.status).toBe(200);
    }
    expect(calls).toEqual([
      { action: "read", input: { values: {}, submittedFields: new Set() } },
      { action: "search", input: { values: { q: "milk" }, submittedFields: new Set() } },
      {
        action: "create",
        input: {
          values: { text: "Milk", pinned: "true" },
          submittedFields: new Set(["text", "pinned"]),
        },
      },
      {
        action: "update",
        input: { values: { text: "Oat milk" }, submittedFields: new Set(["text"]) },
      },
      { action: "delete", input: { values: {}, submittedFields: new Set() } },
    ]);
    for (const { input } of calls) {
      expect(input.values).not.toHaveProperty("__aluna_present");
      expect(input.values).not.toHaveProperty("__aluna_record_id");
    }
  });
});

describe("deterministic capability router — rejected method/Action matrix", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("every other method/Action pair receives the warm boundary before registry or code access", async () => {
    let lookupCalls = 0;
    let handlerLoads = 0;
    let itemLoads = 0;
    const app = createApp({
      capabilityRouter: {
        databases: conns,
        lookupCapability: () => {
          lookupCalls += 1;
          return fullActionRouteRow();
        },
        loadHandler: async () => {
          handlerLoads += 1;
          return async () => "<p>never</p>";
        },
        loadItemRenderer: async () => {
          itemLoads += 1;
          return () => "<span>never</span>";
        },
      },
    });

    const expected = new Set([
      "POST create",
      "GET read",
      "POST update",
      "POST delete",
      "GET search",
    ]);
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
    const actions = [...FULL_ACTIONS, "unknown"] as const;
    for (const method of methods) {
      for (const action of actions) {
        if (expected.has(`${method} ${action}`)) continue;
        const response = await app.request(`/capability/notes/${action}`, { method });
        expect(response.status).toBe(404);
        expect(await response.text()).toMatch(/can't find that/i);
      }
    }

    expect(lookupCalls).toBe(0);
    expect(handlerLoads).toBe(0);
    expect(itemLoads).toBe(0);
  });
});

describe("deterministic capability router — reserved marker boundary", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("record-target and mutation-form marker failures stay warm and load no generated code", async () => {
    let handlerLoads = 0;
    let itemLoads = 0;
    const app = createApp({
      capabilityRouter: {
        databases: conns,
        lookupCapability: () => fullActionRouteRow(),
        loadHandler: async () => {
          handlerLoads += 1;
          return async () => "<p>never</p>";
        },
        loadItemRenderer: async () => {
          itemLoads += 1;
          return () => "<span>never</span>";
        },
      },
    });
    const badRequests: Array<() => Response | Promise<Response>> = [
      () => app.request("/capability/notes/update", urlEncoded([])),
      () =>
        app.request(
          "/capability/notes/update",
          urlEncoded([
            ["__aluna_record_id", "one"],
            ["__aluna_record_id", "two"],
          ]),
        ),
      () => app.request("/capability/notes/delete", urlEncoded([])),
      () =>
        app.request(
          "/capability/notes/delete",
          urlEncoded([
            ["__aluna_record_id", "one"],
            ["__aluna_record_id", "two"],
          ]),
        ),
      () =>
        app.request(
          "/capability/notes/create",
          urlEncoded([
            ["__aluna_present", "text"],
            ["__aluna_present", "pinned"],
            ["__aluna_record_id", "record-1"],
          ]),
        ),
      () => app.request("/capability/notes/read?__aluna_record_id=record-1"),
      () => app.request("/capability/notes/search?__aluna_record_id=record-1"),
      () => app.request("/capability/notes/read?__aluna_present=text"),
      () => app.request("/capability/notes/search?__aluna_present=text"),
    ];

    for (const request of badRequests) {
      const response = await request();
      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).toMatch(/couldn't make sense/i);
      expect(body).not.toMatch(/record target|__aluna_|handler|route/i);
    }
    expect(handlerLoads).toBe(0);
    expect(itemLoads).toBe(0);
  });
});

describe("deterministic capability router — failures and transitional inventory", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
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
