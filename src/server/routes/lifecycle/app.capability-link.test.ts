import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { capabilityLinkUrl } from "#shell/core/routes.js";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { UNKNOWN_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import { compareAndSwapCapability, getCapability, type Relation } from "../../../registry/index.ts";
import { createReadGateCoordinator } from "../../../runtime/concurrency/read-gates.ts";
import {
  setupRouterTest,
  teardownRouterTest,
} from "../../../runtime/router/dispatch/router.test-support.ts";
import { createTestApp } from "../../isolated-app.test-support.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS,
  deskRow,
  installDesk,
  MEMOS,
  noticeCode,
  offeredOptions,
  READING_LOG,
  SEEDED_AUTHORS,
  storeRelations,
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

function app(deps: Parameters<typeof createTestApp>[0] = {}) {
  return createTestApp({ capabilityRouter: { databases: conns }, ...deps });
}

async function chooser(capability: string, field: string, deps = {}): Promise<Response> {
  return app(deps).request(`${capabilityLinkUrl(capability, field)}?for=probe`);
}

async function offered(capability: string, field: string) {
  return offeredOptions(await (await chooser(capability, field)).text());
}

/** The form a press posts, both ends named as they stand now unless `overrides` says otherwise. */
function pressBody(
  target: { readonly id: string; readonly incarnation: string },
  targetField: string,
  source: { readonly incarnation: string } = BOOKS,
  overrides: Record<string, string> = {},
): URLSearchParams {
  return new URLSearchParams({
    incarnation_id: source.incarnation,
    version: "1",
    target: target.id,
    target_field: targetField,
    target_incarnation_id: target.incarnation,
    target_version: "1",
    ...overrides,
  });
}

async function press(capability: string, field: string, body: URLSearchParams) {
  return app().request(capabilityLinkUrl(capability, field), { method: "POST", body });
}

function relationsOf(capability: string): readonly Relation[] {
  return getCapability(capability, conns.readonly)?.relations ?? [];
}

const AUTHOR_TO_NAME: Relation = {
  field: "author",
  to: { capability: "authors", incarnation: AUTHORS_INCARNATION, field: "name" },
};

describe("linking a field by hand", () => {
  test("the chooser's own press writes the relation, pinning the target's incarnation", async () => {
    const before = getCapability("books", conns.readonly);
    const name = (await offered("books", "author")).find(
      (option) => option.value === "authors.name",
    );
    const response = await press("books", "author", new URLSearchParams(name?.press));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    const after = getCapability("books", conns.readonly);
    expect(after?.relations).toEqual([AUTHOR_TO_NAME]);
    expect(after?.version).toBe(1);
    expect(after?.schema).toEqual(before?.schema);
    expect(after?.ui_intent).toEqual(before?.ui_intent);
    expect(relationsOf("authors")).toEqual([]);
  });

  test("a second field links beside the first", async () => {
    storeRelations(conns, "books", [AUTHOR_TO_NAME]);
    const response = await press("books", "title", pressBody(READING_LOG, "title"));

    expect(response.status).toBe(204);
    expect(relationsOf("books")).toEqual([
      AUTHOR_TO_NAME,
      {
        field: "title",
        to: { capability: "reading_log", incarnation: READING_LOG.incarnation, field: "title" },
      },
    ]);
  });
});

describe("the rules a press is held to, whatever the form sent", () => {
  const refusals: [string, string, string, () => URLSearchParams, string][] = [
    ["long text", "books", "notes", () => pressBody(AUTHORS, "name"), "source_not_linkable"],
    ["a number", "books", "pages", () => pressBody(AUTHORS, "name"), "source_not_linkable"],
    ["a hidden field", "books", "isbn", () => pressBody(AUTHORS, "name"), "source_not_linkable"],
    ["no such field", "books", "nope", () => pressBody(AUTHORS, "name"), "source_not_linkable"],
    ["its own capability", "books", "author", () => pressBody(BOOKS, "title"), "target_is_source"],
    [
      "a long-text target",
      "books",
      "author",
      () => pressBody(AUTHORS, "bio"),
      "target_not_linkable",
    ],
    ["a date target", "books", "author", () => pressBody(AUTHORS, "born"), "target_not_linkable"],
    [
      "a missing target field",
      "books",
      "author",
      () => pressBody(AUTHORS, "x"),
      "target_not_linkable",
    ],
    [
      "a longer target",
      "books",
      "author",
      () => pressBody(READING_LOG, "title"),
      "target_too_long",
    ],
    [
      "an unlimited target",
      "authors",
      "name",
      () => pressBody(READING_LOG, "notes", AUTHORS),
      "target_not_linkable",
    ],
  ];

  for (const [what, capability, field, body, code] of refusals) {
    test(`${what} is refused as ${code}, and nothing is written`, async () => {
      const response = await press(capability, field, body());
      expect(response.status).toBe(422);
      expect(noticeCode(await response.text())).toBe(code);
      expect(relationsOf(capability)).toEqual([]);
    });
  }

  test("a target with no limit cannot fit a field that has one", async () => {
    const response = await press("books", "author", pressBody(MEMOS, "subject"));
    expect(response.status).toBe(422);
    expect(noticeCode(await response.text())).toBe("target_too_long");
  });

  test("a field holds one relation: a second press on it is refused", async () => {
    storeRelations(conns, "books", [AUTHOR_TO_NAME]);
    const response = await press("books", "author", pressBody(AUTHORS, "pen_name"));
    expect(response.status).toBe(422);
    expect(noticeCode(await response.text())).toBe("source_already_linked");
    expect(relationsOf("books")).toEqual([AUTHOR_TO_NAME]);
  });

  test("a target that is itself linked is allowed, and the chain may run on", async () => {
    storeRelations(conns, "books", [AUTHOR_TO_NAME]);
    const response = await press("reading_log", "title", pressBody(BOOKS, "title", READING_LOG));
    expect(response.status).toBe(204);
  });

  test("a relation that would close a loop is refused", async () => {
    storeRelations(conns, "books", [AUTHOR_TO_NAME]);
    const response = await press("authors", "name", pressBody(BOOKS, "author", AUTHORS));
    expect(response.status).toBe(422);
    expect(noticeCode(await response.text())).toBe("link_would_loop");
    expect(relationsOf("authors")).toEqual([]);
  });
});

describe("a press against a desk that moved", () => {
  test("a source at another version is stale, and nothing is written", async () => {
    const response = await press(
      "books",
      "author",
      pressBody(AUTHORS, "name", BOOKS, { version: "2" }),
    );
    expect(response.status).toBe(409);
    expect(noticeCode(await response.text())).toBe("link_stale");
    expect(relationsOf("books")).toEqual([]);
  });

  test("a target of another lifetime is stale", async () => {
    const body = pressBody(AUTHORS, "name", BOOKS, {
      target_incarnation_id: UNKNOWN_INCARNATION_ID,
    });
    const response = await press("books", "author", body);
    expect(response.status).toBe(409);
    expect(noticeCode(await response.text())).toBe("link_stale");
  });

  test("a target that is not on the desk is stale", async () => {
    const response = await press(
      "books",
      "author",
      pressBody({ id: "ghosts", incarnation: UNKNOWN_INCARNATION_ID }, "name"),
    );
    expect(response.status).toBe(409);
    expect(noticeCode(await response.text())).toBe("link_stale");
  });

  test("a press naming no versions was not written by the chooser, and is refused", async () => {
    const forged: Record<string, string>[] = [
      { version: "one" },
      { version: "" },
      { target_version: " " },
      { version: "0x1" },
      { target_version: "1e0" },
      { version: "1.0" },
    ];
    for (const versions of forged) {
      const body = pressBody(AUTHORS, "name", BOOKS, versions);
      const response = await press("books", "author", body);
      expect(response.status).toBe(422);
      expect(noticeCode(await response.text())).toBe("link_unreadable");
    }
    const missing = pressBody(AUTHORS, "name");
    missing.delete("version");
    expect((await press("books", "author", missing)).status).toBe(422);
    expect(relationsOf("books")).toEqual([]);
  });

  test("an evolved target is stale: the press read the version it had", async () => {
    compareAndSwapCapability(
      { ...deskRow(AUTHORS), version: 2 },
      { state: "active", capabilityId: "authors", incarnationId: AUTHORS_INCARNATION, version: 1 },
      conns.readwrite,
    );
    const response = await press("books", "author", pressBody(AUTHORS, "name"));
    expect(response.status).toBe(409);
    expect(relationsOf("books")).toEqual([]);
  });
});

describe("the chooser", () => {
  test("lists every field the clicked one could come from, with a few values, the suggestion first", async () => {
    const options = await offered("books", "author");

    expect(options.map((option) => option.value)).toEqual(["authors.name", "authors.pen_name"]);
    const [suggested, pen] = options;
    expect(suggested?.group).not.toBe(AUTHORS.label);
    expect(suggested?.preview).toBe(SEEDED_AUTHORS.join(", "));
    expect(pen?.group).toBe(AUTHORS.label);
    expect(pen?.preview).toBe("");
  });

  test("leaves out what cannot be picked: too long, long text, not text, hidden, its own fields", async () => {
    const values = (await offered("books", "author")).map((option) => option.value);
    expect(values).not.toContain("reading_log.title");
    expect(values).not.toContain("authors.bio");
    expect(values).not.toContain("authors.born");
    expect(values.filter((value) => value.startsWith("books."))).toEqual([]);
  });

  test("leaves out a target that would close a loop", async () => {
    const values = async () => (await offered("authors", "name")).map((option) => option.value);
    expect(await values()).toContain("books.author");
    storeRelations(conns, "books", [AUTHOR_TO_NAME]);
    expect(await values()).not.toContain("books.author");
  });

  test("a field with no limit is offered every single-line text field there is", async () => {
    const values = (await offered("memos", "subject")).map((option) => option.value);
    expect(values).toEqual([
      "authors.name",
      "authors.pen_name",
      "books.title",
      "books.author",
      "reading_log.title",
    ]);
  });

  test("with nothing that fits, it lists nothing", async () => {
    const response = await chooser("authors", "pen_name");
    expect(response.status).toBe(200);
    expect(offeredOptions(await response.text())).toEqual([]);
  });

  test("a field already linked opens no chooser: the notice says why", async () => {
    storeRelations(conns, "books", [AUTHOR_TO_NAME]);
    const response = await chooser("books", "author");
    expect(response.status).toBe(422);
    expect(noticeCode(await response.text())).toBe("source_already_linked");
  });

  test("a capability that is gone answers stale", async () => {
    const response = await chooser("ghosts", "name");
    expect(response.status).toBe(409);
    expect(noticeCode(await response.text())).toBe("link_stale");
  });

  test("a capability whose read gate is closing is left out, as it cannot be read", async () => {
    const readGates = createReadGateCoordinator();
    readGates.synchronizeCatalog([{ capabilityId: "authors", incarnationId: AUTHORS_INCARNATION }]);
    await readGates.closeAndDrain({ capabilityId: "authors", incarnationId: AUTHORS_INCARNATION });
    const response = await chooser("books", "author", { readGates });
    expect(offeredOptions(await response.text())).toEqual([]);
  });

  test("an id prefix that is not one is refused before anything is read", async () => {
    const response = await app().request(`${capabilityLinkUrl("books", "author")}?for=%22%3E`);
    expect(response.status).toBe(400);
  });
});
