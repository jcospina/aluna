import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createApp } from "../../../app/app.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { CapabilityRow } from "../../../registry/index.ts";
import type {
  CapabilityCreateContext,
  CapabilityDeleteContext,
  CapabilityUpdateContext,
} from "../contract.ts";
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

  test("missing delete stays warm and retargets the confirmation's error region", async () => {
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

describe("deterministic capability router — mutation transaction integrity", () => {
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

  test("rolls back every canonical mutation when its Handler fails after writing", async () => {
    const loadHandler: HandlerLoader = async (_path, action) => {
      if (action === "create") {
        return async ({ mutation, present }: CapabilityCreateContext) =>
          present(mutation.create({ text: "Third", pinned: false }));
      }
      if (action === "update") {
        return async ({ mutation, present }: CapabilityUpdateContext) =>
          present(mutation.update({ text: "Must roll back" }));
      }
      if (action === "delete") {
        return async ({ mutation }: CapabilityDeleteContext) => {
          mutation.delete();
          throw new Error("post-delete Handler failure");
        };
      }
      return async () => "<p>unused</p>";
    };
    const app = createApp({
      capabilityRouter: {
        databases,
        loadHandler,
        loadItemRenderer: async () => () => {
          throw new Error("post-write presentation failure");
        },
      },
    });

    const create = await app.request("/capability/notes/create", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["text", "Third"],
        ["__aluna_present", "text"],
        ["__aluna_present", "pinned"],
      ]).toString(),
    });
    expect(create.status).toBe(500);
    expect(create.headers.get("HX-Retarget")).toBe("#notes-create-error");
    expect(await create.text()).toContain('data-error-code="mutation_failed"');

    const update = await app.request(
      "/capability/notes/update",
      targetBody("record-a", [
        ["text", "Must roll back"],
        ["__aluna_present", "text"],
      ]),
    );
    expect(update.status).toBe(500);
    expect(update.headers.get("HX-Retarget")).toBe("#notes-edit-error");

    const remove = await app.request("/capability/notes/delete", targetBody("record-a"));
    expect(remove.status).toBe(500);
    expect(remove.headers.get("HX-Retarget")).toBe("#notes-delete-error");

    expect(
      databases.readwrite
        .query('SELECT "id", "text", "pinned" FROM "cap_notes" ORDER BY "id"')
        .all(),
    ).toEqual([
      { id: "record-a", text: "First", pinned: 0 },
      { id: "record-b", text: "Second", pinned: 1 },
    ]);
  });
});

describe("deterministic capability router — the Handler's returned fragment", () => {
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

  function appReturning(fragment: string) {
    const loadHandler: HandlerLoader = async () => async () => fragment;
    return createApp({
      capabilityRouter: {
        databases,
        loadHandler,
        loadItemRenderer: async () => () => "<p>item</p>",
      },
    });
  }

  function createRequest(): RequestInit {
    return {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["text", "Third"],
        ["__aluna_present", "text"],
        ["__aluna_present", "pinned"],
      ]).toString(),
    };
  }

  // The wrapper markup a Handler composes around its items is served as written, and htmx
  // swaps it into a live page with `allowScriptTags` on. The enforcer never saw it.
  test("strips executable markup from the wrapper a Handler composes", async () => {
    const app = appReturning(
      '<div><script>window.stolen = 1;</script><p onclick="alert(1)">hi</p>' +
        '<a href="javascript:alert(1)">l</a></div>',
    );

    const response = await app.request("/capability/notes/read");

    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).not.toContain("<script");
    expect(body).not.toContain("onclick");
    expect(body).not.toContain("javascript:");
    expect(body).toContain("<p>hi</p>");
  });

  test("leaves a conforming fragment byte-identical", async () => {
    const fragment =
      '<form hx-post="/capability/notes/create" hx-swap="none">' +
      '<input name="text" value="a &amp; b"><button type="submit">Add</button></form>';

    expect(await (await appReturning(fragment).request("/capability/notes/read")).text()).toBe(
      fragment,
    );
  });

  // AC5 of 5.10/04. A capability-declared refusal used to be a bare 200 against a form
  // declaring `hx-swap="none"` — swapped nowhere, and read by the client as a commit.
  test("delivers a declared behavioral-error fragment as a refusal, not a commit", async () => {
    const refusal =
      '<p class="notice" data-role="error" data-error-code="missing_required_fields" ' +
      'data-error-fields="text">I still need a little more before I can add this.</p>';
    const app = appReturning(refusal);

    const response = await app.request("/capability/notes/create", createRequest());

    expect(response.status).toBe(422);
    expect(response.headers.get("HX-Retarget")).toBe("#notes-create-error");
    expect(response.headers.get("HX-Reswap")).toBe("innerHTML");
    // The Handler wrote the sentence; the platform did not rewrite it.
    expect(await response.text()).toBe(refusal);
  });

  test("a code the spec never declared is not a refusal", async () => {
    const app = appReturning(
      '<p data-role="error" data-error-code="not_in_the_spec">Something</p>',
    );

    const response = await app.request("/capability/notes/create", createRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("HX-Retarget")).toBeNull();
  });

  test("a declared refusal on a read is answered as content, not as a form refusal", async () => {
    const app = appReturning(
      '<p data-role="error" data-error-code="missing_required_fields">n/a</p>',
    );

    // Only a mutation has a form error region to retarget into.
    expect((await app.request("/capability/notes/read")).status).toBe(200);
  });
});

describe("deterministic capability router — nothing is held while the body arrives", () => {
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

  /**
   * A create whose body is still being written. The request is real — Bun streams it — so
   * the route is genuinely parked inside `formData()`.
   */
  function slowCreate(): { request: Request; finish: () => void } {
    let release!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("text=Third&__aluna_present=text"));
        release = () => {
          controller.enqueue(encoder.encode("&__aluna_present=pinned"));
          controller.close();
        };
      },
    });
    // `duplex` is required for a streaming request body and is not in the DOM lib's
    // `RequestInit`, so the init is widened rather than the property suppressed.
    const request = new Request("http://localhost/capability/notes/create", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      duplex: "half",
    } as RequestInit);
    return { request, finish: () => release() };
  }

  // The route used to take read tokens, then the record-write lease, then
  // `BEGIN IMMEDIATE`, and only then read the body. One socket held open that way refused
  // every record write on every capability, queued every build, and made the capability
  // undeletable, because the deletion drain waits for a reader that is waiting for a socket.
  test("a request whose body is still arriving holds no write lease", async () => {
    const app = createApp({
      capabilityRouter: {
        databases,
        loadHandler: (async () => async () => "<p>ok</p>") as HandlerLoader,
        loadItemRenderer: async () => () => "<p>item</p>",
      },
    });

    const { request, finish } = slowCreate();
    let settled = false;
    const pending = Promise.resolve(app.request(request)).then((response) => {
      settled = true;
      return response;
    });
    // Give the route every chance to reach the point where it used to take the lease.
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Without this the test proves nothing: the whole point is that the first route is
    // parked mid-body while the second one runs.
    expect(settled).toBe(false);

    const concurrent = await app.request("/capability/notes/create", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["text", "Second writer"],
        ["__aluna_present", "text"],
        ["__aluna_present", "pinned"],
      ]).toString(),
    });

    expect(concurrent.status).toBe(200);
    expect(await concurrent.text()).not.toContain("mutation_busy");

    finish();
    expect((await pending).status).toBe(200);
  });
});
