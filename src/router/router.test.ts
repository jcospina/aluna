// Tests for the deterministic capability router (Epic 2.3) — the tracer bullet.
//
// The headline proof: a *hand-written* fixture capability — registry row + handler
// files written by hand to the ADR-0004 contract (src/router/__fixtures__) —
// round-trips `create` + `read` end to end, BEFORE any AI exists. That pins the
// whole runtime contract: registry -> router -> injected toolbox -> data table ->
// HTML fragment back. The rest assert the router's guarantees: actions are
// validated against the row's declared tools before any code loads, and any
// failure surfaces in product voice, never as internals.
//
// Each case runs against a throwaway file db (openDatabase + runMigrations) so the
// real data file is never touched, mirroring the registry and data-tool tests.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../app.ts";
import { applyCapabilityTableDdl, createCapabilityDataTool } from "../capability-data/index.ts";
import { openDatabase, type PlatformDatabase } from "../db.ts";
import { runMigrations } from "../migrations.ts";
import type { CapabilityRow, CapabilitySpec } from "../registry/index.ts";
import { insertCapability } from "../registry/index.ts";
import type { HandlerLoader } from "./router.ts";

const NOTES_ARTIFACTS = "src/router/__fixtures__/notes/v1/";
const BOOM_ARTIFACTS = "src/router/__fixtures__/boom/v1/";

// The notes fixture's spec — matches the hand-written handler files.
function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", type: "string", required: true },
        { name: "pinned", type: "boolean", required: false },
      ],
    },
    ui_intent: { views: ["list", "create"] },
    behavior: "Text is required. Newest notes appear first.",
    tools: ["create", "read"],
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

function notesRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  return { ...notesSpec(), version: 1, artifacts_path: NOTES_ARTIFACTS, ...overrides };
}

// A fixture whose handler throws — proves a handler failure stays friendly.
function boomRow(): CapabilityRow {
  return {
    id: "boom",
    label: "Boom",
    version: 1,
    schema: { fields: [{ name: "note", type: "string", required: false }] },
    ui_intent: { views: ["list"] },
    behavior: "Always fails, to prove failures stay friendly.",
    tools: ["read"],
    artifacts_path: BOOM_ARTIFACTS,
    prompt_context: "A fixture whose handler throws.",
  };
}

// Install a capability the way a committed build would: its data table exists and
// its registry row is present, both on the scratch db.
function install(conns: PlatformDatabase, row: CapabilityRow): void {
  applyCapabilityTableDdl(rowSpec(row), conns.readwrite);
  insertCapability(row, conns.readwrite);
}

function rowSpec(row: CapabilityRow): CapabilitySpec {
  return {
    id: row.id,
    label: row.label,
    schema: row.schema,
    ui_intent: row.ui_intent,
    behavior: row.behavior,
    tools: row.tools,
    prompt_context: row.prompt_context,
  };
}

// A loader that records its calls and never actually loads anything — used to prove
// validation happens *before* any handler code is reached.
function makeSpyLoader(): {
  calls: Array<{ artifactsPath: string; action: string }>;
  loadHandler: HandlerLoader;
} {
  const calls: Array<{ artifactsPath: string; action: string }> = [];
  const loadHandler: HandlerLoader = async (artifactsPath, action) => {
    calls.push({ artifactsPath, action });
    return async () => "<p>spy: should never run</p>";
  };
  return { calls, loadHandler };
}

function formBody(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  };
}

describe("deterministic capability router", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-router-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("tracer bullet: hand-written create persists and read returns a fragment with the record", async () => {
    install(conns, notesRow());
    const app = createApp({ capabilityRouter: { databases: conns } });

    // POST to `create`: the handler receives parsed input + the scoped data tool,
    // persists through it, and returns a fragment the platform wraps in the response.
    const created = await app.request(
      "/capability/notes/create",
      formBody({ text: "Buy milk", pinned: "true" }),
    );
    expect(created.status).toBe(200);
    expect(created.headers.get("content-type")).toContain("text/html");
    expect(await created.text()).toContain("Buy milk");

    // It really landed in the data table (not merely echoed) — selectable through
    // the scoped tool on the same scratch db.
    const persisted = createCapabilityDataTool(notesSpec(), conns).select();
    expect(persisted).toMatchObject([{ text: "Buy milk", pinned: true }]);

    // GET to `read`: a fragment carrying the persisted record.
    const read = await app.request("/capability/notes/read");
    expect(read.status).toBe(200);
    const readBody = await read.text();
    expect(readBody).toContain("Buy milk");
    expect(readBody).toContain("pinned");
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
    // The row declares only `create`; a request for `read` must be refused even
    // though a read handler file exists at the artifacts path.
    install(conns, notesRow({ tools: ["create"] }));
    const spy = makeSpyLoader();
    const app = createApp({ capabilityRouter: { databases: conns, loadHandler: spy.loadHandler } });

    const res = await app.request("/capability/notes/read");

    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/can't find that/i);
    expect(spy.calls).toHaveLength(0);
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

  test("the hand-written handlers honor the contract: no imports, no raw HTTP, no table names", () => {
    for (const file of ["create.ts", "read.ts"]) {
      const source = readFileSync(resolve(NOTES_ARTIFACTS, file), "utf8");
      expect(source).not.toMatch(/^\s*import\b/m); // no module imports
      expect(source).not.toContain("cap_"); // no table names
      // no raw HTTP — the handler never sees the request, a response, or parsing
      expect(source).not.toContain("c.req");
      expect(source).not.toContain("parseBody");
      expect(source).not.toContain("Request");
      expect(source).not.toContain("Response");
    }
  });
});
