// Evolving the three declarations 5.10/03 added: which string fields are drawn multi-line,
// what a field says about itself, and how much it holds.
//
// The first two are View facts and buy platform work alone. The third is validation shape,
// so it moves both writing suites' digests — but provably reaches neither Handler, which is
// what lets both be copied. All three have to be *total*: an unexplained difference throws
// before anything is published, so a fact that failed to fire would be caught here rather
// than shipped.

import { describe, expect, test } from "bun:test";

import { type CapabilityRow, capabilitySpecFromRow } from "../../../registry/index.ts";
import { diffCapabilitySpec, UnmappedChangeFactError } from "../../index.ts";
import { type CandidateDraft, journalCapabilityRow } from "../candidate/candidate.test-support.ts";
import { factsFor, rejection, validate, workFor } from "./choice-evolution.test-support.ts";

/** The journal with a limit already committed on its title, so a narrowing has a floor. */
function boundedJournal(max_length = 240): CapabilityRow {
  const base = journalCapabilityRow();
  return journalCapabilityRow({
    schema: {
      fields: base.schema.fields.map((field) =>
        field.name === "title" ? { ...field, max_length } : field,
      ),
    },
  });
}

function titleOf(draft: CandidateDraft) {
  const field = draft.schema.fields.find((candidate) => candidate.name === "title");
  if (!field) throw new Error("the committed title field is missing from the draft");
  return field;
}

describe("long_text is a View fact and nothing more", () => {
  test("naming a field is one fact that buys platform work and regenerates no unit", () => {
    const work = workFor(journalCapabilityRow(), (draft) => {
      draft.ui_intent.form.long_text = ["title"];
    });
    expect(work.facts).toEqual([{ kind: "long_text_input", field: "title" }]);
    expect(work.workPlan.platformWork).toEqual(["long_text_form_control"]);
    expect(work.workPlan.regeneratedUnits).toEqual([]);
    expect(work.workPlan.gate.behavioral.actions).toEqual([]);
  });

  test("taking a field back off the list is the same one fact", () => {
    const committed = journalCapabilityRow({
      ui_intent: {
        ...journalCapabilityRow().ui_intent,
        form: { ...journalCapabilityRow().ui_intent.form, long_text: ["title"] },
      },
    });
    expect(
      factsFor(committed, (draft) => {
        draft.ui_intent.form.long_text = [];
      }),
    ).toEqual(["long_text_input"]);
  });

  test("a candidate naming a field it may not is refused before the Diff runs", () => {
    expect(
      rejection(journalCapabilityRow(), (draft) => {
        draft.ui_intent.form.long_text = ["tags"];
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe("guidance is a View fact and nothing more", () => {
  const withHint = (text: string) => (draft: CandidateDraft) => {
    draft.ui_intent.form.guidance = [{ field: "title", text }];
  };

  test("gaining a hint buys platform copy and regenerates no unit", () => {
    const work = workFor(journalCapabilityRow(), withHint("One line, please."));
    expect(work.facts).toEqual([{ kind: "field_guidance", field: "title" }]);
    expect(work.workPlan.platformWork).toEqual(["field_guidance_copy"]);
    expect(work.workPlan.regeneratedUnits).toEqual([]);
  });

  test("rewording one and losing one are the same fact, so absence and text compare alike", () => {
    const committed = journalCapabilityRow({
      ui_intent: {
        ...journalCapabilityRow().ui_intent,
        form: {
          ...journalCapabilityRow().ui_intent.form,
          guidance: [{ field: "title", text: "One line, please." }],
        },
      },
    });
    expect(factsFor(committed, withHint("Keep it short."))).toEqual(["field_guidance"]);
    expect(
      factsFor(committed, (draft) => {
        draft.ui_intent.form.guidance = [];
      }),
    ).toEqual(["field_guidance"]);
  });

  test("a hint on a field shown on the card still regenerates nothing: it is form-only", () => {
    const work = workFor(journalCapabilityRow(), withHint("What you look for it by."));
    expect(work.workPlan.regeneratedUnits).toEqual([]);
    expect(work.workPlan.gate.designLint).toBe(false);
  });
});

describe("max_length is validation shape, and reaches no Handler", () => {
  test("adding a limit moves both writing suites and copies both writing Handlers", () => {
    const work = workFor(journalCapabilityRow(), (draft) => {
      titleOf(draft).max_length = 240;
    });
    expect(work.facts).toEqual([{ kind: "max_length", field: "title" }]);
    expect(work.workPlan.platformWork).toEqual(["max_length_validation"]);
    // The positive proof ADR-0006 wants: the limit is absent from both Handler prompts, so
    // the copied units provably cannot have gone stale about it.
    expect(work.workPlan.regeneratedUnits).toEqual([]);
    expect(work.workPlan.gate.behavioral.actions).toEqual(["create", "update"]);
  });

  test("raising, lowering and removing a limit are all the same one fact", () => {
    const committed = boundedJournal();
    for (const next of [480, 120, undefined]) {
      expect(
        factsFor(committed, (draft) => {
          if (next === undefined) {
            titleOf(draft).max_length = undefined;
          } else {
            titleOf(draft).max_length = next;
          }
        }),
      ).toEqual(["max_length"]);
    }
  });

  test("an unchanged limit is no fact at all, so a no-op stays a no-op", () => {
    const committed = boundedJournal();
    const diff = diffCapabilitySpec(
      capabilitySpecFromRow(committed),
      validate(committed, () => undefined),
    );
    expect(diff.isNoop).toBe(true);
  });
});

describe("the three facts are total in canonical equality", () => {
  test("a limit change with no fact for it would be caught rather than published", () => {
    // The residual projection blanks `max_length` unconditionally *because* a fact explains
    // it. Comparing an unblanked residual is what the totality check would otherwise see.
    const committed = capabilitySpecFromRow(boundedJournal());
    const candidate = validate(boundedJournal(), (draft) => {
      titleOf(draft).max_length = 120;
    });
    expect(() => diffCapabilitySpec(committed, candidate)).not.toThrow();

    const unmapped = {
      ...candidate,
      subject: "a different drawing entirely",
    };
    expect(() => diffCapabilitySpec(committed, unmapped)).toThrow(UnmappedChangeFactError);
  });

  test("adding and removing the key both survive the residual, not only moving it", () => {
    const bare = capabilitySpecFromRow(journalCapabilityRow());
    const bounded = validate(journalCapabilityRow(), (draft) => {
      titleOf(draft).max_length = 240;
    });
    expect(() => diffCapabilitySpec(bare, bounded)).not.toThrow();
    expect(() =>
      diffCapabilitySpec(
        capabilitySpecFromRow(boundedJournal()),
        validate(boundedJournal(), (draft) => {
          titleOf(draft).max_length = undefined;
        }),
      ),
    ).not.toThrow();
  });
});

describe("soft-hide preserves a limit exactly", () => {
  /** The journal plus one optional bounded field, which a candidate may then hide. */
  function journalWithSummary(): CapabilityRow {
    const base = journalCapabilityRow();
    return journalCapabilityRow({
      schema: {
        fields: [
          ...base.schema.fields,
          {
            name: "summary",
            label: "Summary",
            type: "string",
            required: false,
            lifecycle: "active",
            max_length: 240,
          },
        ],
      },
    });
  }

  const summaryOf = (draft: CandidateDraft) => {
    const field = draft.schema.fields.find((candidate) => candidate.name === "summary");
    if (!field) throw new Error("the committed summary field is missing from the draft");
    return field;
  };

  test("hiding a field may change only its lifecycle, the limit included", () => {
    const issues = rejection(journalWithSummary(), (draft) => {
      const summary = summaryOf(draft);
      summary.lifecycle = "inactive";
      summary.max_length = 120;
    });
    expect(issues.some((issue) => issue.message.includes("may change only its lifecycle"))).toBe(
      true,
    );
  });

  test("hiding it alone, limit untouched, is admitted", () => {
    expect(
      factsFor(journalWithSummary(), (draft) => {
        summaryOf(draft).lifecycle = "inactive";
      }),
    ).toEqual(["field_lifecycle"]);
  });

  test("an already-hidden field must come back byte-identical until it is reactivated", () => {
    const committed = journalCapabilityRow({
      schema: {
        fields: journalCapabilityRow().schema.fields.map((field) =>
          field.name === "archived_reason" ? { ...field, max_length: 240 } : field,
        ),
      },
    });
    const issues = rejection(committed, (draft) => {
      const hidden = draft.schema.fields.find((field) => field.name === "archived_reason");
      if (hidden) hidden.max_length = 120;
    });
    expect(issues.some((issue) => issue.message.includes("must be returned identically"))).toBe(
      true,
    );
  });

  test("a reactivation may change it, and the lifecycle fact unions with the limit fact", () => {
    const committed = journalCapabilityRow({
      schema: {
        fields: journalCapabilityRow().schema.fields.map((field) =>
          field.name === "archived_reason" ? { ...field, max_length: 240 } : field,
        ),
      },
    });
    const facts = factsFor(committed, (draft) => {
      const hidden = draft.schema.fields.find((field) => field.name === "archived_reason");
      if (hidden) {
        hidden.lifecycle = "active";
        hidden.max_length = 480;
      }
      draft.ui_intent.item.shows = ["title", "tags", "archived_reason"];
    });
    expect(facts).toContain("max_length");
    expect(facts).toContain("field_lifecycle");
  });
});

describe("a lifecycle change carries the subset collections with it", () => {
  test("hiding a field names the work of settling its long_text and guidance entries", () => {
    const committed = journalCapabilityRow({
      ui_intent: {
        ...journalCapabilityRow().ui_intent,
        form: {
          ...journalCapabilityRow().ui_intent.form,
          long_text: ["title"],
          guidance: [{ field: "title", text: "One line, please." }],
        },
      },
    });
    const work = workFor(committed, (draft) => {
      const title = titleOf(draft);
      title.lifecycle = "inactive";
      draft.ui_intent.form.long_text = [];
      draft.ui_intent.form.guidance = [];
      draft.ui_intent.item.shows = ["tags"];
      draft.behavioral_errors = [];
    });
    expect(work.facts.map((fact) => fact.kind)).toContain("field_lifecycle");
    expect(work.workPlan.platformWork).toContain("form_subset_intent");
  });

  test("the entries leave with the field rather than being a fact of their own", () => {
    // A hidden field is not drawn at all, so losing its entry is the hide, not a second
    // change. Two facts for one movement would double-count the work it buys.
    const committed = journalCapabilityRow({
      ui_intent: {
        ...journalCapabilityRow().ui_intent,
        form: { ...journalCapabilityRow().ui_intent.form, long_text: ["title"] },
      },
    });
    const facts = factsFor(committed, (draft) => {
      titleOf(draft).lifecycle = "inactive";
      draft.ui_intent.form.long_text = [];
      draft.ui_intent.item.shows = ["tags"];
      draft.behavioral_errors = [];
    });
    expect(facts.filter((kind) => kind === "long_text_input")).toEqual([]);
  });
});
