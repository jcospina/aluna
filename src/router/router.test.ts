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
import {
  BEHAVIORAL_ERROR_MARKERS,
  insertCapability,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import type { HandlerLoader, ItemRendererLoader } from "./router.ts";

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
    ui_intent: {
      item: "A text-forward card that emphasizes the note text.",
      collection: { layout: "feed" },
      detail: { shows: ["text"] },
    },
    behavior: "Text is required. Newest notes appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
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
    ui_intent: {
      item: "A text-forward card that emphasizes the note text.",
      collection: { layout: "feed" },
      detail: { shows: ["note"] },
    },
    behavior: "Always fails, to prove failures stay friendly.",
    behavioral_errors: [],
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
    behavioral_errors: row.behavioral_errors,
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

async function inspectCapabilitySurfacePlacement(html: string): Promise<{
  insideColdStart: boolean;
  insideActiveContent: boolean;
}> {
  let surfaceAncestors: string[][] | undefined;
  const stack: string[][] = [];
  const rewriter = new HTMLRewriter().on("*", {
    element(element) {
      const classList = classNames(element.getAttribute("class"));
      stack.push(classList);

      if (classList.includes("capability-surface")) {
        surfaceAncestors = stack.map((classes) => [...classes]);
      }

      if (element.canHaveContent) {
        element.onEndTag(() => {
          stack.pop();
        });
      } else {
        stack.pop();
      }
    },
  });

  await new Response(rewriter.transform(new Response(html)).body).text();

  if (!surfaceAncestors) {
    throw new Error("missing .capability-surface in direct capability shell");
  }

  return {
    insideColdStart: surfaceAncestors.some((classes) => classes.includes("cold-start")),
    insideActiveContent: surfaceAncestors.some((classes) => classes.includes("content__active")),
  };
}

async function collectToolbarEntryText(html: string): Promise<string[]> {
  const entries: string[] = [];
  let currentEntry: string | undefined;
  const rewriter = new HTMLRewriter().on("[data-capability-entry]", {
    element(element) {
      currentEntry = "";
      element.onEndTag(() => {
        entries.push(normalizeSpace(currentEntry ?? ""));
        currentEntry = undefined;
      });
    },
    text(text) {
      if (currentEntry !== undefined) {
        currentEntry += text.text;
      }
    },
  });

  await new Response(rewriter.transform(new Response(html)).body).text();
  return entries;
}

function classNames(value: string | null): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

function normalizeSpace(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
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

  test("read leaves the region truly empty when there are no records, so the platform empty state shows", async () => {
    // Regression (empty-state bug): a read handler must not author its own empty state.
    // If it returns empty-state markup for zero rows, that lands in `#notes-records` on
    // the read `load` swap, which (1) defeats the platform's `:empty` empty state
    // (ADR-0005 §1 — the list scaffolding owns it) and (2) lingers below the first
    // record once create prepends it (hx-swap="afterbegin"). With no records, read must
    // return nothing so the region stays childless and the platform empty state shows.
    install(conns, notesRow());
    const app = createApp({ capabilityRouter: { databases: conns } });

    const res = await app.request("/capability/notes/read");
    expect(res.status).toBe(200);
    // Nothing rendered into the region — no element, no placeholder text — so `:empty`
    // still matches and `.capability-empty` (rendered by the scaffolding) is the sole
    // empty state, which the first created record then clears on its own.
    expect((await res.text()).trim()).toBe("");
  });

  test("injects the presentation adapter into the toolbox; a handler renders records through it", async () => {
    install(conns, notesRow());
    // Seed a record so `read` has something to present.
    createCapabilityDataTool(notesSpec(), conns).insert({ text: "Buy milk", pinned: true });

    // A hand-written item renderer (the composition input 3.4/02 generates) and a read
    // handler shaped like 3.4/02's: it maps records through the injected `present` and emits
    // no markup of its own — proving the adapter reaches the toolbox and does the wrapping.
    const renderItem = (rec: Record<string, unknown>) =>
      `<div class="stack"><span class="text-lg truncate">${rec.text}</span></div>`;
    const loadItemRenderer: ItemRendererLoader = async () => renderItem;
    const loadHandler: HandlerLoader =
      async () =>
      async ({ data, present }) =>
        data
          .select()
          .map((row) => present(row))
          .join("");

    const app = createApp({
      capabilityRouter: { databases: conns, loadHandler, loadItemRenderer },
    });

    const res = await app.request("/capability/notes/read");
    expect(res.status).toBe(200);
    const body = await res.text();
    // The record came back through the adapter: the accessible wrapper, the escaped payload,
    // the record-keyed detail hook, and the renderer's inner markup — none authored by the
    // handler itself.
    expect(body).toContain('class="capability-item"');
    expect(body).toContain("data-item=");
    expect(body).toContain('data-detail-template="detail-notes-');
    expect(body).toContain('<span class="text-lg truncate">Buy milk</span>');
  });

  test("a handler that presents without an item renderer fails cleanly, never blank or leaking internals", async () => {
    install(conns, notesRow());
    createCapabilityDataTool(notesSpec(), conns).insert({ text: "Buy milk" });

    // No loadItemRenderer injected: the default loader finds no `item.ts` for the fixture, so
    // `present` throws the moment the handler calls it. The router turns that into the same
    // warm, internals-free failure as any handler slip — not a blank render.
    const loadHandler: HandlerLoader =
      async () =>
      async ({ data, present }) =>
        data
          .select()
          .map((row) => present(row))
          .join("");
    const app = createApp({ capabilityRouter: { databases: conns, loadHandler } });

    const res = await app.request("/capability/notes/read");
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toMatch(/something went sideways/i);
    expect(body).not.toMatch(/item renderer|handler|artifacts|Error/i);
  });

  test("serves the spec-rendered data-free list scaffolding with its live read region and create form", async () => {
    install(conns, notesRow());
    const app = createApp({ capabilityRouter: { databases: conns } });

    // A toolbar click serves the platform list scaffolding rendered live from the spec
    // (3.2/03) — no served list.html/create.html — as a bare content fragment.
    const res = await app.request("/capability/notes", { headers: { "HX-Request": "true" } });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(body).toContain('class="capability-surface"');
    expect(body).toContain('data-active-capability-id="notes"');
    expect(body).toContain('hx-get="/capability/notes/read"');
    expect(body).toContain('hx-trigger="load"');
    expect(body).toContain('hx-post="/capability/notes/create"');
    expect(body).toContain('hx-target="#notes-records"');
    expect(body).not.toContain("<!doctype html>");
    expect(body).not.toContain("/static/app.css");
  });

  test("the spec-rendered View is data-free: a committed record never enters the chrome", async () => {
    install(conns, notesRow());
    const app = createApp({ capabilityRouter: { databases: conns } });

    // Persist a record through the real create action, so live user data exists.
    await app.request(
      "/capability/notes/create",
      formBody({ text: "Secret memo", pinned: "true" }),
    );

    const fragment = await (
      await app.request("/capability/notes", { headers: { "HX-Request": "true" } })
    ).text();
    const shell = await (await app.request("/capability/notes")).text();

    // Both serving paths render the read-wired region but bake in NO record — the data
    // never enters the platform chrome (ADR-0004's never-stale cache is preserved
    // because the chrome is deterministic from the spec, not from the data).
    for (const body of [fragment, shell]) {
      expect(body).toContain('id="notes-records"');
      expect(body).toContain('hx-get="/capability/notes/read"');
      expect(body).toContain('hx-trigger="load"');
      expect(body).not.toContain("Secret memo");
    }

    // The record really is there — it just arrives only through the read action.
    expect(await (await app.request("/capability/notes/read")).text()).toContain("Secret memo");
  });

  test("direct capability navigation returns the styled shell with the spec-rendered list scaffolding active", async () => {
    install(conns, notesRow());
    const app = createApp({ capabilityRouter: { databases: conns } });

    const res = await app.request("/capability/notes");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("<!doctype html>");
    expect(body).toContain('href="/static/app.css"');
    expect(body).toContain('src="/static/vendor/htmx.min.js"');
    expect(body).toContain('class="shell has-capabilities"');
    expect(body).toContain('id="spec-build-output"');
    expect(body).toContain('class="capability-surface"');
    expect(body).toContain('data-active-capability-id="notes"');
    expect(body).toContain('hx-get="/capability/notes/read"');
    expect(body).toContain('hx-post="/capability/notes/create"');
    expect(body).toContain('hx-target="#notes-records"');
    expect(body).toContain("data-capability-entry");
    expect(body).toContain('hx-get="/capability/notes"');
    expect(await inspectCapabilitySurfacePlacement(body)).toEqual({
      insideColdStart: false,
      insideActiveContent: true,
    });
    expect(await collectToolbarEntryText(body)).toEqual(["Notes"]);
  });

  test("direct capability navigation rehydrates the whole toolbar, not just the opened capability", async () => {
    // The reported bug: opening or refreshing one capability by URL showed only that
    // capability in the toolbar, so every sibling looked lost — even though the registry
    // still held them (`GET /` proved it by showing them all again). A full-page load of
    // `/capability/:id` must restore the same complete toolbar `GET /` does.
    install(conns, notesRow());
    install(conns, boomRow());
    const app = createApp({ capabilityRouter: { databases: conns } });

    const body = await (await app.request("/capability/notes")).text();

    // Both entries present (ordered by id, the registry's stable order), and the opened
    // capability is still the active content surface.
    expect(await collectToolbarEntryText(body)).toEqual(["Boom", "Notes"]);
    expect(body).toContain('data-active-capability-id="notes"');
    expect(body).toContain('hx-get="/capability/notes"');
    expect(body).toContain('hx-get="/capability/boom"');
  });

  test("direct capability navigation uses a canonical short toolbar label for legacy sentence labels", async () => {
    const sentenceLabel = "We'll set up a space to capture and organize all your notes.";
    insertCapability(notesRow({ label: sentenceLabel }), conns.readwrite);
    const app = createApp({ capabilityRouter: { databases: conns } });

    const res = await app.request("/capability/notes");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(await collectToolbarEntryText(body)).toEqual(["Notes"]);
    expect(body).not.toContain(sentenceLabel);
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
