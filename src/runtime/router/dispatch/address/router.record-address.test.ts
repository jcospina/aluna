// The record address, `GET /capability/:id/:record` (ADR-0010; Module 7 PLAN decisions 41 to 43).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PROMPT_NOTICE_ID } from "#shell/core/shell-dom.js";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { RECORD_TEMPLATE_ID_PREFIX } from "../../../../presentation/index.ts";
import type { CapabilityRow } from "../../../../registry/index.ts";
import { NOT_FOUND_NOTICE } from "../../../../server/http/index.ts";
import { createTestApp } from "../../../../server/isolated-app.test-support.ts";
import { createReadGateCoordinator } from "../../../concurrency/read-gates.ts";
import { NOT_FOUND_FRAGMENT } from "../../wire/failure-responses.ts";
import {
  createCapabilityDataTool,
  formBody,
  install,
  notesRow,
  rowSpec,
  setupRouterTest,
  teardownRouterTest,
} from "../router.test-support.ts";
import type { CapabilityRouterDeps } from "../router.ts";

const IN_PAGE = { headers: { "HX-Request": "true" } };

/** The record view inside a record address's fragment, without the surface around it. */
function viewOf(fragment: string): string {
  return fragment.slice(fragment.indexOf("\n") + 1, fragment.lastIndexOf("\n"));
}

/** The record view a card's `<template>` holds, as the `read` Handler presented it. */
function templatedView(cards: string, capabilityId: string, recordId: string): string {
  const opening = `<template id="${RECORD_TEMPLATE_ID_PREFIX}-${capabilityId}-${recordId}">`;
  const from = cards.indexOf(opening);
  if (from < 0) throw new Error(`no template for ${recordId}`);
  return cards.slice(from + opening.length, cards.indexOf("</template>", from));
}

/** The prompt bar's notice slot, as a page carries it. */
function noticeOn(page: string): string {
  const slot = new RegExp(`<div id="${PROMPT_NOTICE_ID}"[^>]*>([^<]*)</div>`).exec(page);
  if (!slot) throw new Error("the page carries no prompt notice slot");
  return slot[1] ?? "";
}

/** A scratch database with the notes fixture installed, fresh for every case. */
function useNotesRouter() {
  const scratch: { dir?: string; conns?: PlatformDatabase } = {};
  beforeEach(() => {
    Object.assign(scratch, setupRouterTest());
    install(conns(), notesRow());
  });
  afterEach(() => {
    if (scratch.dir && scratch.conns) teardownRouterTest(scratch.dir, scratch.conns);
  });
  const conns = (): PlatformDatabase => {
    if (!scratch.conns) throw new Error("the notes router is used outside a test");
    return scratch.conns;
  };
  return {
    conns,
    /** Start again on an empty scratch database, with `row` installed instead. */
    reinstall: (row: CapabilityRow) => {
      if (scratch.dir && scratch.conns) teardownRouterTest(scratch.dir, scratch.conns);
      Object.assign(scratch, setupRouterTest());
      install(conns(), row);
    },
    app: (deps: Partial<CapabilityRouterDeps> = {}) =>
      createTestApp({ capabilityRouter: { databases: conns(), ...deps } }),
    save: (text: string, row: CapabilityRow = notesRow()) =>
      String(createCapabilityDataTool(rowSpec(row), conns()).insert({ text }).id),
  };
}

describe("the record address", () => {
  const { app, conns, reinstall, save } = useNotesRouter();

  test("answers the record view a card press opens, under HX-Request", async () => {
    const id = save("Buy figs");
    save("Another note");
    const response = await app().request(`/capability/notes/${id}`, IN_PAGE);
    const fragment = await response.text();
    expect(response.status).toBe(200);
    expect(fragment).toStartWith('<section class="capability-surface"');
    expect(fragment).toContain('data-active-capability-id="notes"');
    const cards = await (await app().request("/capability/notes/read", IN_PAGE)).text();
    expect(viewOf(fragment)).toBe(templatedView(cards, "notes", id));
    expect(fragment).not.toContain("Another note");
    expect(fragment).not.toContain("<!doctype html>");
  });

  test("answers the whole desk, never stored, without HX-Request", async () => {
    const id = save("Buy figs");
    const response = await app().request(`/capability/notes/${id}`);
    const page = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(page.toLowerCase()).toStartWith("<!doctype html>");
    expect(page).not.toContain("Buy figs");
    expect(noticeOn(page)).toBe("");
  });

  test("reads the id in lower case, as `randomUUID()` writes it", async () => {
    const id = save("Buy figs");
    const lower = await (await app().request(`/capability/notes/${id}`, IN_PAGE)).text();
    const upper = await app().request(`/capability/notes/${id.toUpperCase()}`, IN_PAGE);
    expect(upper.status).toBe(200);
    expect(await upper.text()).toBe(lower);
  });

  test("carries no inactive field and no `extra`", async () => {
    const schema = {
      fields: [
        ...notesRow().schema.fields,
        {
          name: "mood",
          label: "Mood",
          type: "string" as const,
          required: false,
          lifecycle: "inactive" as const,
        },
      ],
    };
    reinstall(notesRow({ schema }));
    const id = save("Buy figs", notesRow({ schema }));
    conns().readwrite.run(`UPDATE "cap_notes" SET "mood" = ?, "extra" = ? WHERE "id" = ?`, [
      "INACTIVE-VALUE",
      JSON.stringify({ hidden: "EXTRA-VALUE" }),
      id,
    ]);
    const fragment = await (await app().request(`/capability/notes/${id}`, IN_PAGE)).text();
    expect(fragment).toContain("Buy figs");
    expect(fragment).not.toContain("INACTIVE-VALUE");
    expect(fragment).not.toContain("EXTRA-VALUE");
    expect(fragment).not.toContain('name="mood"');
  });
});

describe("a record address naming nothing", () => {
  const { app, conns, save } = useNotesRouter();

  test("a record that is not there opens nothing in the window and answers 404", async () => {
    const deleted = save("Gone");
    conns().readwrite.run(`DELETE FROM "cap_notes" WHERE "id" = ?`, [deleted]);
    for (const record of [deleted, randomUUID(), "00000000-0000-0000-0000-000000000000"]) {
      const inPage = await app().request(`/capability/notes/${record}`, IN_PAGE);
      expect(inPage.status).toBe(404);
      expect(await inPage.text()).toBe(NOT_FOUND_FRAGMENT);
      const page = await app().request(`/capability/notes/${record}`);
      expect(page.status).toBe(404);
      expect(page.headers.get("cache-control")).toBe("no-store");
      // The desk asks for the record itself and that answer says the notice, so it is said once.
      expect(noticeOn(await page.text())).toBe("");
    }
  });

  test("another capability's record is not there", async () => {
    const recipes = notesRow({ id: "recipes", label: "Recipes" });
    install(conns(), recipes);
    const theirs = save("Theirs", recipes);
    const response = await app().request(`/capability/notes/${theirs}`, IN_PAGE);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Theirs");
    expect((await app().request(`/capability/recipes/${theirs}`, IN_PAGE)).status).toBe(200);
  });

  test("an unknown capability still gives the bare desk", async () => {
    const record = randomUUID();
    const inPage = await app().request(`/capability/ghosts/${record}`, IN_PAGE);
    expect(inPage.status).toBe(404);
    expect(await inPage.text()).toBe(NOT_FOUND_FRAGMENT);
    const page = await app().request(`/capability/ghosts/${record}`);
    expect(page.status).toBe(404);
    expect(noticeOn(await page.text())).toBe(NOT_FOUND_NOTICE);
  });

  test("answers 409 while its capability's read gate closes, as the collection does", async () => {
    const id = save("Buy figs");
    const readGates = createReadGateCoordinator();
    const gated = app({ readGates });
    expect((await gated.request(`/capability/notes/${id}`, IN_PAGE)).status).toBe(200);
    expect(readGates.snapshot()[0]?.readerCount).toBe(0);
    const closing = await readGates.closeAndDrain({
      capabilityId: "notes",
      incarnationId: notesRow().incarnation_id,
    });
    for (const init of [IN_PAGE, {}]) {
      expect((await gated.request(`/capability/notes/${id}`, init)).status).toBe(409);
      expect((await gated.request("/capability/notes", init)).status).toBe(409);
    }
    expect(readGates.reopen(closing)).toBe(true);
  });
});

describe("the record address beside the Action routes", () => {
  const { app, conns, save } = useNotesRouter();
  let id: string;
  const request = (path: string, init?: RequestInit) => app().request(path, init);

  beforeEach(() => {
    id = save("Buy figs");
  });

  test("the Action names keep their route", async () => {
    const read = await request("/capability/notes/read", IN_PAGE);
    expect(read.status).toBe(200);
    expect(await read.text()).toContain(`id="${RECORD_TEMPLATE_ID_PREFIX}-notes-${id}"`);
    const search = await request("/capability/notes/search?q=figs", IN_PAGE);
    expect(search.status).toBe(200);
    expect(await search.text()).toContain(`id="${RECORD_TEMPLATE_ID_PREFIX}-notes-${id}"`);
    const created = await request("/capability/notes/create", formBody({ text: "Plant figs" }));
    expect(created.status).toBe(200);
  });

  test("a segment not shaped like a record id answers the Action route's 404, as before", async () => {
    const near = [
      `${id}x`,
      id.slice(0, -1),
      id.replaceAll("-", ""),
      `{${id}}`,
      `${id.slice(0, -1)}g`,
      `${id}%27%20OR%201=1--`,
      "garbage",
      "%27%3B%20DROP%20TABLE%20cap_notes%3B--",
    ];
    for (const segment of near) {
      const response = await request(`/capability/notes/${segment}`, IN_PAGE);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(NOT_FOUND_FRAGMENT);
    }
    expect(conns().readonly.query(`SELECT COUNT(*) AS n FROM "cap_notes"`).get()).toEqual({ n: 1 });
  });

  test("a trailing slash is the same record, and anything deeper is not a record address", async () => {
    const record = await (await request(`/capability/notes/${id}`, IN_PAGE)).text();
    const slashed = await request(`/capability/notes/${id}/`, IN_PAGE);
    expect(slashed.status).toBe(200);
    expect(await slashed.text()).toBe(record);
    const page = await request(`/capability/notes/${id}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    for (const deeper of [`${id}/read`, `${id}//`, `${id}/${id}`]) {
      const response = await request(`/capability/notes/${deeper}`, IN_PAGE);
      expect(response.status).toBe(404);
    }
  });

  test("only a GET opens a record", async () => {
    const post = await request(`/capability/notes/${id}`, { method: "POST", ...IN_PAGE });
    const garbage = await request("/capability/notes/garbage", { method: "POST", ...IN_PAGE });
    expect(post.status).toBe(garbage.status);
    expect(await post.text()).toBe(await garbage.text());
  });
});
