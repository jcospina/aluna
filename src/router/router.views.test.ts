// View-surface slices of the deterministic capability router (Epic 2.3): the default
// loader's incarnation keying, the presentation adapter injected into the toolbox, the
// spec-rendered data-free list scaffolding, and the toolbar rehydration/label behavior.
// Shared setup and fixtures live in router.test-support.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../app.ts";
import type { PlatformDatabase } from "../db.ts";
import { insertCapability } from "../registry/index.ts";
import type { CapabilityContext } from "./contract.ts";
import {
  boomRow,
  collectToolbarEntryText,
  createCapabilityDataTool,
  formBody,
  inspectCapabilitySurfacePlacement,
  install,
  notesRow,
  notesSpec,
  setupRouterTest,
  teardownRouterTest,
} from "./router.test-support.ts";
import type { HandlerLoader, ItemRendererLoader } from "./router.ts";

describe("deterministic capability router — loader keying", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("the default loader keys Bun imports by incarnation path for a recreated semantic id", async () => {
    const firstIncarnation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const secondIncarnation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const artifactsRoot = join(dir, "capabilities", "notes");

    const writeIncarnation = (incarnationId: string, marker: string) => {
      const versionDir = join(artifactsRoot, incarnationId, "v1");
      mkdirSync(versionDir, { recursive: true });
      writeFileSync(
        join(versionDir, "item.ts"),
        `export default function renderItem() { return "<span>${marker} item</span>"; }`,
      );
      writeFileSync(
        join(versionDir, "read.ts"),
        `export default async function read() { return "<p>${marker} handler</p>"; }`,
      );
      return `${versionDir}/`;
    };

    const firstPath = writeIncarnation(firstIncarnation, "first");
    const secondPath = writeIncarnation(secondIncarnation, "second");
    install(conns, notesRow({ incarnation_id: firstIncarnation, artifacts_path: firstPath }));
    const app = createApp({ capabilityRouter: { databases: conns } });

    expect(await (await app.request("/capability/notes/read")).text()).toContain("first handler");

    // Simulate the registry boundary of delete/recreate. The semantic id is the same,
    // but its lifetime and therefore the full module URL are different.
    conns.readwrite.run("DELETE FROM capability_registry WHERE id = ?", ["notes"]);
    insertCapability(
      notesRow({ incarnation_id: secondIncarnation, artifacts_path: secondPath }),
      conns.readwrite,
    );

    const recreated = await (await app.request("/capability/notes/read")).text();
    expect(recreated).toContain("second handler");
    expect(recreated).not.toContain("first handler");
  });
});

describe("deterministic capability router — presentation adapter and empty read", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
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
      async ({ query, present }: CapabilityContext) =>
        query
          .records({
            sql: 'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC',
          })
          .map(({ record }) => present(record))
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

  test("a missing required item renderer fails cleanly before the handler loads", async () => {
    install(conns, notesRow());

    // The M3 shape has no compatibility path for a version directory without `item.ts`.
    // Loading the renderer fails before handler code is reached, and the router keeps the
    // exact artifact error developer-only.
    let handlerLoads = 0;
    const loadHandler: HandlerLoader = async () => {
      handlerLoads += 1;
      return async () => "<p>should never run</p>";
    };
    const loadItemRenderer: ItemRendererLoader = async () => {
      throw new Error("ENOENT item.ts");
    };
    const app = createApp({
      capabilityRouter: { databases: conns, loadHandler, loadItemRenderer },
    });

    const res = await app.request("/capability/notes/read");
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toMatch(/something went sideways/i);
    expect(body).not.toMatch(/item renderer|handler|artifacts|Error/i);
    expect(handlerLoads).toBe(0);
  });
});

describe("deterministic capability router — view scaffolding", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
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
    expect(body).not.toContain("data-capability-search");
    expect(body).not.toContain("<!doctype html>");
    expect(body).not.toContain("/static/app.css");
  });

  test("a complete five-Action View renders search chrome wired only to committed routes", async () => {
    const createRequired = notesRow().behavioral_errors[0];
    if (!createRequired) throw new Error("notes fixture is missing its required-fields case");
    const fullRow = notesRow({
      tools: ["create", "read", "update", "delete", "search"],
      read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
      behavioral_errors: [createRequired, { ...createRequired, action: "update" }],
    });
    const app = createApp({
      capabilityRouter: { databases: conns, lookupCapability: () => fullRow },
    });

    const body = await (
      await app.request("/capability/notes", { headers: { "HX-Request": "true" } })
    ).text();

    expect(body).toContain("data-capability-search");
    expect(body).toContain('data-read-url="/capability/notes/read"');
    expect(body).toContain('data-search-url="/capability/notes/search"');
    expect(body).not.toContain("/prompt");
    expect(body).not.toContain("/build/");
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
});

describe("deterministic capability router — toolbar rehydration and labels", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
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
});
