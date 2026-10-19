// The demo desk the Link control is tested on: Books with a title and an author, Authors with a
// name, and Reading Log, whose 300-character title cannot fit a 120-character field. Built as
// registry rows with data tables, the way a committed build leaves them.

import type { MatchingLine } from "../../../lifecycle/link/matching/matching-answer.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import { REGISTRY_TABLE } from "../../../platform/persistence/table-names.ts";
import {
  FIRST_INCARNATION_ID,
  FOURTH_INCARNATION_ID,
  SECOND_INCARNATION_ID,
  THIRD_INCARNATION_ID,
} from "../../../registry/incarnations.test-support.ts";
import type { CapabilityRow, Relation, SpecField } from "../../../registry/index.ts";
import { validSpec } from "../../../registry/spec/spec.test-support.ts";
import { install } from "../../../runtime/router/dispatch/router.test-support.ts";

export const BOOKS_INCARNATION = FIRST_INCARNATION_ID;
export const AUTHORS_INCARNATION = SECOND_INCARNATION_ID;
export const READING_LOG_INCARNATION = THIRD_INCARNATION_ID;

/** A single-line text field unless `extra` says otherwise. */
export function textField(name: string, label: string, extra: Partial<SpecField> = {}): SpecField {
  return { name, label, type: "string", required: false, lifecycle: "active", ...extra };
}

export interface DeskCapability {
  readonly id: string;
  readonly label: string;
  readonly noun: string;
  readonly plural: string;
  readonly incarnation: string;
  readonly fields: readonly SpecField[];
  readonly longText?: readonly string[];
}

/** A registry row as an activation leaves one: version 1, no rename, no relation. */
export function deskRow(capability: DeskCapability): CapabilityRow {
  const spec = validSpec({
    id: capability.id,
    label: capability.label,
    noun: capability.noun,
    plural_noun: capability.plural,
    schema: { fields: [...capability.fields] },
  });
  return {
    ...spec,
    ui_intent: {
      ...spec.ui_intent,
      form: { ...spec.ui_intent.form, long_text: [...(capability.longText ?? [])] },
    },
    incarnation_id: capability.incarnation,
    version: 1,
    artifacts_path: `capabilities/${capability.id}/${capability.incarnation}/v1/`,
    seed: 184206,
    logo: { status: "absent", attempts: 0 },
    display_label_override: null,
    relations: [],
  };
}

export const BOOKS: DeskCapability = {
  id: "books",
  label: "Books",
  noun: "book",
  plural: "books",
  incarnation: BOOKS_INCARNATION,
  fields: [
    textField("title", "Title", { max_length: 300 }),
    textField("author", "Author", { max_length: 120 }),
    textField("notes", "Notes"),
    { name: "pages", label: "Pages", type: "number", required: false, lifecycle: "active" },
    textField("isbn", "ISBN", { lifecycle: "inactive" }),
  ],
  longText: ["notes"],
};

export const AUTHORS: DeskCapability = {
  id: "authors",
  label: "Authors",
  noun: "author",
  plural: "authors",
  incarnation: AUTHORS_INCARNATION,
  fields: [
    textField("name", "Name", { max_length: 120 }),
    textField("pen_name", "Pen name", { max_length: 80 }),
    textField("bio", "Bio"),
    { name: "born", label: "Born", type: "date", required: false, lifecycle: "active" },
  ],
  longText: ["bio"],
};

export const READING_LOG: DeskCapability = {
  id: "reading_log",
  label: "Reading Log",
  noun: "entry",
  plural: "entries",
  incarnation: READING_LOG_INCARNATION,
  fields: [textField("title", "Title", { max_length: 300 }), textField("notes", "Full notes")],
  longText: ["notes"],
};

/** A field with no length limit takes any target, and fits in none that has a limit. */
export const MEMOS: DeskCapability = {
  id: "memos",
  label: "Memos",
  noun: "memo",
  plural: "memos",
  incarnation: FOURTH_INCARNATION_ID,
  fields: [textField("subject", "Subject")],
};

/** The three seeded authors, oldest first: the chooser previews them in this order. */
export const SEEDED_AUTHORS = ["Ursula K. Le Guin", "Octavia E. Butler", "Brandon Sanderson"];

/** Install the desk and seed its records, each a day apart so their order is their age. */
export function installDesk(conns: PlatformDatabase): void {
  for (const capability of [BOOKS, AUTHORS, READING_LOG, MEMOS]) {
    install(conns, deskRow(capability));
  }
  SEEDED_AUTHORS.forEach((name, index) => {
    conns.readwrite.run('INSERT INTO "cap_authors" ("id", "name", "created_at") VALUES (?, ?, ?)', [
      `author-${index}`,
      name,
      `2026-10-0${index + 1}T00:00:00.000Z`,
    ]);
  });
  conns.readwrite.run('INSERT INTO "cap_reading_log" ("id", "title") VALUES (?, ?)', [
    "entry-0",
    "The Dispossessed",
  ]);
}

/** Set a capability's relations in storage directly, as only a test may. */
export function storeRelations(
  conns: Pick<PlatformDatabase, "readwrite">,
  capabilityId: string,
  relations: readonly Relation[],
): void {
  conns.readwrite
    .query(`UPDATE ${REGISTRY_TABLE} SET relations = ? WHERE id = ?`)
    .run(JSON.stringify(relations), capabilityId);
}

/** One option the chooser offered: what it is, and the form a press on it posts. */
export interface OfferedOption {
  readonly value: string;
  readonly label: string;
  readonly preview: string;
  readonly press: string;
  readonly group: string;
}

/** The chooser's options, in the order it lists them, each with the group it stands under. */
export function offeredOptions(html: string): OfferedOption[] {
  const options: OfferedOption[] = [];
  for (const group of html.split('<div role="group"').slice(1)) {
    const heading = /class="listbox__group caps"[^>]*>([^<]*)</.exec(group)?.[1] ?? "";
    for (const match of group.matchAll(
      /<div class="listbox__option"([^>]*)>([^<]*)(<span[^>]*>([^<]*)<\/span>)?/g,
    )) {
      const attributes = match[1] ?? "";
      options.push({
        value: /data-value="([^"]*)"/.exec(attributes)?.[1] ?? "",
        press: unescapeAmpersands(/data-link-press="([^"]*)"/.exec(attributes)?.[1] ?? ""),
        label: match[2] ?? "",
        preview: match[4] ?? "",
        group: heading,
      });
    }
  }
  return options;
}

function unescapeAmpersands(text: string): string {
  return text.replaceAll("&amp;", "&");
}

/** The code a notice names: the rule that refused, or `link_stale`. */
export function noticeCode(html: string): string | undefined {
  return /data-error-code="([^"]*)"/.exec(html)?.[1];
}

/** A written press's answer, line by line as the client reads it: the note, then the report. */
export async function answerLines(response: Response): Promise<MatchingLine[]> {
  const lines = (await response.text()).split("\n").filter((line) => line !== "");
  return lines.map((line) => JSON.parse(line) as MatchingLine);
}
