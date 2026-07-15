// Detail-display half of the field-renderer suite (epic 3.2/01): read-only formatting
// per pantry type, the data-safety escaping invariants, and ui_intent.detail.shows
// selection/order. Create-form coverage lives in field-renderer.test.ts; shared
// fixtures live in field-renderer.test-support.ts.

import { describe, expect, test } from "bun:test";

import type { SpecField } from "../registry/index.ts";
import { oneField, SAMPLE } from "./field-renderer.test-support.ts";
import {
  type RenderableCapability,
  renderCreateForm,
  renderDetailFields,
} from "./field-renderer.ts";

describe("detail display — one formatting per pantry type — scalar and datetime formatting", () => {
  test("renders a definition list with a labeled row per field", () => {
    const detail = renderDetailFields(SAMPLE, {
      title: "Buy milk",
      priority: 2,
      done: true,
      due_date: "2026-07-05T09:30:00.000Z",
      note: "before noon",
    });
    expect(detail.startsWith('<dl class="detail-fields">')).toBe(true);
    expect([...detail.matchAll(/<dt class="detail-field__label">/g)]).toHaveLength(5);
    expect(detail).toContain('<dt class="detail-field__label">Due date</dt>');
  });

  test("string values are shown as escaped text", () => {
    const detail = renderDetailFields(
      oneField({
        name: "title",
        label: "Title",
        type: "string",
        required: true,
        lifecycle: "active",
      }),
      {
        title: "Buy milk",
      },
    );
    expect(detail).toContain('<dd class="detail-field__value">Buy milk</dd>');
  });

  test("number values are shown verbatim", () => {
    const detail = renderDetailFields(
      oneField({
        name: "priority",
        label: "Priority",
        type: "number",
        required: true,
        lifecycle: "active",
      }),
      {
        priority: 42.5,
      },
    );
    expect(detail).toContain('<dd class="detail-field__value">42.5</dd>');
  });

  test("boolean values read as Yes / No", () => {
    const field: SpecField = {
      name: "done",
      label: "Done",
      type: "boolean",
      required: true,
      lifecycle: "active",
    };
    expect(renderDetailFields(oneField(field), { done: true })).toContain(
      '<dd class="detail-field__value">Yes</dd>',
    );
    expect(renderDetailFields(oneField(field), { done: false })).toContain(
      '<dd class="detail-field__value">No</dd>',
    );
  });

  test("datetime values ride a semantic <time>, tidied timezone-free", () => {
    const detail = renderDetailFields(
      oneField({
        name: "due_date",
        label: "Due date",
        type: "datetime",
        required: true,
        lifecycle: "active",
      }),
      {
        due_date: "2026-07-05T09:30:00.000Z",
      },
    );
    expect(detail).toContain('<time datetime="2026-07-05T09:30:00.000Z">2026-07-05 09:30</time>');
  });

  test("date values ride a semantic <time>, date-only", () => {
    const detail = renderDetailFields(
      oneField({
        name: "due_on",
        label: "Due on",
        type: "date",
        required: true,
        lifecycle: "active",
      }),
      {
        due_on: "2026-07-05",
      },
    );
    expect(detail).toContain('<time datetime="2026-07-05">2026-07-05</time>');
  });
});

describe("detail display — one formatting per pantry type — lists, empties, and created_at", () => {
  test("string[] values render as an escaped ordered list; null and [] render empty", () => {
    const field: SpecField = {
      name: "tags",
      label: "Tags",
      type: "string[]",
      required: false,
      lifecycle: "active",
    };
    const detail = renderDetailFields(oneField(field), {
      tags: ["first", "one,two", "<last>"],
    });
    expect(detail).toContain(
      '<ul class="detail-field__list"><li>first</li><li>one,two</li><li>&lt;last&gt;</li></ul>',
    );
    for (const absent of [null, []]) {
      const empty = renderDetailFields(oneField(field), { tags: absent });
      expect(empty).toContain("detail-field__value--empty");
      expect(empty).toContain(">—</dd>");
    }
  });

  test("absent values show the placeholder and an empty modifier", () => {
    const field: SpecField = {
      name: "note",
      label: "Note",
      type: "string",
      required: false,
      lifecycle: "active",
    };
    for (const absent of [null, undefined, ""]) {
      const detail = renderDetailFields(oneField(field), { note: absent });
      expect(detail).toContain("detail-field__value detail-field__value--empty");
      expect(detail).toContain("—");
    }
  });

  test("a historical null in a required field renders as the platform empty value", () => {
    const detail = renderDetailFields(
      oneField({
        name: "title",
        label: "Entry",
        type: "string",
        required: true,
        lifecycle: "active",
      }),
      { title: null },
    );
    expect(detail).toContain(">Entry</dt>");
    expect(detail).toContain("detail-field__value--empty");
    expect(detail).toContain("—");
  });

  test("renders the immutable created_at descriptor only when detail intent names it", () => {
    const capability: RenderableCapability = {
      ...SAMPLE,
      detail: { shows: ["created_at", "title"] },
    };
    const detail = renderDetailFields(capability, {
      created_at: "2026-07-14T10:30:00.000Z",
      title: "Visible",
    });
    expect(detail).toContain(">Created</dt>");
    expect(detail).toContain('<time datetime="2026-07-14T10:30:00.000Z">2026-07-14 10:30</time>');
    expect(renderCreateForm(capability)).not.toContain("created_at");
  });
});

describe("detail display — hostile record data cannot become markup", () => {
  test("a script-shaped string value is escaped, not injected", () => {
    const detail = renderDetailFields(
      oneField({
        name: "title",
        label: "Title",
        type: "string",
        required: true,
        lifecycle: "active",
      }),
      {
        title: "<script>alert(1)</script>",
      },
    );
    expect(detail).not.toContain("<script");
    expect(detail).toContain("&lt;script&gt;");
  });

  test("a hostile datetime value cannot break out of the time element", () => {
    const detail = renderDetailFields(
      oneField({ name: "at", label: "At", type: "datetime", required: true, lifecycle: "active" }),
      {
        at: '"><img src=x onerror=alert(1)>',
      },
    );
    // The `">` that would close the attribute and the `<img` that would open a new
    // element are both escaped, so nothing new is parsed — in attribute and text alike.
    expect(detail).not.toContain("<img");
    expect(detail).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("detail display — honors ui_intent.detail.shows (fields + order)", () => {
  const RECORD = {
    title: "Buy oat milk",
    priority: 2,
    done: true,
    due_date: "2026-07-05T09:30:00.000Z",
    note: "later",
  };

  test("without detail.shows, renders every field in spec order (the fallback)", () => {
    const detail = renderDetailFields(SAMPLE, RECORD);
    const order = ["Title", "Priority", "Done", "Due date", "Note"];
    const positions = order.map((label) => detail.indexOf(`>${label}</dt>`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("shows exactly the named fields, in the named order — dropping the rest", () => {
    const scoped: RenderableCapability = {
      ...SAMPLE,
      detail: { shows: ["note", "title", "done"] },
    };
    const detail = renderDetailFields(scoped, RECORD);

    const shown = ["Note", "Title", "Done"].map((label) => detail.indexOf(`>${label}</dt>`));
    expect(shown.every((p) => p >= 0)).toBe(true);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));

    for (const dropped of ["Priority", "Due date"]) {
      expect(detail).not.toContain(`>${dropped}</dt>`);
    }
    expect([...detail.matchAll(/<dt class="detail-field__label">/g)]).toHaveLength(3);
  });

  test("inactive stored values never render, even in a defensive hand-built detail list", () => {
    const capability: RenderableCapability = {
      id: "probe",
      label: "Probe",
      schema: {
        fields: [
          { name: "title", label: "Entry", type: "string", required: true, lifecycle: "active" },
          {
            name: "retired_note",
            label: "Retired note",
            type: "string",
            required: true,
            lifecycle: "inactive",
          },
        ],
      },
      form: { list_inputs: [] },
      detail: { shows: ["title", "retired_note"] },
    };
    const detail = renderDetailFields(capability, {
      title: "Visible",
      retired_note: "still stored",
    });
    expect(detail).toContain("Visible");
    expect(detail).not.toContain("Retired note");
    expect(detail).not.toContain("still stored");
  });

  test("an empty detail.shows falls back to spec order rather than an empty <dl>", () => {
    // Spec validation forbids an empty shows, so this only guards a hand-built capability;
    // it renders the whole record rather than nothing.
    const empty: RenderableCapability = { ...SAMPLE, detail: { shows: [] } };
    expect(renderDetailFields(empty, RECORD)).toBe(renderDetailFields(SAMPLE, RECORD));
  });

  test("a detail.shows naming an unknown field skips it (defensive), keeps the known ones", () => {
    const scoped: RenderableCapability = {
      ...SAMPLE,
      detail: { shows: ["title", "ghost", "done"] },
    };
    const detail = renderDetailFields(scoped, RECORD);
    expect(detail).toContain(">Title</dt>");
    expect(detail).toContain(">Done</dt>");
    expect([...detail.matchAll(/<dt class="detail-field__label">/g)]).toHaveLength(2);
  });
});
