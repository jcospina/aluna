// The choice control, in all three presentations and both of the renderer's modes.
//
// The same declared options draw as a picker, a radio group or a segmented row; create
// draws them with nothing chosen and edit with the stored value chosen; and all three
// post the same wire value under the same name. Asserted on the parsed markup — roles, names,
// the ids one element points another at, and what is chosen — rather than on its spelling.

import { describe, expect, test } from "bun:test";
import type { ChoicePresentation, SpecField } from "../../registry/index.ts";
import {
  oneField,
  PROBE_CHOICE_OPTIONS,
  probeField,
} from "../fields/field-renderer.test-support.ts";
import { renderCreateForm, renderEditForm } from "../fields/field-renderer.ts";
import { Doc, type El, parseHtml } from "./choice-picker.test-support.ts";

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
const EDITABLE = ["create", "read", "update"] as const;

/** A rendered form, parsed, with the parts of the one choice field a person meets. */
function drawn(html: string) {
  const root = parseHtml(html, new Doc());
  const field = root.querySelector("[data-choice-presentation]") as El;
  const byId = (id: string | null) => (id ? root.querySelector(`#${id}`) : null);
  return {
    root,
    field,
    byId,
    /** What the form posts under the field's name: a carrier, or the radios themselves. */
    posted: () => field.querySelectorAll('input[name="value"]'),
    /** The element a role names, inside the field. */
    role: (role: string) => field.querySelectorAll(`[role="${role}"]`),
    option: (value: string) => field.querySelector(`[data-value="${value}"]`) as El,
    radio: (value: string) => field.querySelector(`input[type="radio"][value="${value}"]`) as El,
  };
}

const created = (presentation: ChoicePresentation, overrides: Partial<SpecField> = {}) =>
  drawn(renderCreateForm(choiceCapability(presentation, overrides)));

const edited = (
  presentation: ChoicePresentation,
  value: string,
  overrides: Partial<SpecField> = {},
) =>
  drawn(
    renderEditForm(choiceCapability(presentation, overrides, EDITABLE), { id: "probe-1", value }),
  );

/* ── what every presentation owes ──────────────────────────────────────────── */

describe("the three presentations are three drawings of one field", () => {
  test("each one names itself on the field, and only the picker is a listbox", () => {
    for (const presentation of PRESENTATIONS) {
      const one = created(presentation);
      expect(one.field.getAttribute("data-choice-presentation")).toBe(presentation);
      expect(one.role("listbox").length > 0).toBe(presentation === "picker");
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
    for (const presentation of PRESENTATIONS) {
      const posted = edited(presentation, "second")
        .posted()
        .filter((input) => input.getAttribute("type") !== "radio" || input.checked)
        .map((input) => input.value);
      // Either a carrier the control writes through, or the checked radio itself.
      expect(posted, presentation).toEqual(["second"]);
    }
  });

  test("each one is named by the field's label rather than a label element", () => {
    for (const presentation of PRESENTATIONS) {
      const one = created(presentation);
      const named = one.field.querySelectorAll("[aria-labelledby]");
      expect(named.length).toBeGreaterThan(0);
      const label = one.byId(named[0]?.getAttribute("aria-labelledby") ?? null) as El;
      expect(label.tag).toBe("span");
      // The optional marker rides inside the label, because the exception is what is
      // marked: marking required would spend an asterisk on most of a form.
      expect(label.textContent.replace(/\s+/g, " ").trim()).toBe("Value optional");
      expect(one.field.querySelector("label[for]")).toBeNull();
    }
  });

  test("a required choice says so on the two roles that can carry it", () => {
    for (const presentation of ["picker", "radio"] as const) {
      const required = created(presentation, { required: true }).field;
      expect(required.querySelectorAll('[aria-required="true"]'), presentation).toHaveLength(1);
      expect(created(presentation).field.querySelector("[aria-required]")).toBeNull();
    }
    // `group`, which is what a segmented row is, supports no such state. Saying it there
    // would be invalid markup that conveys nothing.
    expect(created("segmented", { required: true }).field.querySelector("[aria-required]")).toBe(
      null,
    );
  });

  test("only the radio group keeps a native required constraint, because only it can", () => {
    expect(created("radio", { required: true }).radio("first").hasAttribute("required")).toBe(true);
    for (const presentation of ["picker", "segmented"] as const) {
      expect(
        created(presentation, { required: true }).field.querySelector("[required]"),
        presentation,
      ).toBeNull();
    }
  });

  test("option labels and values are escaped on the way into markup", () => {
    for (const presentation of PRESENTATIONS) {
      const one = created(presentation, { values: [{ value: "a&b", label: '<script>"x"' }] });
      expect(one.root.querySelector("script")).toBeNull();
      expect(one.field.textContent).toContain('<script>"x"');
      expect(one.field.querySelector('[value="a&b"], [data-value="a&b"]')).not.toBeNull();
    }
  });
});

/* ── the picker ────────────────────────────────────────────────────────────── */

describe("the picker draws the design's listbox", () => {
  test("a closed combobox button reporting the panel it controls", () => {
    const one = created("picker");
    const [button] = one.role("combobox");
    const [panel] = one.role("listbox");
    expect(button?.tag).toBe("button");
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.getAttribute("aria-haspopup")).toBe("listbox");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(button?.getAttribute("aria-controls")).toBe(panel?.id ?? "");
    expect(panel?.hidden).toBe(true);
    expect(panel?.getAttribute("aria-labelledby")).toBe(button?.getAttribute("aria-labelledby"));
    expect(one.byId(button?.getAttribute("aria-describedby") ?? null)).not.toBeNull();
  });

  test("nothing chosen shows the placeholder, and the carrier is empty", () => {
    const one = created("picker");
    const [button] = one.role("combobox");
    expect(button?.textContent.trim()).not.toBe("");
    expect(one.posted().map((input) => input.value)).toEqual([""]);
    expect(one.field.querySelector('[aria-selected="true"]')).toBeNull();
  });

  test("the stored value is chosen, shown and carried without a script running", () => {
    const one = edited("picker", "second");
    expect(one.role("combobox")[0]?.textContent.trim()).toBe("Second");
    expect(one.posted().map((input) => input.value)).toEqual(["second"]);
    expect(one.option("second").getAttribute("aria-selected")).toBe("true");
    expect(one.option("first").getAttribute("aria-selected")).toBe("false");
  });

  test("a stored value the field never declared resolves to nothing, not to the first option", () => {
    const html = renderEditForm(choiceCapability("picker", {}, EDITABLE), {
      id: "probe-1",
      value: "third",
    });
    expect(html).not.toContain("third");
    const one = drawn(html);
    expect(one.posted().map((input) => input.value)).toEqual([""]);
    expect(one.field.querySelector('[aria-selected="true"]')).toBeNull();
  });

  test("every option carries a stable id for active-descendant reporting", () => {
    const ids = created("picker")
      .role("option")
      .map((option) => option.id);
    expect(ids.every((id) => id !== "")).toBe(true);
    expect(new Set(ids).size).toBe(PROBE_CHOICE_OPTIONS.length);
    expect(
      created("picker")
        .role("option")
        .map((option) => option.id),
    ).toEqual(ids);
  });
});

/* ── the radio group ───────────────────────────────────────────────────────── */

describe("the radio group draws native inputs", () => {
  test("one labelled radiogroup of real radio inputs sharing the field's name", () => {
    const one = created("radio");
    const [group, ...more] = one.role("radiogroup");
    expect(more).toEqual([]);
    expect(one.byId(group?.getAttribute("aria-labelledby") ?? null)).not.toBeNull();
    expect(one.byId(group?.getAttribute("aria-describedby") ?? null)).not.toBeNull();
    const radios = group?.querySelectorAll('input[type="radio"]') ?? [];
    expect(radios.map((radio) => radio.getAttribute("name"))).toEqual(["value", "value"]);
    // Each radio is named by the words beside it: its label is the one wrapping it.
    expect(radios[0]?.closest("label")?.textContent).toContain("First");
  });

  test("the stored value is the checked input, and nothing else is", () => {
    const one = edited("radio", "second");
    expect(one.radio("second").checked).toBe(true);
    expect(one.radio("first").checked).toBe(false);
  });

  test("no value carrier: an unchecked group posts nothing, which is no selection", () => {
    const one = created("radio");
    expect(one.posted().every((input) => input.getAttribute("type") === "radio")).toBe(true);
    expect(one.posted().some((input) => input.checked)).toBe(false);
  });
});

/* ── the segmented control ─────────────────────────────────────────────────── */

describe("the segmented control draws one exclusive button set", () => {
  test("a labelled group of buttons, one of which is pressed", () => {
    const one = edited("segmented", "second");
    const [group] = one.role("group");
    expect(one.byId(group?.getAttribute("aria-labelledby") ?? null)).not.toBeNull();
    expect(one.byId(group?.getAttribute("aria-describedby") ?? null)).not.toBeNull();
    const second = one.option("second");
    expect(second.tag).toBe("button");
    expect(second.getAttribute("type")).toBe("button");
    expect(second.textContent).toBe("Second");
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(one.option("first").getAttribute("aria-pressed")).toBe("false");
  });

  test("a carrier holds the value, because a button posts nothing", () => {
    const one = created("segmented");
    expect(one.posted().map((input) => [input.getAttribute("type"), input.value])).toEqual([
      ["hidden", ""],
    ]);
    expect(one.field.querySelector('[aria-pressed="true"]')).toBeNull();
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
const flat = { values: RICH_OPTIONS.map(({ group, note, ...rest }) => rest), groups: [] };

/** Each group a role names, with the heading it is named by and the options it holds. */
function groupsOf(one: ReturnType<typeof drawn>, role: string) {
  return one.role(role).map((group) => ({
    heading: one.byId(group.getAttribute("aria-labelledby"))?.textContent.trim(),
    holds: group
      .querySelectorAll("[data-value], input[type='radio']")
      .map((option) => option.getAttribute("data-value") ?? option.value),
  }));
}

describe("group headings are announced as option groups", () => {
  test("the picker wraps each run in a group named by its heading", () => {
    // The wrapper carries the semantics; the heading stays presentational, as the design
    // draws it — a second non-option child would break the listbox's required children.
    const one = created("picker", rich);
    expect(groupsOf(one, "group")).toEqual([
      { heading: "Open", holds: ["first"] },
      { heading: "Closed", holds: ["second", "third"] },
    ]);
    const heading = one.byId(one.role("group")[0]?.getAttribute("aria-labelledby") ?? null);
    expect(heading?.getAttribute("role")).toBe("presentation");
  });

  test("a grouped radio set becomes one radiogroup per heading, inside a plain group", () => {
    // `radiogroup` owns radios and nothing else, so a heading wrapper inside one would
    // take its own radios out of it. The runs become the radiogroups instead.
    const one = created("radio", rich);
    expect(one.role("group")).toHaveLength(1);
    // The ungrouped run is a radiogroup too, named by the field itself.
    expect(groupsOf(one, "radiogroup")).toEqual([
      { heading: "Value optional", holds: ["loose"] },
      { heading: "Open", holds: ["first"] },
      { heading: "Closed", holds: ["second", "third"] },
    ]);
  });

  test("an ungrouped radio set stays the single radiogroup the design draws", () => {
    const one = created("radio");
    expect(one.role("radiogroup")).toHaveLength(1);
    expect(one.role("group")).toHaveLength(0);
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
  for (const presentation of ["picker", "radio"] as const) {
    test(`the ${presentation}'s note rides the option and is named as its description`, () => {
      const one = created(presentation, rich);
      const described = one.field
        .querySelectorAll("[aria-describedby]")
        .filter((node) => node.getAttribute("data-value") === "first" || node.value === "first");
      expect(described).toHaveLength(1);
      const note = one.byId(described[0]?.getAttribute("aria-describedby") ?? null);
      expect(note?.textContent).toBe("still moving");
      // Hidden from the name, not from the description: the note sits inside the option, so
      // without this it is read twice. `aria-describedby` reaches a hidden node either way.
      expect(note?.getAttribute("aria-hidden")).toBe("true");
    });
  }

  test("an option with no note names no description", () => {
    // The control itself is always described, by its guidance slot, so what is checked is that it
    // is the only thing described, whatever an option called its own description.
    const one = created("picker");
    const described = one.field.querySelectorAll("[aria-describedby]");
    expect(described).toEqual(one.role("combobox"));
  });
});

describe("a disabled option is announced as disabled", () => {
  test("the picker marks it aria-disabled, which movement and typeahead skip", () => {
    const one = created("picker", rich);
    expect(one.option("third").getAttribute("aria-disabled")).toBe("true");
    expect(one.option("second").hasAttribute("aria-disabled")).toBe(false);
  });

  test("the radio group and the segmented row use the native disabled attribute", () => {
    expect(created("radio", rich).radio("third").disabled).toBe(true);
    expect(created("segmented", flat).option("third").disabled).toBe(true);
  });

  test("the option a record already holds is never refused, in any presentation", () => {
    const picker = edited("picker", "third", rich);
    expect(picker.option("third").getAttribute("aria-selected")).toBe("true");
    expect(picker.option("third").hasAttribute("aria-disabled")).toBe(false);
    expect(picker.posted().map((input) => input.value)).toEqual(["third"]);
    expect(picker.role("combobox")[0]?.textContent.trim()).toBe("Third");

    const radio = edited("radio", "third", rich);
    expect(radio.radio("third").checked).toBe(true);
    expect(radio.radio("third").disabled).toBe(false);

    const segmented = edited("segmented", "third", flat);
    expect(segmented.option("third").getAttribute("aria-pressed")).toBe("true");
    expect(segmented.option("third").disabled).toBe(false);
  });
});
