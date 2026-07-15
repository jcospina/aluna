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
// This file carries the create/persistence, build-lease concurrency, and
// presence/requiredness slices; view and routing slices live in the sibling
// router.views.test.ts / router.routing.test.ts files. Shared setup and fixtures
// live in router.test-support.ts. Each case runs against a throwaway file db so the
// real data file is never touched, mirroring the registry and data-tool tests.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../app.ts";
import type { PlatformDatabase } from "../db.ts";
import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import type { CapabilityCreateContext } from "./contract.ts";
import {
  createCapabilityDataTool,
  formBody,
  install,
  NOTES_ARTIFACTS,
  NOTES_INCARNATION_ID,
  notesRow,
  notesSpec,
  setupRouterTest,
  teardownRouterTest,
} from "./router.test-support.ts";
import type { HandlerLoader } from "./router.ts";

describe("deterministic capability router — create and persistence", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
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
});

describe("deterministic capability router — build lease and concurrency", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("a record create cannot join or be rolled back with an active build transaction", async () => {
    install(conns, notesRow());
    const mutationCoordinator = createMutationCoordinator();
    const reservation = mutationCoordinator.reserveBuild();
    const buildLease = await mutationCoordinator.acquireBuild(reservation);
    const app = createApp({
      capabilityRouter: { databases: conns },
      mutationCoordinator,
    });

    conns.readwrite.exec("BEGIN IMMEDIATE");
    conns.readwrite
      .query(
        "INSERT INTO cap_notes (id, created_at, extra, text, pinned) VALUES (?, ?, '{}', ?, ?)",
      )
      .run("build-row", "2026-07-15T00:00:00.000Z", "Rolled-back build work", 0);
    const response = await app.request(
      "/capability/notes/create",
      formBody({ text: "Must not join the build", pinned: "true" }),
    );
    conns.readwrite.exec("ROLLBACK");

    expect(response.status).toBe(422);
    expect(response.headers.get("HX-Retarget")).toBe("#notes-create-error");
    expect(await response.text()).toMatch(/still putting something together/i);
    expect(createCapabilityDataTool(notesSpec(), conns).select()).toEqual([]);
    expect(mutationCoordinator.release(buildLease)).toBe(true);
  });

  test("reads remain concurrent during an active build lease", async () => {
    install(conns, notesRow());
    createCapabilityDataTool(notesSpec(), conns).insert({ text: "Still readable", pinned: false });
    const mutationCoordinator = createMutationCoordinator();
    const reservation = mutationCoordinator.reserveBuild();
    const buildLease = await mutationCoordinator.acquireBuild(reservation);
    const app = createApp({
      capabilityRouter: { databases: conns },
      mutationCoordinator,
    });

    const response = await app.request("/capability/notes/read");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Still readable");
    expect(mutationCoordinator.snapshot().activeLease?.leaseId).toBe(buildLease.leaseId);
    expect(mutationCoordinator.release(buildLease)).toBe(true);
  });
});

describe("deterministic capability router — presence and requiredness markers", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("platform requiredness returns warm structured markers and does not reset a failed create", async () => {
    install(conns, notesRow());
    const app = createApp({
      capabilityRouter: {
        databases: conns,
        loadHandler:
          async () =>
          async ({ input, mutation, present }: CapabilityCreateContext) =>
            present(mutation.create({ text: input.values.text, pinned: false })),
        loadItemRenderer: async () => (record) =>
          `<span class="text-lg">${String(record.text)}</span>`,
      },
    });

    const response = await app.request("/capability/notes/create", formBody({ text: "   " }));
    expect(response.status).toBe(422);
    expect(response.headers.get("HX-Retarget")).toBe("#notes-create-error");
    expect(response.headers.get("HX-Reswap")).toBe("innerHTML");
    const html = await response.text();
    expect(html).toContain('data-role="error"');
    expect(html).toContain('data-error-code="missing_required_fields"');
    expect(html).toContain('data-error-fields="text"');
    expect(html).toContain("I still need a little more");
    expect(createCapabilityDataTool(notesSpec(), conns).select()).toEqual([]);
  });

  test("duplicate scalar input and create record targets fail warm before generated code loads", async () => {
    install(conns, notesRow());
    let handlerLoads = 0;
    let rendererLoads = 0;
    const app = createApp({
      capabilityRouter: {
        databases: conns,
        loadHandler: async () => {
          handlerLoads += 1;
          return async () => "<p>should not run</p>";
        },
        loadItemRenderer: async () => {
          rendererLoads += 1;
          return () => "<span>should not run</span>";
        },
      },
    });

    for (const body of [
      new URLSearchParams([
        ["text", "one"],
        ["text", "two"],
        ["__aluna_present", "text"],
        ["__aluna_present", "pinned"],
      ]),
      new URLSearchParams([
        ["text", "one"],
        ["__aluna_present", "text"],
        ["__aluna_present", "pinned"],
        ["__aluna_record_id", "record-1"],
      ]),
    ]) {
      const response = await app.request("/capability/notes/create", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toMatch(/couldn't make sense/i);
      expect(html).not.toMatch(/scalar|record target|__aluna_|handler/i);
    }
    expect(handlerLoads).toBe(0);
    expect(rendererLoads).toBe(0);
  });
});

describe("deterministic capability router — create presence for scalars and booleans", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });

  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  test("create presence distinguishes empty optional scalars and unchecked booleans", async () => {
    const presenceSpec = notesSpec({
      schema: {
        fields: [
          { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
          {
            name: "summary",
            label: "Summary",
            type: "string",
            required: false,
            lifecycle: "active",
          },
          {
            name: "pinned",
            label: "Pinned",
            type: "boolean",
            required: false,
            lifecycle: "active",
          },
        ],
      },
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "A text-forward note.", shows: ["text"] },
        collection: { layout: "feed" },
        detail: { shows: ["text", "summary", "pinned"] },
      },
    });
    install(
      conns,
      notesRow({
        ...presenceSpec,
        incarnation_id: NOTES_INCARNATION_ID,
        version: 1,
        artifacts_path: NOTES_ARTIFACTS,
      }),
    );
    let receivedInput: Parameters<Awaited<ReturnType<HandlerLoader>>>[0]["input"] | undefined;
    const app = createApp({
      capabilityRouter: {
        databases: conns,
        loadHandler:
          async () =>
          async ({ input, mutation, present }: CapabilityCreateContext) => {
            receivedInput = input;
            const summary = input.values.summary;
            const pinned = input.values.pinned;
            return present(
              mutation.create({
                text: input.values.text,
                summary: summary === "" ? null : summary,
                pinned:
                  input.submittedFields.has("pinned") && (pinned === "on" || pinned === "true"),
              }),
            );
          },
        loadItemRenderer: async () => (record) => `<span>${String(record.text)}</span>`,
      },
    });
    const body = new URLSearchParams([
      ["text", "Buy milk"],
      ["summary", ""],
      ["__aluna_present", "text"],
      ["__aluna_present", "summary"],
      ["__aluna_present", "pinned"],
    ]);

    const response = await app.request("/capability/notes/create", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    expect(response.status).toBe(200);
    expect(receivedInput).toEqual({
      values: { text: "Buy milk", summary: "" },
      submittedFields: new Set(["text", "summary", "pinned"]),
    });
    expect(createCapabilityDataTool(presenceSpec, conns).select()).toMatchObject([
      { text: "Buy milk", summary: null, pinned: false },
    ]);
  });
});
