// A desk where Notes' shelf is linked to Shelves' name through the real Link route, and every
// evolution of either end is scripted through the engine's fake provider. The scan links
// the oak and pine notes; the birch note names no shelf, and one note holds none. Not a test file.

import {
  capabilityActionUrl,
  capabilityLinkUrl,
  capabilityPickUrl,
  recordAddress,
  unlinkFieldUrl,
} from "#shell/core/routes.js";
import { RECORD_ID_FIELD } from "#shell/core/shell-dom.js";
import { pressFields } from "../../../lifecycle/link/front-half.ts";
import { LINK_TABLE } from "../../../platform/links/link-table.ts";
import { defaultBehavioralErrorsForSchema } from "../../../registry/fields/behavioral-errors.ts";
import { SIXTH_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import {
  type CapabilityRow,
  type CapabilitySpec,
  getCapability,
  type SpecField,
} from "../../../registry/index.ts";
import { notesSpec } from "../../../registry/spec/spec.test-support.ts";
import { saveBody } from "../../../runtime/router/dispatch/links/router.links.test-support.ts";
import { createTestApp } from "../../../server/isolated-app.test-support.ts";
import { noticeCode } from "../../../server/routes/lifecycle/link.test-support.ts";
import {
  activated,
  addCommittedDependency,
  committedGate,
  type EngineEnv,
  type EvolveOptions,
  type EvolveResult,
  evolve,
  setUpCommitted,
  tearDownCommitted,
} from "../run/evolution-run.test-support.ts";

export const SHELF_FIELD: SpecField = {
  name: "shelf",
  label: "Shelf",
  type: "string",
  required: false,
  lifecycle: "active",
  max_length: 64,
};

const NAME_FIELD: SpecField = { ...SHELF_FIELD, name: "name", label: "Name" };

export const LINK_URL = capabilityLinkUrl("notes", "shelf");

/** One capability's spec with `extra` beside its fields, `long_text` naming the long ones. */
export function withField(
  base: CapabilitySpec,
  extra: SpecField,
  longText: readonly string[],
): CapabilitySpec {
  const schema = { fields: [...base.schema.fields, extra] };
  const form = { ...base.ui_intent.form, long_text: [...longText] };
  return {
    ...base,
    schema,
    behavioral_errors: defaultBehavioralErrorsForSchema(schema),
    ui_intent: { ...base.ui_intent, form },
  };
}

/** Notes with its shelf, changed by `change`. */
export function notesWith(change: Partial<SpecField> = {}, longText: readonly string[] = []) {
  return withField(notesSpec(), { ...SHELF_FIELD, ...change }, longText);
}

/** Shelves with its name, changed by `change`. */
export function shelvesWith(change: Partial<SpecField> = {}, longText: readonly string[] = []) {
  const shelves = notesSpec({
    id: "shelves",
    label: "Shelves",
    noun: "shelf",
    plural_noun: "shelves",
    prompt_context: "Stores the shelves of a room.",
  });
  return withField(shelves, { ...NAME_FIELD, ...change }, longText);
}

export interface LinkedDesk {
  readonly env: EngineEnv;
  readonly app: ReturnType<typeof createTestApp>;
}

const SHELVES: readonly (readonly [string, string])[] = [
  ["shelf-oak", "Oak"],
  ["shelf-pine", "Pine"],
  ["shelf-elm", "Elm"],
];

const NOTES: readonly (readonly [string, string])[] = [
  ["note-oak", "Oak"],
  ["note-pine", " pine "],
  ["note-birch", "Birch"],
];

/** A note holding no shelf, which the scan leaves alone, at an address a record id can spell. */
const ADDRESSED_NOTE = "0e0e0e0e-0000-4000-8000-000000000001";

/** Notes and Shelves published and activated, a few records each, and the shelf field linked. */
export async function openLinkedDesk(): Promise<LinkedDesk> {
  const notes = notesWith();
  const env = await setUpCommitted(await committedGate(notes), notes);
  await addCommittedDependency(env, shelvesWith(), SIXTH_INCARNATION_ID);
  for (const [id, name] of SHELVES) {
    env.conns.readwrite.run('INSERT INTO "cap_shelves" ("id", "text", "name") VALUES (?, ?, ?)', [
      id,
      `The ${name.toLowerCase()} shelf`,
      name,
    ]);
  }
  for (const [id, shelf] of NOTES) {
    env.conns.readwrite.run('INSERT INTO "cap_notes" ("id", "text", "shelf") VALUES (?, ?, ?)', [
      id,
      `A note for ${shelf.trim()}`,
      shelf,
    ]);
  }
  env.conns.readwrite.run('INSERT INTO "cap_notes" ("id", "text") VALUES (?, ?)', [
    ADDRESSED_NOTE,
    "A note for no shelf",
  ]);
  const desk = {
    env,
    app: createTestApp({
      capabilityRouter: { databases: env.conns },
      artifactsRoot: env.artifactsRoot,
    }),
  };
  const linked = await press(desk, LINK_URL);
  const answer = await linked.text();
  if (linked.status !== 200 || linkRows(desk).length !== 2) {
    throw new Error(`the shelf field did not link: ${linked.status} ${answer}`);
  }
  return desk;
}

export function closeLinkedDesk(desk: LinkedDesk): void {
  tearDownCommitted(desk.env);
}

export function row(desk: LinkedDesk, id: string): CapabilityRow {
  const found = getCapability(id, desk.env.conns.readonly);
  if (!found) throw new Error(`${id} is not active`);
  return found;
}

/** The press Link's chooser posts for Shelves' name, as both rows stand now. */
export async function press(desk: LinkedDesk, url: string): Promise<Response> {
  return await desk.app.request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(pressFields(row(desk, "notes"), row(desk, "shelves"), "name")),
  });
}

/** The same press on Unlink's route, which the dropdown's broken chain posts. */
export function pressUnlink(desk: LinkedDesk): Promise<Response> {
  return press(desk, unlinkFieldUrl(LINK_URL));
}

/** The notice code of a refused press, read from its answer. */
export async function refusal(response: Response): Promise<[number, string | undefined]> {
  return [response.status, noticeCode(await response.text())];
}

/** Every link row, as the note and the shelf it picked. */
export function linkRows(desk: LinkedDesk): [string, string][] {
  return (
    desk.env.conns.readonly
      .query(`SELECT source_record, target_record FROM ${LINK_TABLE} ORDER BY source_record`)
      .all() as { source_record: string; target_record: string }[]
  ).map((link) => [link.source_record, link.target_record]);
}

/** The id of the shelf named `name`. */
export function shelfNamed(desk: LinkedDesk, name: string): string {
  const found = desk.env.conns.readonly
    .query<{ id: string }, [string]>(`SELECT "id" FROM "cap_shelves" WHERE "name" = ?`)
    .get(name);
  if (!found) throw new Error(`no shelf is named ${name}`);
  return found.id;
}

/** Each note's shelf, by id. */
export function shelfTexts(desk: LinkedDesk): Record<string, unknown> {
  const rows = desk.env.conns.readonly
    .query('SELECT "id", "shelf" FROM "cap_notes" ORDER BY "id"')
    .all() as { id: string; shelf: unknown }[];
  return Object.fromEntries(rows.map(({ id, shelf }) => [id, shelf]));
}

/** Evolve one end to `candidate` through the whole engine, which must activate it. */
export async function evolveTo(
  desk: LinkedDesk,
  candidate: CapabilitySpec,
  buildId: string,
  options: Pick<EvolveOptions, "resolvedIntent" | "link"> = {},
): Promise<EvolveResult> {
  const result = await evolve(desk.env, candidate, `change ${candidate.id}`, {
    buildId,
    behavioralTierEnabled: false,
    active: row(desk, candidate.id),
    ...options,
  });
  activated(result);
  return result;
}

/** Save one record's fields through its capability's update route, as an Edit form posts them. */
export async function saveRecord(
  desk: LinkedDesk,
  capability: string,
  id: string,
  values: Readonly<Record<string, string>>,
  picks: Readonly<Record<string, string>> = {},
): Promise<Response> {
  return await desk.app.request(
    capabilityActionUrl(capability, "update"),
    saveBody({ [RECORD_ID_FIELD]: id, ...values }, picks, Object.keys(values)),
  );
}

/** Create one record through its capability's create route, as its form posts every field. */
export async function createRecord(
  desk: LinkedDesk,
  capability: string,
  values: Readonly<Record<string, string>>,
): Promise<Response> {
  const fields = row(desk, capability).schema.fields;
  const drawn = fields.filter(({ lifecycle }) => lifecycle === "active").map(({ name }) => name);
  return await desk.app.request(
    capabilityActionUrl(capability, "create"),
    saveBody(values, {}, drawn),
  );
}

export async function deleteRecord(
  desk: LinkedDesk,
  capability: string,
  id: string,
): Promise<Response> {
  return await desk.app.request(
    capabilityActionUrl(capability, "delete"),
    saveBody({ [RECORD_ID_FIELD]: id }, {}, []),
  );
}

/**
 * How a note's Edit form draws `field`: a dropdown, the chain, plain text, or not at all. No card
 * carries the form, so it is read at a note's record address.
 */
export async function fieldDrawnAs(desk: LinkedDesk, field = SHELF_FIELD.name) {
  const address = recordAddress("notes", ADDRESSED_NOTE);
  const answer = await desk.app.request(address, { headers: { "HX-Request": "true" } });
  if (answer.status !== 200) throw new Error(`${address} answered ${answer.status}`);
  const html = await answer.text();
  if (html.includes(`data-pick-url="${capabilityPickUrl("notes", field)}"`)) return "dropdown";
  if (html.includes(`data-link-url="${capabilityLinkUrl("notes", field)}"`)) return "chain";
  return html.includes(`name="${field}"`) ? "plain" : "absent";
}

/** The status a note field's dropdown is answered with when it asks for its records. */
export async function pickStatus(desk: LinkedDesk, field = SHELF_FIELD.name): Promise<number> {
  return (await desk.app.request(capabilityPickUrl("notes", field))).status;
}
