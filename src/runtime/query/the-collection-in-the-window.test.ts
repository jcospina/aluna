// What the window standing open does to a turn's prompt, and what it must not do (PLAN decision
// 28; issue 6.6/01).
//
// The claim is about one prompt rather than about a whole question, so these read the prompt the
// next turn would be built from. What the open collection reaches a real loop through is proved
// where the intent arrives, in `src/pipeline/query/data-query.test.ts`.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { canonicalCapabilityLabel, getCapability, renameCapability } from "../../registry/index.ts";
import {
  catalogueWithRecords,
  EXPENSES_TABLE,
  NOTES_CAPABILITY,
  NOTES_TABLE,
  nextPrompt,
  registeredSpecs,
} from "./question.test-support.ts";
import { QUESTION_OPEN_WINDOW_HEADING, QUESTION_OPEN_WINDOW_RULES } from "./question-turn.ts";
import { createScratchPlatforms, type ScratchPlatforms } from "./read-scope.test-support.ts";

let platforms: ScratchPlatforms;

beforeEach(() => {
  platforms = createScratchPlatforms();
});

afterEach(() => {
  platforms.disposeAll();
});

/** The prompt a first turn would be built from, on a desk holding Notes and Expenses. */
function promptWith(openCapability: string | null, rename?: (database: Database) => void): string {
  const platform = platforms.migrated();
  catalogueWithRecords(platform.database.readwrite);
  rename?.(platform.database.readwrite);
  return nextPrompt(
    "how many did I add this month?",
    registeredSpecs(platform.database.readonly),
    [],
    openCapability,
  );
}

/** The line a standing window puts in a prompt, as a reader would see it. */
function windowLine(label: string): string {
  return `\n\n${QUESTION_OPEN_WINDOW_HEADING} ${label}`;
}

describe("the collection standing in the window", () => {
  test("is named to the model, beside the rules for what it is and is not", () => {
    const prompt = promptWith(NOTES_CAPABILITY.id);

    expect(prompt).toContain(windowLine(NOTES_CAPABILITY.label));
    for (const rule of QUESTION_OPEN_WINDOW_RULES) expect(prompt).toContain(rule);
  });

  test("narrows nothing: take the line away and the prompt is the one asked with nothing open", () => {
    const prompt = promptWith(NOTES_CAPABILITY.id);

    expect(prompt).toContain(`table: ${NOTES_TABLE}`);
    expect(prompt).toContain(`table: ${EXPENSES_TABLE}`);
    expect(prompt.replace(windowLine(NOTES_CAPABILITY.label), "")).toBe(promptWith(null));
  });

  test("is absent from a question asked with nothing standing", () => {
    expect(promptWith(null)).not.toContain(QUESTION_OPEN_WINDOW_HEADING);
  });

  test("is absent when the resolver named a capability this desk does not have", () => {
    // A capability deleted between the classification and the read, or an id the model invented.
    // Saying nothing is the honest ending: there is no collection for the loose words to point at.
    expect(promptWith("recipes")).not.toContain(QUESTION_OPEN_WINDOW_HEADING);
  });

  test("is named by the word the person renamed it to, in the window and in the list alike", () => {
    // The line is a co-reference anchor: the person asks with the word on their own desk, so the
    // name beside it has to be that word. `label` is what the model called it when it was built.
    const renamed = "Journal";
    const prompt = promptWith(NOTES_CAPABILITY.id, (database) => {
      const row = getCapability(NOTES_CAPABILITY.id, database);
      if (!row) throw new Error("the fixture registers Notes before it renames it");
      expect(canonicalCapabilityLabel(row)).toBe(NOTES_CAPABILITY.label);
      renameCapability(
        {
          capabilityId: row.id,
          incarnationId: row.incarnation_id,
          version: row.version,
          previousOverride: null,
        },
        renamed,
        database,
      );
    });

    expect(prompt).toContain(windowLine(renamed));
    expect(prompt).toContain(`- ${renamed} —`);
    expect(prompt).not.toContain(NOTES_CAPABILITY.label);
  });
});
