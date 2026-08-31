// Platform mutation validation for a choice field: a record stores, reads back and edits
// through its declared options, and a value the field never declared is refused before
// canonical state moves — as a typed `invalid_choice` carrying the offending field.

import { describe, expect, test } from "bun:test";

import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  CHOICE_DISABLED_ERROR_CODE,
  type ChoiceOption,
  INVALID_CHOICE_ERROR_CODE,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import {
  applyCapabilityTableDdl,
  ChoiceDisabledError,
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  createCapabilityUpdateMutationPort,
  InvalidChoiceError,
  MissingRequiredFieldsError,
  materializeCapabilityActionRecord,
  SQLITE_TYPE_BY_FIELD_TYPE,
  selectCapabilityRows,
} from "./index.ts";
import { withFileDatabase } from "./tool.test-support.ts";

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
];

function invoicesSpec(
  statusRequired = false,
  values: readonly ChoiceOption[] = STATUS_OPTIONS,
): CapabilitySpec {
  return {
    id: "invoices",
    label: "Invoices",
    subject: "a paper invoice",
    ground: "grass_green",
    companion: "coral_orange",
    noun: "invoice",
    schema: {
      fields: [
        { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
        {
          name: "status",
          label: "Status",
          type: "choice",
          required: statusRequired,
          lifecycle: "active",
          values: [...values],
          groups: [],
        },
      ],
    },
    ui_intent: {
      form: { list_inputs: [], choice_inputs: [{ field: "status", presentation: "picker" }] },
      item: { direction: "Lead with the title, then the status.", shows: ["title", "status"] },
      collection: { layout: "feed" },
    },
    behavior: "A title is required. Status is one of the declared values.",
    behavioral_errors: (statusRequired ? ["title", "status"] : ["title"]).length
      ? (["create", "update"] as const).map((action) => ({
          action,
          trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          fields: statusRequired ? ["title", "status"] : ["title"],
          expected_markers: BEHAVIORAL_ERROR_MARKERS,
        }))
      : [],
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores invoices and the stage each one has reached.",
  };
}

function withInvoices(
  run: (ports: {
    create: (values: Record<string, unknown>) => Record<string, unknown>;
    rows: () => readonly Record<string, unknown>[];
    update: (id: string, values: Record<string, unknown>, submitted: string[]) => void;
  }) => void,
  spec: CapabilitySpec = invoicesSpec(),
): void {
  withFileDatabase((databases) => {
    applyCapabilityTableDdl(spec, databases.readwrite);
    const mutation = createCapabilityMutationPort(spec, databases.readwrite);
    const query = createCapabilityQueryPort(databases.readonly, { target: spec });
    run({
      create: (values) =>
        materializeCapabilityActionRecord(mutation.create(values)) as Record<string, unknown>,
      rows: () => selectCapabilityRows(spec, query) as readonly Record<string, unknown>[],
      update: (id, values, submitted) => {
        createCapabilityUpdateMutationPort(
          spec,
          id,
          new Set(submitted),
          databases.readwrite,
        ).update(values);
      },
    });
  });
}

describe("a choice value stores, reads back and edits", () => {
  test("the DDL mapper gives a choice TEXT storage", () => {
    expect(SQLITE_TYPE_BY_FIELD_TYPE.choice).toBe("TEXT");
  });

  test("a declared value survives create, read and edit", () => {
    withInvoices(({ create, rows, update }) => {
      const created = create({ title: "March", status: "draft" });
      expect(created.status).toBe("draft");

      const [stored] = rows();
      expect(stored?.status).toBe("draft");

      update(String(stored?.id), { status: "sent" }, ["status"]);
      expect(rows()[0]?.status).toBe("sent");
    });
  });

  test("an unselected optional choice stores null rather than a blank string", () => {
    withInvoices(({ create }) => {
      expect(create({ title: "March", status: "" }).status).toBeNull();
      expect(create({ title: "April" }).status).toBeNull();
    });
  });

  test("editing an unrelated field leaves the stored choice untouched", () => {
    withInvoices(({ create, rows, update }) => {
      const created = create({ title: "March", status: "sent" });
      update(String(created.id), { title: "March, revised" }, ["title"]);
      const [stored] = rows();
      expect(stored?.title).toBe("March, revised");
      expect(stored?.status).toBe("sent");
    });
  });
});

describe("an undeclared choice value is refused before canonical state moves", () => {
  test("create refuses it as a typed invalid_choice naming the field", () => {
    withInvoices(({ create, rows }) => {
      let raised: unknown;
      try {
        create({ title: "March", status: "paid" });
      } catch (error) {
        raised = error;
      }
      expect(raised).toBeInstanceOf(InvalidChoiceError);
      expect((raised as InvalidChoiceError).code).toBe(INVALID_CHOICE_ERROR_CODE);
      expect((raised as InvalidChoiceError).fields).toEqual(["status"]);
      expect((raised as InvalidChoiceError).action).toBe("create");
      expect(rows()).toHaveLength(0);
    });
  });

  test("update refuses it and leaves the committed row exactly as it was", () => {
    withInvoices(({ create, rows, update }) => {
      const created = create({ title: "March", status: "draft" });
      expect(() => update(String(created.id), { status: "paid" }, ["status"])).toThrow(
        InvalidChoiceError,
      );
      expect(rows()[0]?.status).toBe("draft");
    });
  });

  test("a non-string submission is undeclared too", () => {
    withInvoices(({ create }) => {
      expect(() => create({ title: "March", status: 7 })).toThrow(InvalidChoiceError);
    });
  });

  test("a required choice left unselected is a missing-required refusal, not an invalid one", () => {
    withInvoices(({ create }) => {
      let raised: unknown;
      try {
        create({ title: "March", status: "" });
      } catch (error) {
        raised = error;
      }
      expect(raised).toBeInstanceOf(MissingRequiredFieldsError);
      expect((raised as MissingRequiredFieldsError).fields).toEqual(["status"]);
    }, invoicesSpec(true));
  });
});

/** The same invoices capability, with "sent" taken out of use. */
const RETIRED_STATUS = invoicesSpec(false, [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent", disabled: true },
]);

describe("an option taken out of use", () => {
  test("a new selection of it is refused as a typed choice_disabled naming the field", () => {
    withInvoices(({ create, rows }) => {
      let raised: unknown;
      try {
        create({ title: "March", status: "sent" });
      } catch (error) {
        raised = error;
      }
      expect(raised).toBeInstanceOf(ChoiceDisabledError);
      expect((raised as ChoiceDisabledError).code).toBe(CHOICE_DISABLED_ERROR_CODE);
      expect((raised as ChoiceDisabledError).fields).toEqual(["status"]);
      expect((raised as ChoiceDisabledError).action).toBe("create");
      expect(rows()).toHaveLength(0);
    }, RETIRED_STATUS);
  });

  test("the value is still declared — this is not the undeclared refusal", () => {
    withInvoices(({ create }) => {
      expect(() => create({ title: "March", status: "sent" })).not.toThrow(InvalidChoiceError);
      expect(() => create({ title: "March", status: "paid" })).toThrow(InvalidChoiceError);
    }, RETIRED_STATUS);
  });

  test("a row that already held it keeps it when an unrelated field is saved", () => {
    withFileDatabase((databases) => {
      const before = invoicesSpec();
      applyCapabilityTableDdl(before, databases.readwrite);
      const created = materializeCapabilityActionRecord(
        createCapabilityMutationPort(before, databases.readwrite).create({
          title: "March",
          status: "sent",
        }),
      ) as Record<string, unknown>;

      // The option is retired afterwards; the row goes on holding it.
      createCapabilityUpdateMutationPort(
        RETIRED_STATUS,
        String(created.id),
        new Set(["title"]),
        databases.readwrite,
      ).update({ title: "March, revised" });

      const query = createCapabilityQueryPort(databases.readonly, { target: RETIRED_STATUS });
      const [stored] = selectCapabilityRows(RETIRED_STATUS, query) as Record<string, unknown>[];
      expect(stored?.title).toBe("March, revised");
      expect(stored?.status).toBe("sent");
    });
  });

  test("a submission wrong in both ways earns the undeclared refusal first", () => {
    // Two refusals cannot both be the answer. The undeclared one runs first because it is
    // the stronger statement — that value is not data this capability knows at all — and
    // the disabled one is asked only of what is left.
    const twoChoices = invoicesSpec(false, [
      { value: "draft", label: "Draft" },
      { value: "sent", label: "Sent", disabled: true },
    ]);
    withFileDatabase((databases) => {
      applyCapabilityTableDdl(twoChoices, databases.readwrite);
      let raised: unknown;
      try {
        createCapabilityMutationPort(twoChoices, databases.readwrite).create({
          title: "March",
          status: "paid",
        });
      } catch (error) {
        raised = error;
      }
      expect(raised).toBeInstanceOf(InvalidChoiceError);
      expect((raised as InvalidChoiceError).fields).toEqual(["status"]);
    });
  });

  test("resubmitting the value the row already holds is admitted; moving to it is not", () => {
    withFileDatabase((databases) => {
      const before = invoicesSpec();
      applyCapabilityTableDdl(before, databases.readwrite);
      const mutation = createCapabilityMutationPort(before, databases.readwrite);
      const onSent = materializeCapabilityActionRecord(
        mutation.create({ title: "March", status: "sent" }),
      ) as Record<string, unknown>;
      const onDraft = materializeCapabilityActionRecord(
        mutation.create({ title: "April", status: "draft" }),
      ) as Record<string, unknown>;

      const save = (id: string, values: Record<string, unknown>) =>
        createCapabilityUpdateMutationPort(
          RETIRED_STATUS,
          id,
          new Set(Object.keys(values)),
          databases.readwrite,
        ).update(values);

      // The record standing on the retired option may say so again — that is not a move.
      expect(() => save(String(onSent.id), { status: "sent" })).not.toThrow();
      // And it may leave for one still on offer.
      expect(() => save(String(onSent.id), { status: "draft" })).not.toThrow();
      // A record that was never on it cannot arrive.
      expect(() => save(String(onDraft.id), { status: "sent" })).toThrow(ChoiceDisabledError);
    });
  });
});
