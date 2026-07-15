// Presentation-facing slices of the capability spec shape: `ui_intent` (item,
// closed collection layout, real detail fields), presentation lists including
// `created_at`, and the label/lifecycle guarantees. Field-type and field-name
// shape live in `spec.test.ts`; the shared `validSpec` fixture lives in
// `spec.test-support.ts`.

import { describe, expect, test } from "bun:test";
import { validSpec } from "./spec.test-support.ts";
import {
  type CapabilitySpec,
  capabilitySpecSchema,
  defaultBehavioralErrorsForSchema,
} from "./spec.ts";

describe("capability spec shape — ui_intent presentation", () => {
  test("ui_intent records item, closed collection layout, and real detail fields only", () => {
    const grid = validSpec({
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "A visual tile that foregrounds the primary field.", shows: ["text"] },
        collection: { layout: "grid" },
        detail: { shows: ["text"] },
      },
    });
    expect(capabilitySpecSchema.safeParse(grid).success).toBe(true);

    // @ts-expect-error — M2's generated-view state is retired from ui_intent.
    const oldViews = validSpec({ ui_intent: { views: ["list", "create"] } });
    expect(capabilitySpecSchema.safeParse(oldViews).success).toBe(false);

    const unknownLayout = validSpec({
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "A visual tile that foregrounds the primary field.", shows: ["text"] },
        // @ts-expect-error — unknown collection layouts must fail closed.
        collection: { layout: "masonry" },
        detail: { shows: ["text"] },
      },
    });
    expect(capabilitySpecSchema.safeParse(unknownLayout).success).toBe(false);

    const unknownDetailField = validSpec({
      ui_intent: {
        form: { list_inputs: [] },
        item: {
          direction: "A text-forward card that emphasizes the note text.",
          shows: ["missing"],
        },
        collection: { layout: "feed" },
        detail: { shows: ["missing"] },
      },
    });
    expect(capabilitySpecSchema.safeParse(unknownDetailField).success).toBe(false);

    const duplicateDetailField = validSpec({
      ui_intent: {
        form: { list_inputs: [] },
        item: {
          direction: "A text-forward card that emphasizes the note text.",
          shows: ["text", "text"],
        },
        collection: { layout: "feed" },
        detail: { shows: ["text", "text"] },
      },
    });
    expect(capabilitySpecSchema.safeParse(duplicateDetailField).success).toBe(false);

    const modalFlag = validSpec({
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
        collection: { layout: "feed" },
        detail: { shows: ["text"] },
        // @ts-expect-error — the shared modal is a platform invariant, not stored state.
        modal: true,
      },
    });
    expect(capabilitySpecSchema.safeParse(modalFlag).success).toBe(false);
  });
});

describe("capability spec shape — presentation lists & created_at", () => {
  test("allows created_at in presentation lists and rejects id, extra, inactive, and unknown fields", () => {
    const schema: CapabilitySpec["schema"] = {
      fields: [
        { name: "text", label: "Entry", type: "string", required: true, lifecycle: "active" },
        {
          name: "retired_note",
          label: "Retired note",
          type: "string",
          required: true,
          lifecycle: "inactive",
        },
      ],
    };
    const accepted = validSpec({
      schema,
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "Show the entry and its age.", shows: ["text", "created_at"] },
        collection: { layout: "feed" },
        detail: { shows: ["created_at", "text"] },
      },
      behavioral_errors: defaultBehavioralErrorsForSchema(schema),
    });
    expect(capabilitySpecSchema.parse(accepted)).toEqual(accepted);

    for (const forbidden of ["id", "extra", "retired_note", "unknown"]) {
      const invalid = {
        ...accepted,
        ui_intent: {
          ...accepted.ui_intent,
          item: { ...accepted.ui_intent.item, shows: [forbidden] },
        },
      };
      expect(capabilitySpecSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("capability spec shape — labels & lifecycle", () => {
  test("requires explicit field labels and lifecycle values", () => {
    const missingLabel = validSpec() as unknown as Record<string, unknown>;
    missingLabel.schema = {
      fields: [{ name: "text", type: "string", required: true, lifecycle: "active" }],
    };
    expect(capabilitySpecSchema.safeParse(missingLabel).success).toBe(false);

    const missingLifecycle = validSpec() as unknown as Record<string, unknown>;
    missingLifecycle.schema = {
      fields: [{ name: "text", label: "Entry", type: "string", required: true }],
    };
    expect(capabilitySpecSchema.safeParse(missingLifecycle).success).toBe(false);
  });

  test("generated labels must be short names, not product-voice sentences", () => {
    expect(capabilitySpecSchema.safeParse(validSpec({ label: "Reading list" })).success).toBe(true);
    expect(
      capabilitySpecSchema.safeParse(
        validSpec({ label: "We'll set up a space to capture and organize all your notes." }),
      ).success,
    ).toBe(false);
  });
});
