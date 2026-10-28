import { describe, expect, test } from "bun:test";
import type { BehavioralTestActionProgress } from "../../builder/index.ts";
import { labelInSentence } from "../../presentation/controls/link/link-copy.ts";
import type { CapabilityTool } from "../../registry/index.ts";
import { validSpec } from "../../registry/spec/spec.test-support.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS,
  BOOKS_INCARNATION,
  deskRow,
  textField,
} from "../../server/routes/lifecycle/link.test-support.ts";
import type { SendBuildEvent } from "../jobs/build-jobs.ts";
import {
  linkedFields,
  narrateBuild,
  PROGRESS_EVENT,
  type ProgressFact,
  plannedStages,
} from "./build-narration.ts";

function recording() {
  const facts: ProgressFact[] = [];
  const send = async (event: string, data: string) => {
    expect(event).toBe(PROGRESS_EVENT);
    facts.push(JSON.parse(data) as ProgressFact);
  };
  return { facts, narration: narrateBuild(send, performance.now()) };
}

describe("a build's narration", () => {
  test("names the thing by its stored nouns and live fields, and the parts its Actions make", async () => {
    const { facts, narration } = recording();
    const spec = validSpec({
      schema: {
        fields: [
          textField("title", "Title"),
          textField("old", "Old shelf", { lifecycle: "inactive" }),
          textField("note", "Note"),
        ],
      },
    });

    await narration.shape(spec);

    expect(facts).toStrictEqual([
      {
        kind: "shape",
        label: spec.label,
        noun: spec.noun,
        plural: spec.plural_noun,
        fields: ["Title", "Note"],
        parts: ["card", "add", "open", "change", "remove", "search"],
      },
    ]);
  });

  test("tells a part being made, remade after a failed check, and made", async () => {
    const { facts, narration } = recording();
    const unit = { kind: "handler", name: "delete" } as const;

    await narration.units.onUnitStart?.({ unit, attempt: 1 });
    await narration.units.onUnitStart?.({ unit, attempt: 2 });

    expect(facts).toStrictEqual([
      { kind: "part", part: "remove", state: "making" },
      { kind: "part", part: "remove", state: "mending" },
    ]);
  });

  test("tells each Action's house rules once as they start and once they are written", async () => {
    const { facts, narration } = recording();
    type Status = BehavioralTestActionProgress["status"];
    const told = (statuses: Partial<Record<CapabilityTool, Status>>) =>
      narration.rules({
        completedActions: 0,
        totalActions: 3,
        actions: Object.entries(statuses).map(([action, status]) => ({
          action: action as CapabilityTool,
          status: status as Status,
          inputDigest: action,
        })),
      });

    await told({ create: "generating", read: "pending", delete: "carried" });
    await told({ create: "generating", read: "generating", delete: "carried" });
    await told({ create: "generated", read: "generating", delete: "carried" });

    expect(facts).toStrictEqual([
      { kind: "rules", part: "add", state: "writing" },
      { kind: "rules", part: "remove", state: "written" },
      { kind: "rules", part: "open", state: "writing" },
      { kind: "rules", part: "add", state: "written" },
    ]);
  });

  test("tells each check as it starts, and a repair from its start to its new bytes", async () => {
    const { facts, narration } = recording();

    narration.gate.onRung?.("structural");
    narration.gate.onRung?.("design-lint");
    narration.gate.onRepair?.(["item"]);
    narration.gate.onRepaired?.();
    await Promise.resolve();

    expect(facts).toStrictEqual([
      { kind: "check", check: "fit" },
      { kind: "check", check: "look" },
      { kind: "stage", stage: "mend" },
      { kind: "part", part: "card", state: "mending" },
      { kind: "stage", stage: "check" },
    ]);
  });

  test("a reader who left cannot fail the Gate it is watching, or the rules being written", async () => {
    const gone = new Error("the stream is gone");
    const rejecting: SendBuildEvent = async () => {
      throw gone;
    };
    const throwing: SendBuildEvent = () => {
      throw gone;
    };
    for (const send of [rejecting, throwing]) {
      const narration = narrateBuild(send, performance.now());
      expect(() => narration.gate.onRung?.("smoke")).not.toThrow();
      expect(() => narration.gate.onRepair?.(["create"])).not.toThrow();
      const writing = { action: "create", status: "generating", inputDigest: "create" } as const;
      await narration.rules({ completedActions: 0, totalActions: 1, actions: [writing] });
    }
    // A rejection nobody caught would surface here, after the microtasks that carry it.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  test("names each connected field once, in the spec's order, as a sentence names it", () => {
    const spec = validSpec({
      noun: "adaptation",
      schema: {
        fields: [
          textField("film", "Film <title>"),
          textField("notes", "Notes"),
          textField("book", "Book & edition"),
        ],
      },
    });
    const books = deskRow(BOOKS);
    const authors = deskRow(AUTHORS);
    const relations = [
      {
        field: "book",
        to: { capability: BOOKS.id, incarnation: BOOKS_INCARNATION, field: "title" },
      },
      {
        field: "film",
        to: { capability: AUTHORS.id, incarnation: AUTHORS_INCARNATION, field: "name" },
      },
    ];

    expect(linkedFields(spec, { relations, flagged: [books, authors] })).toStrictEqual([
      { field: labelInSentence("Film <title>"), target: authors.plural_noun },
      { field: labelInSentence("Book & edition"), target: books.plural_noun },
    ]);
    expect(linkedFields(spec, { relations: [], flagged: [books] })).toStrictEqual([]);
  });

  test("a build that connects nothing says nothing about connecting", async () => {
    const { facts, narration } = recording();

    await narration.connect(validSpec(), { relations: [], flagged: [] });

    expect(facts).toStrictEqual([]);
  });

  test("a build that promised to connect and connected nothing takes the square back", async () => {
    const { facts, narration } = recording();
    const stages = plannedStages({ rules: false, connect: true });

    await narration.plan(stages);
    await narration.connect(validSpec(), { relations: [], flagged: [] });

    expect(facts).toStrictEqual([
      { kind: "plan", stages },
      { kind: "plan", stages: plannedStages({ rules: false, connect: false }) },
    ]);
  });
});
