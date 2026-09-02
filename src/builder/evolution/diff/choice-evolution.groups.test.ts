// The picker's feature set through evolution: the facts a group heading, an option note,
// a retirement, the drawing order and the control itself each buy, and what soft-hide
// freezes. The append-only rules the option values themselves live under are next door in
// `choice-evolution.test.ts`.

import { describe, expect, test } from "bun:test";

import type { CandidateValidationIssue } from "../candidate/candidate-validation.ts";
import {
  type CandidateDraft,
  factsFor,
  groupedJournal,
  journalWithChoice,
  oneGroupJournal,
  rejection,
  shownOnTheCard,
  stageOf,
  validate,
  workFor,
} from "./choice-evolution.test-support.ts";

describe("the picker's groups, its presentation, and the facts together", () => {
  test("grouping the options is View work only, and it no longer fails closed", () => {
    const row = journalWithChoice();
    const diff = workFor(row, (draft) => {
      const stage = stageOf(draft);
      stage.groups = [{ id: "open", heading: "Open" }];
      const option = stage.values?.[0];
      if (option) option.group = "open";
    });
    expect(diff.facts.map((fact) => fact.kind)).toEqual(["choice_option_groups"]);
    expect(diff.workPlan.platformWork).toEqual(["choice_option_grouping"]);
    expect(diff.workPlan.regeneratedUnits).toEqual([]);
  });

  test("rewording a heading is the same fact; moving an option between groups too", () => {
    const grouped = groupedJournal();
    expect(
      factsFor(grouped, (draft) => {
        const groups = stageOf(draft).groups;
        if (groups?.[0]) groups[0].heading = "Still open";
      }),
    ).toEqual(["choice_option_groups"]);
    // Moving the only option out of a group empties it, so the heading goes with it.
    expect(
      factsFor(grouped, (draft) => {
        const stage = stageOf(draft);
        const option = stage.values?.[1];
        if (option) option.group = "open";
        stage.groups = [{ id: "open", heading: "Open" }];
      }),
    ).toEqual(["choice_option_groups"]);
  });

  test("a committed group id cannot be renamed", () => {
    const issues = rejection(groupedJournal(), (draft) => {
      const stage = stageOf(draft);
      stage.groups = [
        { id: "started", heading: "Open" },
        { id: "closed", heading: "Closed" },
      ];
      const option = stage.values?.[0];
      if (option) option.group = "started";
    });
    expect(issues.some((issue) => issue.message.includes("cannot be renamed"))).toBe(true);
  });

  test("a real restructure is admitted — only a rename in place is refused", () => {
    // One group becoming two is not a rename, and neither is emptying one into another.
    // The heuristic that recognizes a rename must not refuse either, or there is no
    // admitted spelling of a change the spec gate is perfectly happy with.
    const split = validate(oneGroupJournal(), (draft) => {
      const stage = stageOf(draft);
      stage.groups = [
        { id: "pending", heading: "Pending" },
        { id: "blocked", heading: "Blocked" },
      ];
      const [first, second] = stage.values ?? [];
      if (first) first.group = "pending";
      if (second) second.group = "blocked";
    });
    expect(split.schema.fields.at(-1)?.groups?.map((group) => group.id)).toEqual([
      "pending",
      "blocked",
    ]);

    const emptied = validate(groupedJournal(), (draft) => {
      const stage = stageOf(draft);
      stage.groups = [{ id: "open", heading: "Open" }];
      const second = stage.values?.[1];
      if (second) second.group = "open";
    });
    expect(emptied.schema.fields.at(-1)?.groups).toHaveLength(1);
  });

  test("a group an option still names cannot be dropped", () => {
    const issues = rejection(groupedJournal(), (draft) => {
      stageOf(draft).groups = [{ id: "open", heading: "Open" }];
    });
    expect(issues.some((issue) => issue.message.includes("is not declared by this field"))).toBe(
      true,
    );
  });
});

describe("the control, and what the card can and cannot see", () => {
  test("changing which control draws a choice is View work only", () => {
    const row = journalWithChoice();
    const diff = workFor(row, (draft) => {
      draft.ui_intent.form.choice_inputs = [{ field: "stage", presentation: "radio" }];
    });
    expect(diff.facts.map((fact) => fact.kind)).toEqual(["choice_presentation"]);
    expect(diff.workPlan.platformWork).toEqual(["choice_input_form_control"]);
    expect(diff.workPlan.regeneratedUnits).toEqual([]);
  });

  test("the facts are independent: one evolution can select every one of them", () => {
    expect(
      factsFor(groupedJournal(), (draft) => {
        const stage = stageOf(draft);
        stage.groups = [
          { id: "closed", heading: "Finished" },
          { id: "open", heading: "Open" },
        ];
        stage.values = [
          { value: "published", label: "Live", group: "closed", disabled: true },
          { value: "draft", label: "Draft", group: "open", note: "not sent yet" },
          { value: "archived", label: "Archived", group: "closed" },
        ];
        draft.ui_intent.form.choice_inputs = [{ field: "stage", presentation: "radio" }];
      }),
    ).toEqual([
      "choice_values",
      "choice_option_disabled",
      "choice_option_labels",
      "choice_option_notes",
      "choice_option_order",
      "choice_option_groups",
      "choice_presentation",
    ]);
  });

  test("the two facts that move the card's value-to-label table regenerate it", () => {
    // The item renderer is handed the value→label pairs and told to present the label, so
    // a copied renderer that has not seen a wording change shows the old word, and one
    // that has not seen an appended value shows the raw wire string.
    const shown = shownOnTheCard(journalWithChoice());
    const relabelled = workFor(shown, (draft) => {
      const option = stageOf(draft).values?.[0];
      if (option) option.label = "Rough draft";
    });
    expect(relabelled.workPlan.regeneratedUnits).toEqual(["item"]);

    const appended = workFor(shown, (draft) => {
      stageOf(draft).values?.push({ value: "archived", label: "Archived" });
    });
    expect([...appended.workPlan.regeneratedUnits].sort()).toEqual(["create", "item", "update"]);
  });

  test("the four facts the card cannot see leave it copied, shown or not", () => {
    const shown = shownOnTheCard(journalWithChoice());
    const edits: Record<string, (draft: CandidateDraft) => void> = {
      note: (draft) => {
        const option = stageOf(draft).values?.[0];
        if (option) option.note = "not sent yet";
      },
      order: (draft) => {
        stageOf(draft).values = [
          { value: "published", label: "Published" },
          { value: "draft", label: "Draft" },
        ];
      },
      groups: (draft) => {
        const stage = stageOf(draft);
        stage.groups = [{ id: "open", heading: "Open" }];
        const option = stage.values?.[0];
        if (option) option.group = "open";
      },
      disabled: (draft) => {
        const option = stageOf(draft).values?.[1];
        if (option) option.disabled = true;
      },
    };
    for (const [what, edit] of Object.entries(edits)) {
      expect([...workFor(shown, edit).workPlan.regeneratedUnits], what).not.toContain("item");
    }
  });
});

describe("soft-hide freezes a choice's whole declaration", () => {
  const hideWith = (edit: (stage: Record<string, unknown>) => void) =>
    rejection(journalWithChoice(), (draft) => {
      const stage = stageOf(draft);
      stage.lifecycle = "inactive";
      draft.ui_intent.form.choice_inputs = [];
      edit(stage as unknown as Record<string, unknown>);
    });

  const frozen = (issues: readonly CandidateValidationIssue[]) =>
    issues.some((issue) => issue.message.includes("may change only its lifecycle"));

  test("a note, a label or a disabled flag added while hiding is refused", () => {
    for (const stray of ["note", "label", "disabled"] as const) {
      expect(
        frozen(
          hideWith((stage) => {
            const option = (stage.values as Record<string, unknown>[])[0] as Record<
              string,
              unknown
            >;
            option[stray] = stray === "disabled" ? true : "moved";
          }),
        ),
        stray,
      ).toBe(true);
    }
  });

  test("grouping the options while hiding is refused too", () => {
    expect(
      frozen(
        hideWith((stage) => {
          stage.groups = [{ id: "open", heading: "Open" }];
          const option = (stage.values as Record<string, unknown>[])[0] as Record<string, unknown>;
          option.group = "open";
        }),
      ),
    ).toBe(true);
  });
});
