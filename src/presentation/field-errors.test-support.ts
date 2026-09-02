// What both field-error suites are built from: the capability fixtures, the refusal
// fragments taken off the real response builders, and the one scene that puts a rendered
// form into the DOM double with the module started over it.
//
// Held apart from the suites themselves for the reason `choice-picker.fixture.test-support.ts`
// gives: a double is a browser small enough to run in Bun, and this is what we put inside it.

import type { Context } from "hono";
import type { SpecField, UiFormIntent } from "../registry/index.ts";
import { MaxLengthExceededError, MissingRequiredFieldsError } from "../runtime/data/internal.ts";
import {
  maxLengthExceededFailure,
  missingRequiredFieldsFailure,
} from "../runtime/router/wire/failure-responses.ts";
import { Doc, El, parseHtml } from "./choice-picker.test-support.ts";
import { type RenderableCapability, renderCreateForm, renderEditForm } from "./field-renderer.ts";

const EMPTY_FORM: UiFormIntent = {
  list_inputs: [],
  choice_inputs: [],
  long_text: [],
  guidance: [],
};

export function capabilityOf(
  fields: readonly SpecField[],
  form: Partial<UiFormIntent> = {},
): RenderableCapability {
  return {
    id: "probe",
    label: "Probe",
    noun: "probe",
    schema: { fields },
    form: { ...EMPTY_FORM, ...form },
    actions: ["create", "read"],
  };
}

/**
 * The fragment the router really answers with, taken off the real response builder.
 *
 * `c.header` is the retarget the shell already honours and says nothing about this module;
 * `c.html` is the body, which is everything it reads.
 */
export function refusalFrom(build: (c: Context) => Response): string {
  let body = "";
  const context = {
    header: () => {},
    html: (written: string) => {
      body = written;
      return new Response(written);
    },
  } as unknown as Context;
  build(context);
  return body;
}

export const requiredRefusal = (fields: readonly string[]) =>
  refusalFrom((c) =>
    missingRequiredFieldsFailure(c, "probe", new MissingRequiredFieldsError("probe", fields)),
  );

export const overLengthRefusal = (fields: readonly string[]) =>
  refusalFrom((c) =>
    maxLengthExceededFailure(c, "probe", new MaxLengthExceededError("probe", fields)),
  );

/** One macrotask, which is longer than the microtask the reporting pass ends in. */
export const tick = () => new Promise((done) => setTimeout(done, 0));

export interface SceneOptions {
  /** A committed record, to run the edit form instead of the create form. */
  readonly record?: Readonly<Record<string, unknown>>;
  /**
   * A capture-phase submit listener installed *before* the module's, standing for the one
   * `public/record-mutations.js` installs over a standing delete confirmation.
   */
  readonly refuseSubmit?: boolean;
}

/** A document holding one rendered form, with the module started over all of it. */
export async function scene(capability: RenderableCapability, options: SceneOptions = {}) {
  const { startFieldErrors } = await import("#shell/field-errors.js");
  const doc = new Doc();
  const root = new El("html");
  doc.append(root);
  const markup =
    options.record === undefined
      ? renderCreateForm(capability)
      : renderEditForm(capability, options.record);
  parseHtml(markup, root);
  // Installed before the module's, so it holds the very event the module then handles —
  // which is the only way to ask, after a listener has thrown, what it had done first.
  const reported: { defaultPrevented: boolean }[] = [];
  doc.addEventListener(
    "invalid",
    (event) => {
      reported.push(event as unknown as { defaultPrevented: boolean });
    },
    true,
  );
  const refusals: unknown[] = [];
  // Where htmx listens: on the form, in the bubble phase. Standing in for it is the only
  // way to ask whether the request would have been made.
  const posted: unknown[] = [];
  const formNode = doc.querySelector("form") as El;
  formNode.addEventListener("submit", (event) => {
    posted.push(event);
  });
  if (options.refuseSubmit === true) {
    doc.addEventListener(
      "submit",
      (event) => {
        refusals.push(event);
        (event as { preventDefault(): void }).preventDefault();
      },
      true,
    );
  }
  startFieldErrors(doc as never);

  const form = doc.querySelector("form") as El;
  const region = doc.querySelector('[aria-live="polite"]') as El;
  const fieldNamed = (name: string) =>
    (doc.querySelector(`[name="${name}"]`) as El).closest(".field") as El;
  const slotOf = (name: string) => fieldNamed(name).querySelector("[data-field-guidance]") as El;

  return {
    doc,
    form,
    region,
    fieldNamed,
    slotOf,
    /** What htmx does once a retargeted refusal has landed in the error region. */
    landRefusal: (fragment: string) => {
      parseHtml(fragment, region);
      return doc.fire("htmx:afterSwap", region);
    },
    /** The browser's own refusal of an empty required control, tooltip and all. */
    reportMissing: (name: string) => {
      const control = doc.querySelector(`[name="${name}"]`) as El;
      (control as unknown as { validity: { valueMissing: boolean } }).validity = {
        valueMissing: true,
      };
      return doc.fire("invalid", control);
    },
    submit: () => doc.fire("submit", form),
    refusals,
    reported,
    posted,
    isInvalid: (name: string) => fieldNamed(name).classList.contains("is-invalid"),
    saidIn: (name: string) => slotOf(name).textContent,
    invalidControls: (name: string) =>
      fieldNamed(name)
        .querySelectorAll("[aria-invalid]")
        .map((control) => control.tag),
  };
}
