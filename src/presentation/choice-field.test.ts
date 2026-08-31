// The choice control, in all three presentations and both of the renderer's modes.
//
// The same declared options draw as a picker, a radio group or a segmented row; create
// draws them with nothing chosen and edit with the stored value chosen; and all three
// post the same wire value under the same name.

import { describe, expect, test } from "bun:test";
import type { ChoicePresentation, SpecField } from "../registry/index.ts";
import { oneField, PROBE_CHOICE_OPTIONS, probeField } from "./field-renderer.test-support.ts";
import { renderCreateForm, renderEditForm } from "./field-renderer.ts";

function choiceCapability(
  presentation: ChoicePresentation = "picker",
  overrides: Partial<SpecField> = {},
  actions: readonly string[] = ["create", "read"],
) {
  const probe = oneField(
    probeField("choice", { required: false, ...overrides }),
    "repeatable",
    presentation,
  );
  return { ...probe, actions: actions as typeof probe.actions };
}

const PRESENTATIONS: readonly ChoicePresentation[] = ["picker", "radio", "segmented"];

/* ── what every presentation owes ──────────────────────────────────────────── */

describe("the three presentations are three drawings of one field", () => {
  test("each one names itself on the field, and only the picker is a listbox", () => {
    for (const presentation of PRESENTATIONS) {
      const html = renderCreateForm(choiceCapability(presentation));
      expect(html).toContain(`data-choice-presentation="${presentation}"`);
      expect(html.includes('class="field field--choice listbox"')).toBe(presentation === "picker");
    }
  });

  test("each one offers every declared option in authored order, and nothing else", () => {
    for (const presentation of PRESENTATIONS) {
      const html = renderCreateForm(choiceCapability(presentation));
      for (const option of PROBE_CHOICE_OPTIONS) {
        expect(html).toContain(`value="${option.value}"`);
        expect(html).toContain(option.label);
      }
      expect(html.indexOf('"first"')).toBeLessThan(html.indexOf('"second"'));
      expect(html).not.toContain("third");
    }
  });

  test("each one posts the same stored value under the field's own name", () => {
    const capability = choiceCapability("picker", {}, ["create", "read", "update"]);
    for (const presentation of PRESENTATIONS) {
      const html = renderEditForm(
        {
          ...capability,
          form: {
            ...capability.form,
            choice_inputs: [{ field: "value", presentation }],
            long_text: [],
            guidance: [],
          },
        },
        { id: "probe-1", value: "second" },
      );
      // Either a carrier the control writes through, or the checked radio itself.
      expect(html).toMatch(/name="value" value="second"|value="second" checked/);
    }
  });

  test("each one is named by the field's label rather than a label element", () => {
    for (const presentation of PRESENTATIONS) {
      const html = renderCreateForm(choiceCapability(presentation));
      // The optional marker rides inside the label, because the exception is what is
      // marked: marking required would spend an asterisk on most of a form.
      expect(html).toContain(
        '<span class="field__label" id="cap-probe-value-label">' +
          'Value <span class="field__optional">optional</span></span>',
      );
      expect(html).toContain('aria-labelledby="cap-probe-value-label"');
      expect(html).not.toContain('<label class="field__label"');
    }
  });

  test("a required choice says so on the two roles that can carry it", () => {
    for (const presentation of ["picker", "radio"] as const) {
      expect(
        renderCreateForm(choiceCapability(presentation, { required: true })),
        presentation,
      ).toContain('aria-required="true"');
      expect(renderCreateForm(choiceCapability(presentation))).not.toContain("aria-required");
    }
    // `group`, which is what a segmented row is, supports no such state. Saying it there
    // would be invalid markup that conveys nothing.
    expect(renderCreateForm(choiceCapability("segmented", { required: true }))).not.toContain(
      "aria-required",
    );
  });

  test("only the radio group keeps a native required constraint, because only it can", () => {
    expect(renderCreateForm(choiceCapability("radio", { required: true }))).toContain(
      'value="first" required>',
    );
    for (const presentation of ["picker", "segmented"] as const) {
      expect(
        renderCreateForm(choiceCapability(presentation, { required: true })),
        presentation,
      ).not.toContain(" required>");
    }
  });

  test("option labels and values are escaped on the way into markup", () => {
    for (const presentation of PRESENTATIONS) {
      const html = renderCreateForm(
        choiceCapability(presentation, { values: [{ value: "a&b", label: '<script>"x"' }] }),
      );
      expect(html).toContain("a&amp;b");
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>");
    }
  });
});

/* ── the picker ────────────────────────────────────────────────────────────── */

describe("the picker draws the design's listbox", () => {
  test("a closed combobox button reporting the panel it controls", () => {
    const html = renderCreateForm(choiceCapability("picker"));
    expect(html).toContain(
      '<button class="field__control field__control--select listbox__button" type="button"' +
        ' id="cap-probe-value" role="combobox" aria-haspopup="listbox" aria-expanded="false"' +
        ' aria-controls="cap-probe-value-panel" aria-labelledby="cap-probe-value-label"' +
        ' aria-describedby="cap-probe-value-guidance">',
    );
    expect(html).toContain(
      '<div class="listbox__panel" id="cap-probe-value-panel" role="listbox" tabindex="-1"' +
        ' aria-labelledby="cap-probe-value-label" hidden>',
    );
    expect(html).toContain('<div class="listbox__scroll">');
    expect(html).toContain('<span class="listbox__chevron">');
  });

  test("nothing chosen shows the placeholder, and the carrier is empty", () => {
    const html = renderCreateForm(choiceCapability("picker"));
    expect(html).toContain('<span class="listbox__value is-placeholder">Choose Value…</span>');
    expect(html).toContain('<input type="hidden" name="value" value="" data-choice-value>');
    expect(html).not.toContain('aria-selected="true"');
  });

  test("the stored value is chosen, shown and carried without a script running", () => {
    const html = renderEditForm(choiceCapability("picker", {}, ["create", "read", "update"]), {
      id: "probe-1",
      value: "second",
    });
    expect(html).toContain('<span class="listbox__value">Second</span>');
    expect(html).toContain('<input type="hidden" name="value" value="second" data-choice-value>');
    expect(html).toContain('data-value="second" aria-selected="true"');
    expect(html).toContain('data-value="first" aria-selected="false"');
  });

  test("a stored value the field never declared resolves to nothing, not to the first option", () => {
    const html = renderEditForm(choiceCapability("picker", {}, ["create", "read", "update"]), {
      id: "probe-1",
      value: "third",
    });
    expect(html).not.toContain("third");
    expect(html).toContain('<input type="hidden" name="value" value="" data-choice-value>');
    expect(html).not.toContain('aria-selected="true"');
  });

  test("every option carries a stable id for active-descendant reporting", () => {
    const html = renderCreateForm(choiceCapability("picker"));
    expect(html).toContain('id="cap-probe-value-option-1"');
    expect(html).toContain('id="cap-probe-value-option-2"');
  });
});

/* ── the radio group ───────────────────────────────────────────────────────── */

describe("the radio group draws native inputs", () => {
  test("one labelled radiogroup of real radio inputs sharing the field's name", () => {
    const html = renderCreateForm(choiceCapability("radio"));
    expect(html).toContain(
      '<div class="choice-set" id="cap-probe-value" role="radiogroup"' +
        ' aria-labelledby="cap-probe-value-label"' +
        ' aria-describedby="cap-probe-value-guidance">',
    );
    expect(html).toContain(
      '<input class="choice__input" type="radio" id="cap-probe-value-option-1"' +
        ' name="value" value="first">',
    );
    expect(html).toContain('<span class="choice__mark"><span class="choice__glyph"></span></span>');
    expect(html).toContain('<span class="choice__title">First</span>');
  });

  test("the stored value is the checked input, and nothing else is", () => {
    const html = renderEditForm(choiceCapability("radio", {}, ["create", "read", "update"]), {
      id: "probe-1",
      value: "second",
    });
    expect(html).toContain('value="second" checked>');
    expect(html).not.toContain('value="first" checked');
  });

  test("no value carrier: an unchecked group posts nothing, which is no selection", () => {
    expect(renderCreateForm(choiceCapability("radio"))).not.toContain("data-choice-value");
  });
});

/* ── the segmented control ─────────────────────────────────────────────────── */

describe("the segmented control draws one exclusive button set", () => {
  test("a labelled group of buttons, one of which is pressed", () => {
    const html = renderEditForm(choiceCapability("segmented", {}, ["create", "read", "update"]), {
      id: "probe-1",
      value: "second",
    });
    expect(html).toContain(
      '<div class="segmented" id="edit-probe-value" role="group"' +
        ' aria-labelledby="edit-probe-value-label"' +
        ' aria-describedby="edit-probe-value-guidance">',
    );
    expect(html).toContain(
      '<button type="button" id="edit-probe-value-option-2" data-value="second"' +
        ' aria-pressed="true">Second</button>',
    );
    expect(html).toContain('data-value="first" aria-pressed="false"');
  });

  test("a carrier holds the value, because a button posts nothing", () => {
    const html = renderCreateForm(choiceCapability("segmented"));
    expect(html).toContain('<input type="hidden" name="value" value="" data-choice-value>');
    expect(html).not.toContain('aria-pressed="true"');
  });
});

/* ── groups, notes and disabled options ────────────────────────────────────── */

const RICH_OPTIONS = [
  { value: "loose", label: "Loose" },
  { value: "first", label: "First", group: "open", note: "still moving" },
  { value: "second", label: "Second", group: "closed" },
  { value: "third", label: "Third", group: "closed", disabled: true as const },
];
const RICH_GROUPS = [
  { id: "open", heading: "Open" },
  { id: "closed", heading: "Closed" },
];
const rich = { values: RICH_OPTIONS, groups: RICH_GROUPS };

describe("group headings are announced as option groups", () => {
  test("the picker wraps each run in a group named by its heading", () => {
    const html = renderCreateForm(choiceCapability("picker", rich));
    // The wrapper carries the semantics; the heading stays presentational, as the design
    // draws it — a second non-option child would break the listbox's required children.
    expect(html).toContain(
      '<div role="group" aria-labelledby="cap-probe-value-group-open">' +
        '<div class="listbox__group caps" role="presentation"' +
        ' id="cap-probe-value-group-open">Open</div>',
    );
    expect(html).toContain('id="cap-probe-value-group-closed">Closed</div>');
  });

  test("a grouped radio set becomes one radiogroup per heading, inside a plain group", () => {
    // `radiogroup` owns radios and nothing else, so a heading wrapper inside one would
    // take its own radios out of it. The runs become the radiogroups instead.
    const html = renderCreateForm(choiceCapability("radio", rich));
    expect(html).toContain('<div class="choice-set" id="cap-probe-value" role="group"');
    expect(html).toContain(
      '<div class="choice-set__group" role="radiogroup"' +
        ' aria-labelledby="cap-probe-value-group-open">' +
        '<span class="choice-set__heading caps" id="cap-probe-value-group-open">Open</span>',
    );
    // The ungrouped run is a radiogroup too, named by the field itself.
    expect(html).toContain(
      '<div class="choice-set__group" role="radiogroup"' +
        ' aria-labelledby="cap-probe-value-label">',
    );
  });

  test("an ungrouped radio set stays the single radiogroup the design draws", () => {
    const html = renderCreateForm(choiceCapability("radio"));
    expect(html).toContain('<div class="choice-set" id="cap-probe-value" role="radiogroup"');
    expect(html).not.toContain("choice-set__group");
  });

  test("ungrouped options come first, then each group in declared order", () => {
    const html = renderCreateForm(choiceCapability("picker", rich));
    const at = (needle: string) => html.indexOf(needle);
    expect(at('data-value="loose"')).toBeLessThan(at("Open</div>"));
    expect(at("Open</div>")).toBeLessThan(at('data-value="first"'));
    expect(at('data-value="first"')).toBeLessThan(at("Closed</div>"));
    expect(at("Closed</div>")).toBeLessThan(at('data-value="second"'));
  });
});

describe("an option note is a description, not visual-only text", () => {
  test("the picker's note rides the row and is named as the option's description", () => {
    const html = renderCreateForm(choiceCapability("picker", rich));
    expect(html).toContain('aria-describedby="cap-probe-value-note-2"');
    // Hidden from the name, not from the description: the note sits inside the option, so
    // without this it would be read once as part of what the option is called and again as
    // its description. `aria-describedby` reaches a hidden node either way.
    expect(html).toContain(
      '<span class="listbox__note" id="cap-probe-value-note-2" aria-hidden="true">' +
        "still moving</span>",
    );
  });

  test("the radio group's note is the design's hint, described the same way", () => {
    const html = renderCreateForm(choiceCapability("radio", rich));
    expect(html).toContain('aria-describedby="cap-probe-value-note-2"');
    expect(html).toContain(
      '<span class="choice__hint" id="cap-probe-value-note-2" aria-hidden="true">' +
        "still moving</span>",
    );
  });

  test("an option with no note names no description", () => {
    const html = renderCreateForm(choiceCapability("picker"));
    // The control itself is always described — by its guidance slot, which is where an
    // error is said — so what is checked is that it is the *only* one described, whatever
    // an option might have called its own description.
    expect(html.match(/aria-describedby=/g)).toHaveLength(1);
    expect(html).toContain('aria-describedby="cap-probe-value-guidance"');
    expect(html).not.toContain("listbox__note");
  });
});

describe("a disabled option is announced as disabled", () => {
  test("the picker marks it aria-disabled, which movement and typeahead skip", () => {
    const html = renderCreateForm(choiceCapability("picker", rich));
    expect(html).toContain('data-value="third" aria-selected="false" aria-disabled="true"');
    expect(html).not.toContain('data-value="second" aria-selected="false" aria-disabled');
  });

  test("the radio group and the segmented row use the native disabled attribute", () => {
    expect(renderCreateForm(choiceCapability("radio", rich))).toContain('value="third" disabled>');
    const flat = { values: RICH_OPTIONS.map(({ group, note, ...rest }) => rest), groups: [] };
    expect(renderCreateForm(choiceCapability("segmented", flat))).toContain(
      'data-value="third" aria-pressed="false" disabled>',
    );
  });

  test("the option a record already holds is never refused, in any presentation", () => {
    const stored = { id: "probe-1", value: "third" };
    const actions = ["create", "read", "update"] as const;

    const picker = renderEditForm(choiceCapability("picker", rich, actions), stored);
    expect(picker).toContain('data-value="third" aria-selected="true">');
    expect(picker).toContain('<input type="hidden" name="value" value="third" data-choice-value>');
    expect(picker).toContain('<span class="listbox__value">Third</span>');

    const radio = renderEditForm(choiceCapability("radio", rich, actions), stored);
    expect(radio).toContain('value="third" checked>');
    expect(radio).not.toContain('value="third" checked disabled');

    const flat = { values: RICH_OPTIONS.map(({ group, note, ...rest }) => rest), groups: [] };
    const segmented = renderEditForm(choiceCapability("segmented", flat, actions), stored);
    expect(segmented).toContain('data-value="third" aria-pressed="true">');
  });
});
