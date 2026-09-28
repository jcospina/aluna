// Where a refusal puts the person, what correcting a field leaves behind, and what the module
// leaves alone: each run through the real `public/field-errors.js` on the form the server renders.

import { describe, expect, test } from "bun:test";

import { clearFieldError, markFieldError, relocateFieldError } from "#shell/field-errors.js";
import { installDomGlobals } from "../controls/choice-picker.fixture.test-support.ts";
import { type El, parseHtml } from "../controls/choice-picker.test-support.ts";
import { REQUIRED_FIELD_SENTENCE } from "./field-chrome.ts";
import { capabilityOf, requiredRefusal, scene, tick } from "./field-errors.test-support.ts";
import { probeField } from "./field-renderer.test-support.ts";

installDomGlobals();

const STATUS = { name: "status", label: "Status" };
const VALUES = [
  { value: "off", label: "Off", disabled: true as const },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
];

/** Every node under `root`, as markup would say it: its tag, its attributes and its own words. */
const shape = (root: El) =>
  [root, ...root.descendants()].map((node) => [node.tag, { ...node.attributes }, node.ownText]);

describe("where a refusal puts the person", () => {
  test("a segmented row lands on its first segment that can be pressed", async () => {
    const one = await scene(
      capabilityOf([probeField("choice", { ...STATUS, values: VALUES })], {
        choice_inputs: [{ field: "status", presentation: "segmented" }],
      }),
    );
    one.submit();
    expect(one.doc.activeElement.getAttribute("data-value")).toBe("low");
    expect(one.doc.activeElement.focusOptions).toEqual({ focusVisible: true });
  });

  test("a radio group lands on its first radio that can be chosen", async () => {
    const one = await scene(
      capabilityOf([probeField("choice", { ...STATUS, values: VALUES })], {
        choice_inputs: [{ field: "status", presentation: "radio" }],
      }),
    );
    one.reportMissing("status");
    await tick();
    expect(one.doc.activeElement.getAttribute("value")).toBe("low");
  });
});

describe("what correcting a field leaves behind", () => {
  test("a corrected field is exactly the field the server rendered, hint or none", async () => {
    for (const guidance of [[{ field: "value", text: "Keep it short." }], []]) {
      const one = await scene(capabilityOf([probeField("string")], { guidance }));
      const field = one.fieldNamed("value");
      const rendered = shape(field);
      one.reportMissing("value");
      expect(shape(field)).not.toEqual(rendered);
      one.doc.fire("input", one.doc.querySelector('[name="value"]') as El);
      expect(shape(field)).toEqual(rendered);
    }
  });

  test("clearing says whether there was anything to clear", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    const field = one.fieldNamed("value");
    expect(clearFieldError(field as never)).toBe(false);
    markFieldError(field as never, REQUIRED_FIELD_SENTENCE);
    expect(clearFieldError(field as never)).toBe(true);
    expect(clearFieldError(field as never)).toBe(false);
  });
});

describe("what a refusal's notice can say", () => {
  test("its sentence is said without the space around it, and an empty one reaches no field", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    const [notice] = parseHtml(requiredRefusal(["value"]), one.form).querySelectorAll(
      "[data-error-fields]",
    ) as [El];
    const sentence = notice.textContent.trim();
    notice.textContent = `  ${sentence}  `;
    expect(relocateFieldError(one.form as never, notice as never)).toEqual([
      one.fieldNamed("value"),
    ]);
    expect(one.saidIn("value")).toBe(sentence);
    one.doc.fire("input", one.doc.querySelector('[name="value"]') as El);
    notice.textContent = "   ";
    expect(relocateFieldError(one.form as never, notice as never)).toEqual([]);
    expect(one.isInvalid("value")).toBe(false);
  });
});

describe("what the module refuses, and what it leaves alone", () => {
  test("a required list holding only spaces holds nothing, and is refused", async () => {
    const one = await scene(
      capabilityOf([probeField("string[]")], {
        list_inputs: [{ field: "value", mode: "repeatable" }],
      }),
    );
    (one.doc.querySelector("[data-list-field-row] input") as El).value = "   ";
    expect(one.submit().prevented).toBe(true);
    expect(one.isInvalid("value")).toBe(true);
  });

  test("a form without the platform's sentence says it is a rendering bug", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    one.form.removeAttribute("data-required-message");
    expect(() => one.reportMissing("value")).toThrow(/required sentence/);
  });

  test("a control outside every field keeps the browser's own words", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    const html = one.doc.querySelector("html") as El;
    parseHtml('<form><input name="q" required></form>', html);
    const bare = html.querySelector('[name="q"]') as El;
    (bare as unknown as { validity: { valueMissing: boolean } }).validity = { valueMissing: true };
    expect(one.doc.fire("invalid", bare).prevented).toBe(false);
  });

  test("typing outside every field, or an answer outside every form, disturbs nothing", async () => {
    const one = await scene(capabilityOf([probeField("string")]));
    const html = one.doc.querySelector("html") as El;
    parseHtml(
      '<input type="search"><div class="said" aria-live="polite"><p>Saved.</p></div>',
      html,
    );
    expect(() =>
      one.doc.fire("input", html.querySelector("input[type=search]") as El),
    ).not.toThrow();
    const live = html.querySelector(".said") as El;
    expect(() => one.doc.fire("htmx:afterSwap", live)).not.toThrow();
    expect(live.textContent).toBe("Saved.");
  });
});
