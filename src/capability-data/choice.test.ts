// Platform mutation validation for a choice field: a record stores, reads back and edits
// through its declared options, and a value the field never declared is refused before
// canonical state moves — as a typed `invalid_choice` carrying the offending field.

import { describe, expect, test } from "bun:test";

import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  INVALID_CHOICE_ERROR_CODE,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import {
  applyCapabilityTableDdl,
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

function invoicesSpec(statusRequired = false): CapabilitySpec {
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
          values: STATUS_OPTIONS,
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
