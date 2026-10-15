// A picked value saves as any text does: the notes fixture's text linked
// to Authors · Name, its form drawn by the renderer from the registry row, its dropdown drawn by the
// shipped client reading the real pick route, the pick posted exactly as the form posts it, and the
// row the fixture's own create and update Handlers wrote read back.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { startLinkedFields } from "#shell/controls/linked-field.js";
import { capabilityActionUrl } from "#shell/core/routes.js";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { getCapability, listCapabilities, type Relation } from "../../../../registry/index.ts";
import {
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../../../../runtime/router/dispatch/router.test-support.ts";
import { createTestApp } from "../../../../server/isolated-app.test-support.ts";
import {
  AUTHORS_INCARNATION,
  installDesk,
  storeRelations,
} from "../../../../server/routes/lifecycle/link.test-support.ts";
import { renderCreateForm, renderEditForm } from "../../../fields/field-renderer.ts";
import { renderableFromRow } from "../../../fields/renderable-capability.ts";
import { Doc, type El, parseHtml } from "../../double/choice-picker.test-support.ts";
import { installLinkGlobals, settle } from "../link-control.test-support.ts";
import { partsOf, posted } from "./linked-field.test-support.ts";

installLinkGlobals();

const TEXT_TO_NAME: Relation = {
  field: "text",
  to: { capability: "authors", incarnation: AUTHORS_INCARNATION, field: "name" },
};

let dir: string;
let conns: PlatformDatabase;

beforeEach(() => {
  ({ dir, conns } = setupRouterTest());
  installDesk(conns);
  install(conns, notesRow());
  storeRelations(conns, "notes", [TEXT_TO_NAME]);
});

afterEach(() => {
  teardownRouterTest(dir, conns);
});

/** The notes form `html`, its dropdown started and reading the app's own pick route. */
async function drawn(html: string) {
  const app = createTestApp({ capabilityRouter: { databases: conns } });
  (globalThis as unknown as { fetch: unknown }).fetch = (url: string) => app.request(url);
  const doc = new Doc();
  parseHtml(html, doc);
  startLinkedFields(doc as never);
  await settle();
  const parts = partsOf(doc, "text");
  /** Search for `words`, take the first match, and post the form as it stands. */
  const pickAndSave = async (words: string, action: "create" | "update") => {
    parts.type(words);
    await settle();
    parts.key("Enter");
    const body = new URLSearchParams(posted(parts.root.closest("form") as El));
    return app.request(capabilityActionUrl("notes", action), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  };
  return { ...parts, pickAndSave };
}

const notes = () =>
  renderableFromRow(
    getCapability("notes", conns.readonly) as never,
    listCapabilities(conns.readonly),
  );

const stored = () =>
  conns.readonly.query('SELECT "id", "text" FROM "cap_notes"').all() as {
    id: string;
    text: string;
  }[];

describe("a pick is saved through the generated Handler", () => {
  test("in a new record, the target's text is what the create Handler stores", async () => {
    const form = await drawn(renderCreateForm(notes()));
    const response = await form.pickAndSave("san", "create");
    expect(response.status).toBe(200);
    expect(stored().map((row) => row.text)).toEqual(["Brandon Sanderson"]);
  });

  test("in Edit, a new pick replaces the text the record held, even text no record held", async () => {
    conns.readwrite.run('INSERT INTO "cap_notes" ("id", "text") VALUES (?, ?)', [
      "note-1",
      "Ursula Le Guin",
    ]);
    const form = await drawn(renderEditForm(notes(), { id: "note-1", text: "Ursula Le Guin" }));
    expect(form.line.hidden).toBe(false);
    const response = await form.pickAndSave("le guin", "update");
    expect(response.status).toBe(200);
    expect(stored()).toEqual([{ id: "note-1", text: "Ursula K. Le Guin" }]);
  });
});
