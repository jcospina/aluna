// The Diff Engine table battery — Module 4.6/02 (PLAN decisions 21, 22, 37 and
// the normative change-fact matrix). One test per matrix row's fact→work mapping,
// including every None column; the monotone multi-fact union; the canonical no-op
// (key/set reorder) versus the ordered-product diffs (field order, item/detail
// shows); and the fail-closed unknown-difference guard. Pure: no db, no provider.

import { describe, expect, test } from "bun:test";
import type { CapabilityRow, CapabilitySpec } from "../registry/index.ts";
import {
  type CandidateDraft,
  candidateFrom,
  journalCapabilityRow,
} from "./candidate.test-support.ts";
import {
  type CapabilityDiff,
  committedSpecView,
  diffCapabilitySpec,
  UnmappedChangeFactError,
} from "./index.ts";

// Diff a candidate — the committed journal spec after `mutate` — against its
// committed baseline. `base` overrides the committed row for the few rows that
// need a different starting shape (an active field outside item.shows, extra deps).
function diffOf(
  mutate: (draft: CandidateDraft) => void,
  base: CapabilityRow = journalCapabilityRow(),
): CapabilityDiff {
  const committed = committedSpecView(base);
  const draft = candidateFrom(base);
  mutate(draft);
  return diffCapabilitySpec(committed, draft as unknown as CapabilitySpec);
}

function factKinds(diff: CapabilityDiff): readonly string[] {
  return diff.facts.map((fact) => fact.kind);
}

function activeField(name: string, type: string, required = false) {
  return { name, label: `${name} label`, type, required, lifecycle: "active" };
}

describe("the identity/interface rows never diff (validation froze them)", () => {
  test("an identical candidate is the canonical no-op — zero facts, no work, no gate", () => {
    const diff = diffOf(() => {});
    expect(diff.isNoop).toBe(true);
    expect(diff.facts).toEqual([]);
    expect(diff.workPlan.regeneratedUnits).toEqual([]);
    expect(diff.workPlan.platformWork).toEqual([]);
    expect(diff.workPlan.gate).toEqual({
      structural: false,
      smoke: false,
      designLint: false,
      behavioral: { actions: [], fullSuite: false },
    });
  });
});

describe("capability label → registry/View copy, no units, no tests", () => {
  test("a changed label selects registry copy only", () => {
    const diff = diffOf((draft) => {
      draft.label = "Diary";
    });
    expect(factKinds(diff)).toEqual(["capability_label"]);
    expect(diff.workPlan.platformWork).toEqual(["registry_and_view_copy"]);
    expect(diff.workPlan.regeneratedUnits).toEqual([]);
    expect(diff.workPlan.gate.behavioral).toEqual({ actions: [], fullSuite: false });
  });
});

describe("prompt_context → resolver catalog, no units", () => {
  test("changed prompt_context selects the resolver catalog only", () => {
    const diff = diffOf((draft) => {
      draft.prompt_context = "Now also stores mood entries.";
    });
    expect(factKinds(diff)).toEqual(["prompt_context"]);
    expect(diff.workPlan.platformWork).toEqual(["resolver_catalog"]);
    expect(diff.workPlan.regeneratedUnits).toEqual([]);
  });
});

describe("field order only → platform form/list-input order, selects nothing", () => {
  test("reordering existing fields is a field_order fact with no unit or test work", () => {
    const diff = diffOf((draft) => {
      draft.schema.fields = [...draft.schema.fields].reverse();
    });
    expect(factKinds(diff)).toEqual(["field_order"]);
    expect(diff.workPlan.platformWork).toEqual(["platform_field_order"]);
    expect(diff.workPlan.regeneratedUnits).toEqual([]);
    expect(diff.workPlan.gate.behavioral).toEqual({ actions: [], fullSuite: false });
  });
});

describe("new active field → ADD COLUMN + writes; search only for text/list-text", () => {
  test("a new string field adds create/update/search units and tests", () => {
    const diff = diffOf((draft) => {
      draft.schema.fields.push(activeField("mood", "string"));
    });
    expect(diff.facts).toEqual([{ kind: "new_active_field", field: "mood", fieldType: "string" }]);
    expect(diff.workPlan.platformWork).toEqual(["add_column", "platform_form_detail"]);
    expect(diff.workPlan.regeneratedUnits).toEqual(["create", "update", "search"]);
    expect(diff.workPlan.gate.behavioral).toEqual({
      actions: ["create", "update", "search"],
      fullSuite: false,
    });
  });

  test("a new number field adds create/update only — no search", () => {
    const diff = diffOf((draft) => {
      draft.schema.fields.push(activeField("rating", "number"));
    });
    expect(diff.workPlan.regeneratedUnits).toEqual(["create", "update"]);
    expect(diff.workPlan.gate.behavioral.actions).toEqual(["create", "update"]);
  });

  test("a new string[] field also selects search", () => {
    const diff = diffOf((draft) => {
      draft.schema.fields.push(activeField("moods", "string[]"));
    });
    expect(diff.workPlan.regeneratedUnits).toEqual(["create", "update", "search"]);
  });
});

describe("required change → resulting-record validation + writes", () => {
  test("toggling a field's required selects create/update", () => {
    const diff = diffOf((draft) => {
      const tags = draft.schema.fields.find((field) => field.name === "tags");
      if (tags) tags.required = true;
    });
    expect(factKinds(diff)).toEqual(["required_change"]);
    expect(diff.workPlan.platformWork).toEqual(["resulting_record_validation"]);
    expect(diff.workPlan.regeneratedUnits).toEqual(["create", "update"]);
  });
});

describe("field label → platform form/detail; item only when the field is shown", () => {
  test("relabelling a field in item.shows regenerates the item renderer", () => {
    const diff = diffOf((draft) => {
      const title = draft.schema.fields.find((field) => field.name === "title");
      if (title) title.label = "Heading";
    });
    expect(factKinds(diff)).toEqual(["field_label"]);
    expect(diff.workPlan.platformWork).toEqual(["platform_form_detail"]);
    expect(diff.workPlan.regeneratedUnits).toEqual(["item"]);
    expect(diff.workPlan.gate.designLint).toBe(true);
    expect(diff.workPlan.gate.behavioral).toEqual({ actions: [], fullSuite: false });
  });

  test("relabelling a field absent from item.shows selects no unit", () => {
    // A baseline whose item shows only `tags`, so relabelling `title` cannot touch item.
    const base = journalCapabilityRow({
      ui_intent: {
        ...journalCapabilityRow().ui_intent,
        item: { direction: "A tag-forward chip.", shows: ["tags"] },
      },
    });
    const diff = diffOf((draft) => {
      const title = draft.schema.fields.find((field) => field.name === "title");
      if (title) title.label = "Heading";
    }, base);
    expect(factKinds(diff)).toEqual(["field_label"]);
    expect(diff.workPlan.regeneratedUnits).toEqual([]);
    expect(diff.workPlan.gate.designLint).toBe(false);
  });
});

describe("hide/reactivate field → writes; search for text/list-text; item via shows", () => {
  test("hiding a field selects create/update and no destructive DDL work", () => {
    const diff = diffOf((draft) => {
      // Hide `tags` (active string[]) and drop it from every presentation surface so
      // the lifecycle fact is isolated from the item.shows/detail.shows facts.
      const tags = draft.schema.fields.find((field) => field.name === "tags");
      if (tags) tags.lifecycle = "inactive";
      draft.ui_intent.form.list_inputs = [];
      draft.ui_intent.item.shows = ["title"];
      draft.ui_intent.detail.shows = ["title", "created_at"];
    });
    const lifecycle = diff.facts.find((fact) => fact.kind === "field_lifecycle");
    expect(lifecycle).toEqual({ kind: "field_lifecycle", field: "tags", transition: "hide" });
    expect(diff.workPlan.platformWork).toContain("platform_form_detail");
    expect(diff.workPlan.platformWork).toContain("list_input_intent");
    // string[] is list-text, so search joins the write units.
    expect(diff.workPlan.regeneratedUnits).toEqual(
      expect.arrayContaining(["create", "update", "search"]),
    );
    expect(diff.workPlan.regeneratedUnits).toContain("item"); // via item.shows change
  });

  test("reactivating a non-text field selects create/update without search", () => {
    const diff = diffOf((draft) => {
      const oldRating = draft.schema.fields.find((field) => field.name === "old_rating");
      if (oldRating) oldRating.lifecycle = "active";
    });
    const lifecycle = diff.facts.find((fact) => fact.kind === "field_lifecycle");
    expect(lifecycle).toEqual({
      kind: "field_lifecycle",
      field: "old_rating",
      transition: "reactivate",
    });
    expect(diff.workPlan.regeneratedUnits).toEqual(["create", "update"]);
  });
});

describe("active string[] list input mode → platform form only", () => {
  test("changing a list input mode selects platform form work and nothing else", () => {
    const diff = diffOf((draft) => {
      draft.ui_intent.form.list_inputs = [{ field: "tags", mode: "repeatable" }];
    });
    expect(factKinds(diff)).toEqual(["list_input_mode"]);
    expect(diff.workPlan.platformWork).toEqual(["list_input_form_normalization"]);
    expect(diff.workPlan.regeneratedUnits).toEqual([]);
    expect(diff.workPlan.gate.behavioral).toEqual({ actions: [], fullSuite: false });
  });
});

describe("detail.shows/order → platform detail View, no units", () => {
  test("reordering detail.shows selects the platform detail View only", () => {
    const diff = diffOf((draft) => {
      draft.ui_intent.detail.shows = ["tags", "title", "created_at"];
    });
    expect(factKinds(diff)).toEqual(["detail_shows"]);
    expect(diff.workPlan.platformWork).toEqual(["platform_detail_view"]);
    expect(diff.workPlan.regeneratedUnits).toEqual([]);
  });
});

describe("item direction or item.shows → item renderer only", () => {
  test("a changed item direction regenerates item, no platform work", () => {
    const diff = diffOf((draft) => {
      draft.ui_intent.item.direction = "A bolder, larger title card.";
    });
    expect(factKinds(diff)).toEqual(["item_presentation"]);
    expect(diff.workPlan.regeneratedUnits).toEqual(["item"]);
    expect(diff.workPlan.platformWork).toEqual([]);
    expect(diff.workPlan.gate.designLint).toBe(true);
  });

  test("reordering item.shows is a real diff (ordered product fact)", () => {
    const diff = diffOf((draft) => {
      draft.ui_intent.item.shows = ["tags", "title"];
    });
    expect(factKinds(diff)).toEqual(["item_presentation"]);
    expect(diff.isNoop).toBe(false);
    expect(diff.workPlan.regeneratedUnits).toEqual(["item"]);
  });
});

describe("collection feed|grid → platform list container + item only", () => {
  test("switching layout selects item and the platform list container", () => {
    const diff = diffOf((draft) => {
      draft.ui_intent.collection.layout = "grid";
    });
    expect(factKinds(diff)).toEqual(["collection_layout"]);
    expect(diff.workPlan.platformWork).toEqual(["platform_list_container"]);
    expect(diff.workPlan.regeneratedUnits).toEqual(["item"]);
    expect(diff.workPlan.gate.behavioral).toEqual({ actions: [], fullSuite: false });
  });
});

describe("read_dependencies.<action> → read catalog + that Action's unit and tests", () => {
  const dependency = {
    capability_id: "shelves",
    incarnation_id: "33333333-3333-4333-8333-333333333333",
  };

  test("a new dependency on read selects the read unit and its tests", () => {
    const diff = diffOf((draft) => {
      draft.read_dependencies.read = [dependency];
    });
    expect(diff.facts).toEqual([{ kind: "read_dependencies", action: "read" }]);
    expect(diff.workPlan.platformWork).toEqual(["read_catalog"]);
    expect(diff.workPlan.regeneratedUnits).toEqual(["read"]);
    expect(diff.workPlan.gate.behavioral.actions).toEqual(["read"]);
  });

  test("reordering an unchanged dependency set is not a fact (canonical order)", () => {
    const second = {
      capability_id: "shelves",
      incarnation_id: "44444444-4444-4444-8444-444444444444",
    };
    const base = journalCapabilityRow({
      read_dependencies: {
        create: [],
        read: [dependency, second],
        update: [],
        delete: [],
        search: [],
      },
    });
    const diff = diffOf((draft) => {
      draft.read_dependencies.read = [second, dependency];
    }, base);
    expect(diff.isNoop).toBe(true);
  });
});

describe("free-text behavior → all five Handlers + the complete suite", () => {
  test("changed behavior regenerates every Handler and runs the full suite", () => {
    const diff = diffOf((draft) => {
      draft.behavior = "Oldest entries appear first now.";
    });
    expect(factKinds(diff)).toEqual(["behavior"]);
    expect(diff.workPlan.platformWork).toEqual([]);
    expect(diff.workPlan.regeneratedUnits).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "search",
    ]);
    expect(diff.workPlan.gate.behavioral).toEqual({
      actions: ["create", "read", "update", "delete", "search"],
      fullSuite: true,
    });
  });
});

describe("valid behavioral_errors change → union of named Actions", () => {
  test("a new error case selects its owning Action's unit and tests", () => {
    const diff = diffOf((draft) => {
      draft.behavioral_errors = [
        ...draft.behavioral_errors,
        {
          action: "search",
          trigger: "blank_query",
          code: "blank_query",
          fields: ["title"],
          expected_markers: {
            role_attribute: "data-role",
            role: "error",
            code_attribute: "data-error-code",
            fields_attribute: "data-error-fields",
            fields_separator: " ",
          },
        },
      ];
    });
    expect(diff.facts).toEqual([{ kind: "behavioral_errors", actions: ["search"] }]);
    expect(diff.workPlan.platformWork).toEqual(["behavioral_error_contract"]);
    expect(diff.workPlan.regeneratedUnits).toEqual(["search"]);
    expect(diff.workPlan.gate.behavioral.actions).toEqual(["search"]);
  });

  test("reordering the same error cases is not a fact (set-like)", () => {
    const diff = diffOf((draft) => {
      draft.behavioral_errors = [...draft.behavioral_errors].reverse();
    });
    expect(diff.isNoop).toBe(true);
  });
});

describe("multi-fact union is monotone — no fact subtracts another's work", () => {
  test("reactivating a list-text field plus a required change unions every column", () => {
    const diff = diffOf((draft) => {
      const oldLabels = draft.schema.fields.find((field) => field.name === "old_labels");
      if (oldLabels) oldLabels.lifecycle = "active"; // string[] reactivation → +search
      draft.ui_intent.form.list_inputs = [
        { field: "tags", mode: "comma_separated" },
        { field: "old_labels", mode: "comma_separated" },
      ];
      const title = draft.schema.fields.find((field) => field.name === "title");
      if (title) title.required = false; // required change → create/update
    });
    expect(factKinds(diff)).toEqual(expect.arrayContaining(["field_lifecycle", "required_change"]));
    // The reactivation's {create,update,search} is a superset of the required
    // change's {create,update}; the union keeps search, never dropping it.
    expect(diff.workPlan.regeneratedUnits).toEqual(["create", "update", "search"]);
    expect(diff.workPlan.gate.behavioral.actions).toEqual(["create", "update", "search"]);
  });
});

describe("the canonical no-op ignores object-key and set ordering (decision 37)", () => {
  test("reordering a field object's keys is not a change", () => {
    const diff = diffOf((draft) => {
      draft.schema.fields = draft.schema.fields.map((field) => ({
        lifecycle: field.lifecycle,
        required: field.required,
        type: field.type,
        label: field.label,
        name: field.name,
      }));
    });
    expect(diff.isNoop).toBe(true);
    expect(diff.facts).toEqual([]);
  });

  test("reordering an error case's fields is not a change", () => {
    // A baseline whose create error owns two fields, so the set can be reordered.
    const base = journalCapabilityRow({
      schema: {
        fields: [
          activeField("title", "string", true),
          activeField("body", "string", true),
          ...journalCapabilityRow().schema.fields.slice(1),
        ],
      },
      behavioral_errors: journalCapabilityRow().behavioral_errors.map((errorCase) => ({
        ...errorCase,
        fields: ["title", "body"],
      })),
    } as Partial<CapabilityRow>);
    const diff = diffOf((draft) => {
      draft.behavioral_errors = draft.behavioral_errors.map((errorCase) => ({
        ...errorCase,
        fields: ["body", "title"],
      }));
    }, base);
    expect(diff.isNoop).toBe(true);
  });
});

describe("ordered product facts still diff (decision 37)", () => {
  test("a field-order change diffs even though the field set is identical", () => {
    const diff = diffOf((draft) => {
      draft.schema.fields = [...draft.schema.fields].reverse();
    });
    expect(diff.isNoop).toBe(false);
    expect(factKinds(diff)).toEqual(["field_order"]);
  });
});

describe("fail closed on an unmapped difference (decision 21)", () => {
  test("an admitted region with no matrix row throws before any work", () => {
    expect(() =>
      diffOf((draft) => {
        (draft as Record<string, unknown>).mystery_fact = "a future admitted key";
      }),
    ).toThrow(UnmappedChangeFactError);
  });

  test("an immutable difference validation should have caught also fails closed", () => {
    // The Diff Engine trusts 4.6/01 ran; a field type change reaching it anyway is
    // unexplained by every fact and must fail closed rather than silently copy.
    expect(() =>
      diffOf((draft) => {
        const title = draft.schema.fields.find((field) => field.name === "title");
        if (title) title.type = "number";
      }),
    ).toThrow(UnmappedChangeFactError);
  });

  test("the thrown error carries both residuals for the developer preview", () => {
    try {
      diffOf((draft) => {
        (draft as Record<string, unknown>).mystery_fact = "x";
      });
      throw new Error("expected UnmappedChangeFactError");
    } catch (error) {
      expect(error).toBeInstanceOf(UnmappedChangeFactError);
      const diagnostic = (error as UnmappedChangeFactError).diagnostic;
      expect(diagnostic).toHaveProperty("committedResidual");
      expect(diagnostic).toHaveProperty("candidateResidual");
    }
  });
});

describe("gate work follows unit selection and the build/no-op boundary", () => {
  test("any real build runs structural + smoke; a no-op runs neither", () => {
    const build = diffOf((draft) => {
      draft.prompt_context = "changed";
    });
    expect(build.workPlan.gate.structural).toBe(true);
    expect(build.workPlan.gate.smoke).toBe(true);
    const noop = diffOf(() => {});
    expect(noop.workPlan.gate.structural).toBe(false);
    expect(noop.workPlan.gate.smoke).toBe(false);
  });

  test("design lint runs exactly when the item renderer regenerates", () => {
    const withItem = diffOf((draft) => {
      draft.ui_intent.collection.layout = "grid";
    });
    expect(withItem.workPlan.gate.designLint).toBe(true);
    const withoutItem = diffOf((draft) => {
      draft.prompt_context = "changed";
    });
    expect(withoutItem.workPlan.gate.designLint).toBe(false);
  });
});
