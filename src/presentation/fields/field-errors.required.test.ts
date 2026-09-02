// What stops a submission before it is sent: the browser's own required check with its
// foreign tooltip taken off it, the drawn picker's recovered one, the shapes a marked field
// says so on, and the paint all of it depends on.

import { describe, expect, test } from "bun:test";
import { installDomGlobals } from "../controls/choice-picker.fixture.test-support.ts";
import { El, parseHtml } from "../controls/choice-picker.test-support.ts";
import { readSource } from "../safety/source.test-support.ts";
import { REQUIRED_FIELD_SENTENCE } from "./field-chrome.ts";
import {
  capabilityOf,
  overLengthRefusal,
  requiredRefusal,
  scene,
  tick,
} from "./field-errors.test-support.ts";
import { probeField } from "./field-renderer.test-support.ts";
import { renderCreateForm } from "./field-renderer.ts";

installDomGlobals();

/* ── the browser's own check, and the one the picker gave up ────────────────── */

describe("a required field is refused in the browser", () => {
  test("the foreign tooltip is cancelled and the platform's sentence is said instead", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    const refused = one.reportMissing("value");
    expect(refused.prevented).toBe(true);
    expect(one.saidIn("value")).toBe(REQUIRED_FIELD_SENTENCE);
    expect(one.isInvalid("value")).toBe(true);
  });

  test("the pass ends standing on the first field it marked, not the first event", async () => {
    // Cancelling every `invalid` takes the browser's focus and its scroll along with the
    // bubble, so a refusal on a form taller than its scroller would happen off screen.
    const one = await scene(
      capabilityOf(
        [
          probeField("choice", { name: "status", label: "Status" }),
          probeField("string", { name: "title", label: "Title" }),
        ],
        { choice_inputs: [{ field: "status", presentation: "picker" }] },
      ),
    );
    // The browser reports the only control it can validate, which is the second field.
    one.reportMissing("title");
    await tick();
    expect(one.doc.activeElement?.classList.contains("listbox__button")).toBe(true);
  });

  test("a required field left empty is never refused with nothing said", async () => {
    // The bubble is cancelled only once the sentence is standing in its place. A throw
    // between the two would take the browser's words away and put none of ours there.
    const one = await scene(capabilityOf([probeField("string")]));
    one.slotOf("value").remove();
    expect(() => one.reportMissing("value")).toThrow(/guidance slot/);
    expect(one.reported).toHaveLength(1);
    expect(one.reported[0]?.defaultPrevented).toBe(false);
  });

  test("a submission already refused above this module is left entirely alone", async () => {
    // The destructive question standing over a record form is the one that refuses first
    // (`public/record-mutations.js`), and while it stands it owns the focus.
    const one = await scene(
      capabilityOf([probeField("choice", { name: "status", label: "Status" })], {
        choice_inputs: [{ field: "status", presentation: "picker" }],
      }),
      { refuseSubmit: true },
    );
    one.submit();
    expect(one.refusals).toHaveLength(1);
    expect(one.isInvalid("status")).toBe(false);
    expect(one.doc.activeElement).toBeNull();
  });

  test("anything other than a missing value keeps the browser's own words", async () => {
    // The platform has authored one sentence, for one failure. Saying it about a failure
    // it was not written for, or inventing a second, is the second copy source this whole
    // slice exists to avoid — so the browser keeps that one.
    const one = await scene(capabilityOf([probeField("number")]));
    const control = one.doc.querySelector('[name="value"]') as El;
    (control as unknown as { validity: { valueMissing: boolean } }).validity = {
      valueMissing: false,
    };
    expect(one.doc.fire("invalid", control).prevented).toBe(false);
    expect(one.isInvalid("value")).toBe(false);
  });

  test("the drawn picker is refused too, and the request is never made", async () => {
    const one = await scene(
      capabilityOf([probeField("choice", { name: "status", label: "Status" })], {
        choice_inputs: [{ field: "status", presentation: "picker" }],
      }),
    );
    const submitted = one.submit();

    expect(submitted.prevented).toBe(true);
    // Stopped as well as prevented: htmx listens on the form itself, and a refusal that
    // only cancelled the default would still have posted. Asked of a listener standing
    // exactly where htmx's does rather than of the flag.
    expect(submitted.stopped).toBe(true);
    expect(one.posted).toHaveLength(0);
    expect(one.saidIn("status")).toBe(REQUIRED_FIELD_SENTENCE);
    expect(one.doc.activeElement?.classList.contains("listbox__button")).toBe(true);
  });

  test("the segmented row is refused on the same word, which is all it can carry", async () => {
    const one = await scene(
      capabilityOf([probeField("choice", { name: "status", label: "Status" })], {
        choice_inputs: [{ field: "status", presentation: "segmented" }],
      }),
    );
    expect(one.submit().prevented).toBe(true);
    expect(one.isInvalid("status")).toBe(true);
  });

  test("a picker already holding a value lets the submission go", async () => {
    const one = await scene(
      capabilityOf([probeField("choice", { name: "status", label: "Status" })], {
        choice_inputs: [{ field: "status", presentation: "picker" }],
      }),
    );
    (one.doc.querySelector("[data-choice-value]") as El).value = "first";
    expect(one.submit().prevented).toBe(false);
    expect(one.isInvalid("status")).toBe(false);
  });

  test("choosing a value clears it, through the change the picker announces", async () => {
    const one = await scene(
      capabilityOf([probeField("choice", { name: "status", label: "Status" })], {
        choice_inputs: [{ field: "status", presentation: "picker" }],
      }),
    );
    one.submit();
    const carrier = one.doc.querySelector("[data-choice-value]") as El;
    carrier.value = "first";
    one.doc.fire("change", carrier);
    expect(one.isInvalid("status")).toBe(false);
  });

  test("an optional choice is never asked for, and a radio group is left to the browser", async () => {
    const optional = await scene(
      capabilityOf([probeField("choice", { name: "status", label: "Status", required: false })], {
        choice_inputs: [{ field: "status", presentation: "picker" }],
      }),
    );
    expect(optional.submit().prevented).toBe(false);

    // The radio group keeps a real native constraint on real inputs, so it has no carrier
    // to mark and nothing here to enforce: a second check over it would be a second
    // refusal for one empty field.
    const radio = await scene(
      capabilityOf([probeField("choice", { name: "status", label: "Status" })], {
        choice_inputs: [{ field: "status", presentation: "radio" }],
      }),
    );
    expect(radio.doc.querySelector("[data-choice-value]")).toBeNull();
    expect(radio.submit().prevented).toBe(false);
  });

  test("one press marks everything missing, the typed field and the picker together", async () => {
    const one = await scene(
      capabilityOf(
        [
          probeField("string", { name: "title", label: "Title" }),
          probeField("choice", { name: "status", label: "Status" }),
        ],
        { choice_inputs: [{ field: "status", presentation: "picker" }] },
      ),
    );
    // Native validation refuses the submit before it fires, so without this the picker
    // would only admit to being empty on the *next* press.
    one.reportMissing("title");
    expect(one.isInvalid("title")).toBe(true);
    expect(one.isInvalid("status")).toBe(true);
  });
});

/* ── the form is the platform's, and stays the platform's ──────────────────── */

/* ── every shape the form draws, and the one that is not this form ─────────── */

describe("a field says it is invalid on every control it is made of", () => {
  test("a repeatable list marks every row, because every row is the field", async () => {
    const one = await scene(
      capabilityOf([probeField("string[]", { required: false })], {
        list_inputs: [{ field: "value", mode: "repeatable" }],
      }),
      { record: { id: "probe-1", value: ["first", "second"] } },
    );
    one.landRefusal(requiredRefusal(["value"]));
    expect(one.invalidControls("value")).toEqual(["input", "input"]);
  });

  test("a radio group and a segmented row say it on the group, not on one option", async () => {
    for (const presentation of ["radio", "segmented"] as const) {
      const one = await scene(
        capabilityOf([probeField("choice", { name: "status", label: "Status" })], {
          choice_inputs: [{ field: "status", presentation }],
        }),
      );
      one.landRefusal(requiredRefusal(["status"]));
      expect(one.invalidControls("status")).toEqual(["div"]);
    }
  });

  test("an added row inherits the verdict, and loses it with the rest of the field", async () => {
    // `addListFieldRow` clones a row wholesale (`public/list-field.js`), so a row added
    // while the field is marked arrives already saying so — which is right, it is the same
    // field — and must stop saying it when the field does.
    const one = await scene(
      capabilityOf([probeField("string[]", { required: false })], {
        list_inputs: [{ field: "value", mode: "repeatable" }],
      }),
      { record: { id: "probe-1", value: ["first"] } },
    );
    one.landRefusal(requiredRefusal(["value"]));
    const rows = one.fieldNamed("value").querySelector("[data-list-field-values]") as El;
    rows.append((rows.querySelector("[data-list-field-row]") as El).cloneNode(true));
    expect(one.invalidControls("value")).toEqual(["input", "input"]);

    one.doc.fire("input", one.doc.querySelector('[name="value"]') as El);

    expect(one.invalidControls("value")).toEqual([]);
  });

  test("two forms in one document answer only for their own fields", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    // A second capability's form, standing beside the first the way a record view and a
    // collection do. Both draw a field called `value`; a refusal aimed at one of them must
    // not reach into the other.
    const second = new El("div");
    (one.doc.querySelector("html") as El).append(second);
    parseHtml(renderCreateForm({ ...capabilityOf([probeField("string")]), id: "other" }), second);
    const otherField = (second.querySelector('[name="value"]') as El).closest(".field") as El;

    one.landRefusal(requiredRefusal(["value"]));

    expect(one.isInvalid("value")).toBe(true);
    expect(otherField.classList.contains("is-invalid")).toBe(false);
  });

  test("the record's own form says it the same way the create form does", async () => {
    const one = await scene(
      capabilityOf([probeField("string", { max_length: 64 })], {
        guidance: [{ field: "value", text: "Keep it short." }],
      }),
      { record: { id: "probe-1", value: "held" } },
    );
    one.landRefusal(overLengthRefusal(["value"]));
    expect(one.isInvalid("value")).toBe(true);
    expect(one.saidIn("value")).toBe(
      "That's longer than this field holds. Mind trimming it a little?",
    );
    one.doc.fire("input", one.doc.querySelector('[name="value"]') as El);
    expect(one.saidIn("value")).toBe("Keep it short.");
  });
});

/* ── what the two stylesheets have to be saying for any of it to show ───────── */

describe("the paint the marked state depends on", () => {
  const DESIGN = readSource("design/styles/components/form-controls.css");
  const PRODUCT = readSource("public/css/fields.css");

  /** One rule's body, by its exact selector list. */
  const body = (css: string, selector: string) => css.split(selector).at(1)?.split("}").at(0) ?? "";

  test("an empty slot takes no line, which the guidance's own display would deny it", () => {
    // `.field__guidance { display: block }` outranks the user agent's `[hidden]`, so
    // without this restatement every field on the form grows a blank line under it.
    expect(body(DESIGN, ".field__guidance[hidden] {")).toContain("display: none");
  });

  test("signal goes to the line that is the error, not to every line beside it", () => {
    expect(body(DESIGN, ".field.is-invalid .field__control {")).toContain("var(--well-alert)");
    expect(
      body(
        DESIGN,
        [
          ".field.is-invalid .field__guidance--error,",
          ".field.is-invalid .field__guidance.is-over {",
        ].join("\n"),
      ),
    ).toContain("var(--signal)");
    // And not the blanket rule this replaced: a declared hint and a character count stay
    // what they were while the field is invalid.
    expect(DESIGN).not.toContain(".field.is-invalid .field__guidance {");
  });

  test("the three controls with no well of their own still take the fill", () => {
    // A radio group and a segmented row are sets of their own marks and a checkbox is a
    // mark, so `.field__control` — the only thing the design recolours — is not there.
    expect(
      body(
        PRODUCT,
        [
          '.field--choice[data-choice-presentation="radio"].is-invalid,',
          '.field--choice[data-choice-presentation="segmented"].is-invalid,',
          ".field--inline.is-invalid {",
        ].join("\n"),
      ),
    ).toContain("var(--well-alert)");
  });
});

describe("the form stays the platform's, and the copy stays the platform's", () => {
  test("a form in generated item markup is unwrapped before it reaches a page", async () => {
    // Forms are platform chrome; a generated renderer that drew one — with its own copy
    // for a business error it also declared — would be the second copy source. The runtime
    // enforcer already unwraps every interactive element, and that is what keeps it true.
    const { enforceItemMarkup } = await import("../safety/enforcer.ts");
    const cleaned = enforceItemMarkup(
      '<form action="/x"><input name="title" required><button>Save</button></form>',
    );
    expect(cleaned).not.toContain("<form");
    expect(cleaned).not.toContain("<input");
    expect(cleaned).not.toContain("<button");
  });
});
