// Where a validation error is said: the marker the router has always written, read at last,
// and moved out of the form's shared error slot into the field it is about.
//
// The refusals are taken off the real response builders in `src/runtime/router/wire/failure-responses.ts`
// rather than typed out here. The whole point is that the sentence is *relocated*, and a
// sentence relocated from a fixture is a sentence nobody sent.

import { describe, expect, test } from "bun:test";

import { MissingRequiredFieldsError } from "../../runtime/data/internal.ts";
import { missingRequiredFieldsFailure } from "../../runtime/router/wire/failure-responses.ts";
import { installDomGlobals } from "../controls/choice-picker.fixture.test-support.ts";
import { type El, parseHtml } from "../controls/choice-picker.test-support.ts";
import { codeOf, readSource } from "../safety/source.test-support.ts";
import { REQUIRED_FIELD_SENTENCE } from "./field-chrome.ts";
import {
  capabilityOf,
  overLengthRefusal,
  refusalFrom,
  requiredRefusal,
  scene,
} from "./field-errors.test-support.ts";
import { probeField } from "./field-renderer.test-support.ts";
import { renderCreateForm } from "./field-renderer.ts";

installDomGlobals();

/* ── the seam ──────────────────────────────────────────────────────────────── */

describe("the shipped page runs the module against what the server writes", () => {
  const MODULE = codeOf("public/field-errors.js");

  test("the shell loads it and it starts itself", () => {
    expect(readSource("public/index.html")).toContain(
      '<script type="module" src="/static/field-errors.js"></script>',
    );
    expect(MODULE).toContain('if (typeof document !== "undefined") startFieldErrors(document);');
  });

  test("every hook the module queries by is one the renderer emits", () => {
    // One form drawing every control the module knows how to speak for.
    const rendered = renderCreateForm(
      capabilityOf(
        [
          probeField("string", { name: "title", label: "Title" }),
          probeField("choice", { name: "status", label: "Status" }),
          probeField("choice", { name: "mood", label: "Mood" }),
          probeField("choice", { name: "shape", label: "Shape" }),
        ],
        {
          choice_inputs: [
            { field: "status", presentation: "picker" },
            { field: "mood", presentation: "radio" },
            { field: "shape", presentation: "segmented" },
          ],
        },
      ),
    );
    for (const hook of [
      "data-field-guidance",
      "data-choice-value",
      "data-choice-required",
      "listbox__button",
      "field__input",
      "choice-set",
      "segmented",
      'aria-live="polite"',
    ]) {
      expect(MODULE).toContain(hook);
      expect(rendered).toContain(hook);
    }
    // The two classes it writes rather than reads, which the design system is what
    // defines: the error's own line, and the state the field goes into.
    const design = readSource("design/styles/components/form-controls.css");
    for (const written of ["field__guidance--error", "is-invalid"]) {
      expect(MODULE).toContain(written);
      expect(design).toContain(written);
    }
    // The dataset spelling is the same attribute read the other way round.
    expect(MODULE).toContain("requiredMessage");
    expect(rendered).toContain("data-required-message=");
  });

  test("the marker it reads is the one the failure responses write", () => {
    expect(MODULE).toContain("data-error-fields");
    expect(requiredRefusal(["value"])).toContain('data-error-fields="value"');
    expect(overLengthRefusal(["value"])).toContain('data-error-fields="value"');
  });

  test("the marker is escaped on its way out, like every other authored string", () => {
    // Field names are validated to `[a-z][a-z0-9_]*` long before here, and the client
    // checks the same shape again before spending one in a selector. This is the third
    // lock, and it is the one that costs nothing: the attribute is written by the server.
    expect(requiredRefusal(['title" onx="'])).toContain(
      'data-error-fields="title&quot; onx=&quot;"',
    );
  });

  test("the required sentence has one author, and the form is where it is written", () => {
    // The client holds no copy of its own: it reads the words off the form the server
    // rendered. A second literal here would be a second source for one sentence.
    expect(MODULE).not.toContain(REQUIRED_FIELD_SENTENCE);
    expect(renderCreateForm(capabilityOf([probeField("string")]))).toContain(
      `data-required-message="${REQUIRED_FIELD_SENTENCE}"`,
    );
  });
});

/* ── a refusal is relocated, not restated ──────────────────────────────────── */

describe("a field error is said in its own field", () => {
  test("the sentence takes the guidance's place and the field says it is invalid", async () => {
    const one = await scene(
      capabilityOf([probeField("string", { max_length: 64 })], {
        guidance: [{ field: "value", text: "Keep it short." }],
      }),
    );
    expect(one.saidIn("value")).toBe("Keep it short.");

    one.landRefusal(overLengthRefusal(["value"]));

    expect(one.saidIn("value")).toBe(
      "That's longer than this field holds. Mind trimming it a little?",
    );
    expect(one.isInvalid("value")).toBe(true);
    expect(one.slotOf("value").classList.contains("field__guidance--error")).toBe(true);
    expect((one.doc.querySelector('[name="value"]') as El).getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  test("it is moved out of the form's error region, not copied into the field", async () => {
    const one = await scene(capabilityOf([probeField("string", { max_length: 64 })]));
    one.landRefusal(overLengthRefusal(["value"]));
    expect(one.region.textContent).toBe("");
  });

  test("the counter beside it keeps saying what it was saying", async () => {
    const one = await scene(capabilityOf([probeField("string", { max_length: 64 })]));
    one.landRefusal(overLengthRefusal(["value"]));
    const counter = one.fieldNamed("value").querySelector(".field__guidance--count") as El;
    expect(counter.textContent).toBe("64 characters left");
    expect(counter.classList.contains("field__guidance--error")).toBe(false);
  });

  test("every field the marker names is reached, in the order it named them", async () => {
    const one = await scene(
      capabilityOf([
        probeField("string", { name: "title", label: "Title" }),
        probeField("string", { name: "body", label: "Body" }),
      ]),
    );
    one.landRefusal(requiredRefusal(["title", "body"]));
    expect(one.isInvalid("title")).toBe(true);
    expect(one.isInvalid("body")).toBe(true);
    expect(one.saidIn("body")).toBe("I still need a little more before I can add this.");
    // The first one named is where the person is put, so the correction starts there.
    expect(one.doc.activeElement?.getAttribute("name")).toBe("title");
  });

  test("a Handler's own words arrive unrewritten, and cannot become markup", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    // What a generated Handler returns for a declared business error: its own product
    // voice, its own sentence. The platform moves it and does not touch it.
    one.landRefusal(
      '<div data-role="error" data-error-code="already_borrowed" data-error-fields="value">' +
        "Someone already has that one out. <b>Pick another?</b></div>",
    );
    expect(one.saidIn("value")).toBe("Someone already has that one out. Pick another?");
    expect(one.slotOf("value").querySelector("b")).toBeNull();
  });

  test("a fresh verdict clears the last one rather than stacking on it", async () => {
    const one = await scene(
      capabilityOf([
        probeField("string", { name: "title", label: "Title" }),
        probeField("string", { name: "body", label: "Body" }),
      ]),
    );
    one.landRefusal(requiredRefusal(["title", "body"]));
    one.landRefusal(requiredRefusal(["body"]));
    expect(one.isInvalid("title")).toBe(false);
    expect(one.isInvalid("body")).toBe(true);
  });
});

/* ── and the answers it cannot place, which stay where they landed ─────────── */

describe("a refusal this form has nowhere to put", () => {
  test("a swap that is not an answer landing in the error region is not read as one", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    // The whole form, a records region, a record view: htmx swaps all of them, and the
    // marker the module reads has no business being anywhere but the form's own live slot.
    parseHtml(requiredRefusal(["value"]), one.form);
    one.doc.fire("htmx:afterSwap", one.form);
    expect(one.isInvalid("value")).toBe(false);
  });

  test("a refusal naming nothing this form draws is left standing where it landed", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    one.landRefusal(requiredRefusal(["gone"]));
    expect(one.isInvalid("value")).toBe(false);
    expect(one.region.textContent).toContain("I still need a little more");
  });

  test("a control the form posts but does not draw a field around is left alone", async () => {
    // The rename editor is one (`src/web/fragments.ts`): a real form, a `.field__input`
    // inside a `.field__control`, and no `.field` anywhere to say anything in.
    const one = await scene(capabilityOf([probeField("string")]));
    parseHtml('<input name="label" value="x">', one.form);
    expect(() => one.landRefusal(requiredRefusal(["label"]))).not.toThrow();
    expect(one.region.textContent).toContain("I still need a little more");
  });

  test("a field that names no slot to say it in refuses before it marks anything", async () => {
    const one = await scene(
      capabilityOf([
        probeField("string", { name: "title", label: "Title" }),
        probeField("string", { name: "body", label: "Body" }),
      ]),
    );
    one.slotOf("body").remove();
    expect(() => one.landRefusal(requiredRefusal(["title", "body"]))).toThrow(/guidance slot/);
    // Half a relocation is the worst of both: fields marked *and* the region still saying
    // the same thing. Nothing is marked, and the sentence stays where it landed.
    expect(one.isInvalid("title")).toBe(false);
    expect(one.region.textContent).toContain("I still need a little more");
  });

  test("the record's own refusal says the record's own sentence", async () => {
    const one = await scene(capabilityOf([probeField("string")]), {
      record: { id: "probe-1", value: "held" },
    });
    one.landRefusal(
      refusalFrom((c) =>
        missingRequiredFieldsFailure(
          c,
          "probe",
          new MissingRequiredFieldsError("probe", ["value"], "update"),
        ),
      ),
    );
    expect(one.saidIn("value")).toBe("I still need a little more before I can save this.");
  });

  test("a field name that is not one stays out of the selector it would be spent in", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    // `data-error-fields` is read off generated code, so the one thing it must never be is
    // interpolated unchecked. A pseudo-class is what proves the guard rather than the
    // parser: a browser matches `[name="value:hover"]` against nothing and says nothing,
    // and the double refuses the selector outright — so without the guard this run throws
    // and with it nothing is marked. Both ends of the same rule.
    expect(() =>
      one.landRefusal(
        '<p data-role="error" data-error-code="crafted" data-error-fields="value:hover">x</p>',
      ),
    ).not.toThrow();
    expect(one.isInvalid("value")).toBe(false);
    // And the shape itself, so the regex cannot quietly widen to admit one.
    for (const name of ["value:hover", 'value"],[name', "Value", "_value", "va lue", ""]) {
      expect(/^[a-z][a-z0-9_]*$/.test(name), name).toBe(false);
    }
  });
});

describe("clearing the error puts the field back the way it was rendered", () => {
  test("a declared hint comes back when the field is corrected", async () => {
    const one = await scene(
      capabilityOf([probeField("string")], {
        guidance: [{ field: "value", text: "Two or three sentences." }],
      }),
    );
    one.landRefusal(requiredRefusal(["value"]));
    expect(one.saidIn("value")).toBe("I still need a little more before I can add this.");

    one.doc.fire("input", one.doc.querySelector('[name="value"]') as El);

    expect(one.saidIn("value")).toBe("Two or three sentences.");
    expect(one.isInvalid("value")).toBe(false);
    expect((one.doc.querySelector('[name="value"]') as El).hasAttribute("aria-invalid")).toBe(
      false,
    );
  });

  test("a field that declared none goes back to saying nothing, and taking no line", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    one.landRefusal(requiredRefusal(["value"]));
    expect(one.slotOf("value").hidden).toBe(false);

    one.doc.fire("input", one.doc.querySelector('[name="value"]') as El);

    expect(one.saidIn("value")).toBe("");
    expect(one.slotOf("value").hidden).toBe(true);
  });

  test("a radio group refused once per radio still restores the hint, not the sentence", async () => {
    // The case the stash's write-once guard exists for. A radio group is one field with
    // several required inputs, so the browser reports it once per input and the field is
    // marked two and three times with no clearing in between — and a stash taken on the
    // second would keep the error sentence as if it were the declared hint, for good.
    const one = await scene(
      capabilityOf([probeField("choice", { name: "status", label: "Status" })], {
        choice_inputs: [{ field: "status", presentation: "radio" }],
        guidance: [{ field: "status", text: "Pick where it stands." }],
      }),
    );
    const radios = one.fieldNamed("status").querySelectorAll(".choice__input");
    expect(radios.length).toBeGreaterThan(1);
    for (const radio of radios) {
      (radio as unknown as { validity: { valueMissing: boolean } }).validity = {
        valueMissing: true,
      };
      one.doc.fire("invalid", radio);
    }
    expect(one.saidIn("status")).toBe(REQUIRED_FIELD_SENTENCE);

    one.doc.fire("change", radios[0] as El);

    expect(one.saidIn("status")).toBe("Pick where it stands.");
  });

  test("a second refusal on a standing one still restores the hint, not the first error", async () => {
    const one = await scene(
      capabilityOf([probeField("string")], {
        guidance: [{ field: "value", text: "Two or three sentences." }],
      }),
    );
    one.landRefusal(requiredRefusal(["value"]));
    one.landRefusal(overLengthRefusal(["value"]));
    one.doc.fire("input", one.doc.querySelector('[name="value"]') as El);
    expect(one.saidIn("value")).toBe("Two or three sentences.");
  });

  test("an answer that names no field at all still clears the last verdict", async () => {
    // Half the refusals that land in this region name nothing — a held mutation lease, a
    // record already gone. One of those arriving over a field still saying it is too long
    // would leave that field describing a verdict the server has just not given.
    const one = await scene(capabilityOf([probeField("string", { max_length: 64 })]));
    one.landRefusal(overLengthRefusal(["value"]));
    expect(one.isInvalid("value")).toBe(true);

    one.landRefusal(
      '<p class="notice" data-role="error" data-error-code="mutation_busy">' +
        "I'm still putting something together.</p>",
    );

    expect(one.isInvalid("value")).toBe(false);
    expect(one.region.textContent).toContain("I'm still putting something together.");
  });

  test("putting the draft down puts every verdict on it down too", async () => {
    // Cancel and a committed create both go through `form.reset()`, and a picker is the
    // one control that cannot be put back by it — its value rides a hidden input, whose
    // default a write has already rewritten. The verdict on it goes back either way.
    const one = await scene(
      capabilityOf(
        [
          probeField("string", { name: "title", label: "Title" }),
          probeField("choice", { name: "status", label: "Status" }),
        ],
        {
          choice_inputs: [{ field: "status", presentation: "picker" }],
          guidance: [{ field: "title", text: "A few words." }],
        },
      ),
    );
    one.landRefusal(requiredRefusal(["title", "status"]));
    expect([one.isInvalid("title"), one.isInvalid("status")]).toEqual([true, true]);

    one.doc.fire("reset", one.form);

    expect([one.isInvalid("title"), one.isInvalid("status")]).toEqual([false, false]);
    expect(one.saidIn("title")).toBe("A few words.");
    expect(one.slotOf("status").hidden).toBe(true);
  });
});
