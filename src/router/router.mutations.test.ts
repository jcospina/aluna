import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createApp } from "../app.ts";
import type { PlatformDatabase } from "../db.ts";
import type { CapabilityRow } from "../registry/index.ts";
import type { CapabilityDeleteContext, CapabilityUpdateContext } from "./contract.ts";
import { install, notesRow, setupRouterTest, teardownRouterTest } from "./router.test-support.ts";
import type { HandlerLoader } from "./router.ts";

function fiveActionRow(): CapabilityRow {
  const base = notesRow();
  const createRequired = base.behavioral_errors[0];
  if (!createRequired) throw new Error("notes fixture is missing its required-fields case");
  return {
    ...base,
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    behavioral_errors: [createRequired, { ...createRequired, action: "update" }],
  } as CapabilityRow;
}

function targetBody(target: string, entries: readonly [string, string][] = []): RequestInit {
  const body = new URLSearchParams(entries);
  body.append("__aluna_record_id", target);
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  };
}

function seed(database: PlatformDatabase["readwrite"]): void {
  database.run('INSERT INTO "cap_notes" ("id", "text", "pinned") VALUES (?, ?, ?)', [
    "record-a",
    "First",
    0,
  ]);
  database.run('INSERT INTO "cap_notes" ("id", "text", "pinned") VALUES (?, ?, ?)', [
    "record-b",
    "Second",
    1,
  ]);
}

describe("deterministic capability router — target-bound mutation authority", () => {
  let dir: string;
  let databases: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns: databases } = setupRouterTest());
    install(databases, fiveActionRow());
    seed(databases.readwrite);
  });

  afterEach(() => {
    teardownRouterTest(dir, databases);
  });

  test("update snapshots submitted presence and cannot substitute the validated target", async () => {
    let mutationSurface: string[] = [];
    const loadHandler: HandlerLoader = async (_path, action) => {
      if (action !== "update") return async () => "<p>unused</p>";
      return async (rawContext: unknown) => {
        const context = rawContext as CapabilityUpdateContext;
        mutationSurface = Object.keys(context.mutation);
        const exposedSubmitted = context.input.submittedFields as Set<string>;
        exposedSubmitted.clear();
        exposedSubmitted.add("pinned");
        const unsafeUpdate = context.mutation.update as (
          values: Record<string, unknown>,
          replacementTarget: string,
        ) => ReturnType<typeof context.mutation.update>;
        return context.present(unsafeUpdate({ text: "Updated first" }, "record-b"));
      };
    };
    const app = createApp({
      capabilityRouter: {
        databases,
        loadHandler,
        loadItemRenderer: async () => (record) => `<span>${record.text}</span>`,
      },
    });

    const response = await app.request(
      "/capability/notes/update",
      targetBody("record-a", [
        ["text", "Submitted text"],
        ["__aluna_present", "text"],
      ]),
    );

    expect(response.status).toBe(200);
    expect(mutationSurface).toEqual(["update"]);
    expect(
      databases.readwrite
        .query('SELECT "id", "text", "pinned" FROM "cap_notes" ORDER BY "id"')
        .all(),
    ).toEqual([
      { id: "record-a", text: "Updated first", pinned: 0 },
      { id: "record-b", text: "Second", pinned: 1 },
    ]);
  });

  test("delete exposes no selector, removes only the validated target, and loads no item renderer", async () => {
    let mutationSurface: string[] = [];
    let itemLoads = 0;
    const loadHandler: HandlerLoader = async (_path, action) => {
      if (action !== "delete") return async () => "<p>unused</p>";
      return async (rawContext: unknown) => {
        const context = rawContext as CapabilityDeleteContext;
        mutationSurface = Object.keys(context.mutation);
        const unsafeDelete = context.mutation.delete as (replacementTarget: string) => void;
        unsafeDelete("record-b");
        return "<p>gone</p>";
      };
    };
    const app = createApp({
      capabilityRouter: {
        databases,
        loadHandler,
        loadItemRenderer: async () => {
          itemLoads += 1;
          return () => "<span>unused</span>";
        },
      },
    });

    const response = await app.request("/capability/notes/delete", targetBody("record-a"));

    expect(response.status).toBe(200);
    expect(mutationSurface).toEqual(["delete"]);
    expect(itemLoads).toBe(0);
    expect(databases.readwrite.query('SELECT "id" FROM "cap_notes" ORDER BY "id"').all()).toEqual([
      { id: "record-b" },
    ]);
  });

  test("missing delete stays warm and retargets the modal confirmation error region", async () => {
    const app = createApp({
      capabilityRouter: {
        databases,
        loadHandler:
          async () =>
          async ({ mutation }: CapabilityDeleteContext) => {
            mutation.delete();
            return "<p>gone</p>";
          },
        loadItemRenderer: async () => () => "<span>unused</span>",
      },
    });

    const response = await app.request("/capability/notes/delete", targetBody("missing"));

    expect(response.status).toBe(404);
    expect(response.headers.get("HX-Retarget")).toBe("#notes-delete-error");
    expect(response.headers.get("HX-Reswap")).toBe("innerHTML");
    expect(await response.text()).toMatch(/couldn’t find that entry anymore/i);
    expect(databases.readwrite.query('SELECT "id" FROM "cap_notes" ORDER BY "id"').all()).toEqual([
      { id: "record-a" },
      { id: "record-b" },
    ]);
  });
});
