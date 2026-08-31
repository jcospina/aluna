// The choice control, in both of the renderer's modes. Create draws the declared options
// with nothing selected; edit draws the same control with the stored value selected. The
// list never contains anything the field does not declare.

import { describe, expect, test } from "bun:test";
import { oneField, PROBE_CHOICE_OPTIONS, probeField } from "./field-renderer.test-support.ts";
import { renderCreateForm, renderEditForm } from "./field-renderer.ts";

function choiceCapability(required = false, actions: readonly string[] = ["create", "read"]) {
  const probe = oneField(probeField("choice", { required }));
  return { ...probe, actions: actions as typeof probe.actions };
}

describe("the create control", () => {
  test("draws a select carrying every declared option, in authored order", () => {
    const html = renderCreateForm(choiceCapability());
    // The design's select markup: the shell carries the boundary, the bare select the
    // value, and the chevron the caret (`design/design-system.md`, "Forms").
    expect(html).toContain('<span class="field__control field__control--select">');
    expect(html).toContain('<select class="field__select" id="cap-probe-value" name="value">');
    expect(html).toContain('<span class="field__chevron">');
    for (const option of PROBE_CHOICE_OPTIONS) {
      expect(html).toContain(`<option value="${option.value}">${option.label}</option>`);
    }
    expect(html.indexOf('value="first"')).toBeLessThan(html.indexOf('value="second"'));
  });

  test("nothing is selected yet, so the empty placeholder carries the selection", () => {
    const html = renderCreateForm(choiceCapability());
    expect(html).toContain('<option value="" selected>');
  });

  test("the authored presentation rides the field, and a required choice carries required", () => {
    expect(renderCreateForm(choiceCapability())).toContain('data-choice-presentation="picker"');
    expect(renderCreateForm(choiceCapability(true))).toContain('name="value" required>');
  });
});

describe("the edit control", () => {
  const capability = choiceCapability(false, ["create", "read", "update"]);

  test("selects the stored value and nothing else", () => {
    const html = renderEditForm(capability, { id: "probe-1", value: "second" });
    expect(html).toContain('<option value="second" selected>Second</option>');
    expect(html).toContain('<option value="first">First</option>');
    expect(html).not.toContain('<option value="" selected>');
  });

  test("an absent stored value falls back to the empty placeholder", () => {
    const html = renderEditForm(capability, { id: "probe-1", value: null });
    expect(html).toContain('<option value="" selected>');
  });

  test("a stored value never widens the option list", () => {
    const html = renderEditForm(capability, { id: "probe-1", value: "third" });
    expect(html).not.toContain('value="third"');
    expect(html).toContain('<option value="" selected>');
  });

  test("option labels are escaped on the way into markup", () => {
    const hostile = oneField(
      probeField("choice", {
        values: [{ value: "a&b", label: '<script>"x"' }],
        groups: [],
      }),
    );
    const html = renderCreateForm(hostile);
    expect(html).toContain('value="a&amp;b"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
