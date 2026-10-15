// A relation change makes no version: `notes` v1 is published and activated tier-on with frozen
// tests, `shelves` beside it, and its `text` is linked to `shelves.text` through the real chooser
// and route. The row's pointer, every published byte, the model-facing spec views and the frozen
// suite are the same afterwards, and the capability's own routes answer as they did: the one change
// on the page is the chain leaving the linked field.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { capabilityLinkUrl, capabilityPickUrl } from "#shell/core/routes.js";
import { FROZEN_BEHAVIORAL_TEST_FILE } from "../../builder/artifacts/publication/snapshot-contract.ts";
import {
  committedSpecView,
  readFrozenBehavioralTests,
  runCapabilityGate,
  verifyStoredCapabilitySnapshot,
} from "../../builder/index.ts";
import {
  addCommittedDependency,
  committedTierOnGate,
  type EngineEnv,
  HISTORICAL_TEXT,
  INCARNATION_ID,
  setUpCommitted,
  tearDownCommitted,
  versionDirectory,
} from "../../pipeline/evolution/run/evolution-run.test-support.ts";
import { linkableShell } from "../../presentation/controls/link/link-control.ts";
import { renderableFromRow } from "../../presentation/fields/renderable-capability.ts";
import { SIXTH_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import {
  type CapabilityRow,
  capabilitySpecFromRow,
  getCapability,
  type SpecField,
} from "../../registry/index.ts";
import { notesSpec } from "../../registry/spec/spec.test-support.ts";
import { deriveCapabilityTableDdl } from "../../runtime/data/index.ts";
import { formBody } from "../../runtime/router/dispatch/router.test-support.ts";
import { elementsOf } from "../../server/http/served-page.test-support.ts";
import { createTestApp } from "../../server/isolated-app.test-support.ts";

const SHELVES = notesSpec({ id: "shelves", label: "Shelves", prompt_context: "Stores shelves." });
const LINK_URL = capabilityLinkUrl("notes", "text");
const NEW_TEXT = "Written on either side of a link";

let env: EngineEnv;
let app: ReturnType<typeof createTestApp>;
let before: Standing;
let after: Standing;
let linkStatus: number;
let answeredBefore: Answers;
let answeredAfter: Answers;

/** Everything a version is made of, as it stands at one moment. */
interface Standing {
  readonly notes: CapabilityRow;
  readonly shelves: CapabilityRow;
  readonly files: Readonly<Record<string, string>>;
  readonly versions: readonly string[];
  readonly frozen: ReturnType<typeof readFrozenBehavioralTests>;
}

function row(id: string): CapabilityRow {
  const found = getCapability(id, env.conns.readonly);
  if (!found) throw new Error(`${id} is not active`);
  return found;
}

/** Every file under `root`, by path, as a digest of its bytes. */
function digests(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else
        files[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(root);
  return files;
}

function standing(): Standing {
  const notes = row("notes");
  const verified = verifyStoredCapabilitySnapshot(notes.artifacts_path, {
    pluralNoun: notes.plural_noun,
  });
  return {
    notes,
    shelves: row("shelves"),
    files: digests(env.artifactsRoot),
    versions: readdirSync(join(env.artifactsRoot, "notes", INCARNATION_ID)).sort(),
    frozen: readFrozenBehavioralTests(verified),
  };
}

/** What the capability's own routes answer, in an order that leaves the data as it found it. */
interface Answers {
  readonly read: string;
  readonly search: string;
  readonly update: string;
  readonly create: string;
  readonly delete: string;
  readonly statuses: readonly number[];
}

async function exercise(): Promise<Answers> {
  const responses: Response[] = [];
  const answer = async (path: string, init?: RequestInit) => {
    const response = await app.request(path, init);
    responses.push(response);
    return response.text();
  };
  const read = await answer("/capability/notes/read");
  const search = await answer("/capability/notes/search?q=written");
  const update = await answer(
    "/capability/notes/update",
    formBody({ __aluna_record_id: "note-1", text: HISTORICAL_TEXT }),
  );
  const created = await answer("/capability/notes/create", formBody({ text: NEW_TEXT }));
  const id = env.conns.readonly
    .query<{ id: string }, [string]>('SELECT "id" FROM "cap_notes" WHERE "text" = ?')
    .get(NEW_TEXT)?.id;
  if (!id) throw new Error("the create Handler stored nothing");
  const deleted = await answer("/capability/notes/delete", formBody({ __aluna_record_id: id }, []));
  return {
    read,
    search,
    update,
    create: anonymous(created, id),
    delete: anonymous(deleted, id),
    statuses: responses.map((response) => response.status),
  };
}

/** A new record's own id, the seed drawn from it and the second it was made at, made neutral. */
function anonymous(html: string, id: string): string {
  return html
    .replaceAll(id, "<new record>")
    .replace(/data-ink-seed="\d+"/g, 'data-ink-seed="<seed>"')
    .replace(/&quot;created_at&quot;:&quot;[^&]*&quot;/g, "&quot;created_at&quot;:<when>");
}

/**
 * What a page drawn before the link looks like with the field linked: every chain around the
 * field's input in an Edit form is the shell its dropdown is drawn from, written by the same
 * renderer for the row before the link and the row after it.
 */
function unchained(
  html: string,
  rows: { before: CapabilityRow; after: CapabilityRow; target: CapabilityRow },
): string {
  const catalog = [rows.after, rows.target];
  const field = rows.after.schema.fields.find((one) => one.name === "text") as SpecField;
  const inputId = `edit-${rows.after.id}-${field.name}`;
  const inputs = new Set(
    html.match(new RegExp(`<input class="field__input" id="${inputId}"[^>]*>`, "g")),
  );
  let drawn = html;
  for (const input of inputs) {
    const chained = linkableShell(renderableFromRow(rows.before, catalog), field, inputId, input);
    const linked = linkableShell(renderableFromRow(rows.after, catalog), field, inputId, input);
    drawn = drawn.replaceAll(chained, linked);
  }
  return drawn;
}

/** The option the chooser offers for `target`, and what pressing it posts. */
async function pressFor(target: string): Promise<string> {
  const chooser = await app.request(`${LINK_URL}?for=cap-notes-text-link-list`);
  const option = (await elementsOf(await chooser.text())).find(
    (element) => element.attributes.get("data-value") === target,
  );
  const press = option?.attributes.get("data-link-press");
  if (chooser.status !== 200 || !press) throw new Error(`the chooser offers no ${target}`);
  return press;
}

beforeAll(async () => {
  env = await setUpCommitted(await committedTierOnGate());
  await addCommittedDependency(env, SHELVES, SIXTH_INCARNATION_ID);
  app = createTestApp({
    capabilityRouter: { databases: env.conns },
    artifactsRoot: env.artifactsRoot,
  });
  before = standing();
  answeredBefore = await exercise();
  const linked = await app.request(LINK_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: await pressFor("shelves.text"),
  });
  linkStatus = linked.status;
  after = standing();
  answeredAfter = await exercise();
}, 60_000);

afterAll(() => tearDownCommitted(env));

describe("the relation is written in place", () => {
  test("the press is taken, and the relation pins the target's incarnation", () => {
    expect(linkStatus).toBe(204);
    expect(before.notes.relations).toEqual([]);
    expect(after.notes.relations).toEqual([
      {
        field: "text",
        to: { capability: "shelves", incarnation: before.shelves.incarnation_id, field: "text" },
      },
    ]);
    expect(before.shelves.incarnation_id).toBe(SIXTH_INCARNATION_ID);
  });

  test("the row is the row it was, but for its relations, and the target is untouched", () => {
    const { relations: _was, ...rowBefore } = before.notes;
    const { relations: _is, ...rowAfter } = after.notes;
    expect(rowAfter).toEqual(rowBefore);
    expect([after.notes.version, after.notes.incarnation_id, after.notes.artifacts_path]).toEqual([
      1,
      INCARNATION_ID,
      `${versionDirectory(env, 1)}/`,
    ]);
    expect(after.shelves).toEqual(before.shelves);
  });
});

describe("no version is made", () => {
  test("every published byte is the byte it was, and no version directory appears", () => {
    expect(Object.keys(before.files)).toContain(
      join("notes", INCARNATION_ID, "v1", FROZEN_BEHAVIORAL_TEST_FILE),
    );
    expect(after.files).toEqual(before.files);
    expect(after.versions).toEqual(before.versions);
    expect(after.versions.filter((name) => /^v\d+$/.test(name))).toEqual(["v1"]);
  });

  test("the spec a model reads and the one an evolution starts from carry no relation", () => {
    for (const view of [capabilitySpecFromRow, committedSpecView]) {
      expect(view(after.notes)).toEqual(view(before.notes));
      expect(Object.keys(view(after.notes))).not.toContain("relations");
    }
  });

  test("the frozen suite is the one the snapshot verifies, and the one the Gate froze", () => {
    expect(after.frozen).toBeDefined();
    expect(after.frozen).toEqual(before.frozen);
    if (env.gate.behavioral.tier !== "on") throw new Error("expected a tier-on publication");
    expect(after.frozen).toEqual(env.gate.behavioral.frozenTests);
  });

  test("the frozen suite on disk still passes, case for case, on the linked capability", async () => {
    if (env.gate.behavioral.tier !== "on") throw new Error("expected a tier-on publication");
    if (!after.frozen) throw new Error("the snapshot holds no frozen suite");
    const spec = capabilitySpecFromRow(after.notes);
    const unit = (name: string) =>
      readFileSync(join(versionDirectory(env, 1), `${name}.ts`), "utf8");
    const handlers = Object.fromEntries(
      spec.tools.map((action) => [action, unit(action)] as const),
    );
    const rerun = await runCapabilityGate({
      spec,
      ddl: deriveCapabilityTableDdl(spec),
      handlers,
      itemRenderer: unit("item"),
      behavioralTier: {
        enabled: true,
        frozen: {
          frozenTests: after.frozen,
          generation: env.gate.behavioral.testGen,
        },
      },
    });
    if (rerun.behavioral.tier !== "on") throw new Error("the rerun skipped the frozen suite");
    const cases = (run: typeof rerun.behavioral) =>
      run.tier === "on"
        ? run.testRun.cases.map(({ action, name, status }) => ({ action, name, status }))
        : [];
    expect(cases(rerun.behavioral).length).toBeGreaterThan(0);
    expect(cases(rerun.behavioral)).toEqual(cases(env.gate.behavioral));
  }, 60_000);
});

describe("Handlers and cards run as they did", () => {
  test("every route answers with the status it gave before", () => {
    expect(answeredAfter.statuses).toEqual(answeredBefore.statuses);
    expect(answeredAfter.statuses.every((status) => status === 200)).toBe(true);
  });

  test("read, search, update, create and delete draw what they drew, the chain now a dropdown's", () => {
    const routes = ["read", "search", "update", "create", "delete"] as const;
    for (const route of routes) {
      expect(answeredAfter[route]).toBe(
        unchained(answeredBefore[route], {
          before: before.notes,
          after: after.notes,
          target: after.shelves,
        }),
      );
    }
  });

  test("the chain was there to go: the linked field's Edit forms lost it, and nothing else did", () => {
    expect(answeredBefore.read).toContain(`data-link-url="${LINK_URL}"`);
    expect(answeredAfter.read).not.toContain("data-link-control");
    expect(answeredAfter.read).toContain(`data-pick-url="${capabilityPickUrl("notes", "text")}"`);
    expect(
      unchained(answeredBefore.read, {
        before: before.notes,
        after: after.notes,
        target: after.shelves,
      }),
    ).not.toBe(answeredBefore.read);
  });
});
