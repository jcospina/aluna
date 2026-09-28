import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PROMPT_FORM_ID } from "#shell/desk-window.js";
import { startPromptBar } from "#shell/prompt-bar.js";
import {
  ACTIVE_CAPABILITY_ATTRIBUTE,
  BUILD_JOB_ID_ATTRIBUTE,
  PROMPT_FIELD_ID,
  PROMPT_NOTICE_ID,
  WINDOW_CONTENT_ID,
} from "#shell/shell-dom.js";

import { DomDocument, El, Template, Text } from "./dom-double.test-support.ts";
import type { DispatchedEvent } from "./dom-events.test-support.ts";

export { El, Template, Text };

// Shell glue, run rather than grepped: `public/app.js` imports nothing, so it runs with the DOM
// globals its rules touch. Shared with app.build-ending and app.prompt-bar-messages. The page's ids
// come from the modules that own them, so every rule the glue answers proves its restated copies.

export const WINDOW_REGION_ID = WINDOW_CONTENT_ID;

/** As much of the shell's Alpine component as these rules touch. */
interface ShellState {
  promptBusy: boolean;
  init(): void;
}

/**
 * Note where a rule stops an event at the document. A capture-phase refusal keeps a submission
 * off the wire before it reaches the form htmx listens on, so the stop is the behaviour.
 */
function watchForStop(event: unknown, stopped: string[]): void {
  if (!(event instanceof Event)) return;
  const stop = event.stopPropagation.bind(event);
  event.stopPropagation = () => {
    stopped.push(event.type);
    stop();
  };
}

/**
 * As much of a document as the shell's rules reach for. Its own function rather than twenty more
 * lines inside `desk()`: what a document answers is a subject, and desk() is at its line ceiling.
 */
function documentOver(
  page: { page: El; region: El; notice: El; promptForm: El; promptField: El },
  dispatched: Array<{ type: string; detail: unknown }>,
) {
  class ShellDocument extends DomDocument {
    querySelector = (selector: string) => page.region.querySelector(selector);
    getElementById = (id: string) => {
      if (id === WINDOW_REGION_ID) return page.region;
      if (id === PROMPT_NOTICE_ID) return page.notice;
      if (id === PROMPT_FORM_ID) return page.promptForm;
      return id === PROMPT_FIELD_ID ? page.promptField : null;
    };
    createElement = (tag: string) => (tag === "template" ? new Template() : new El(tag));

    /** False when a listener answered a cancellable event, which is how the browser reports it. */
    override dispatchEvent(event: DispatchedEvent): boolean {
      dispatched.push({ type: event.type, detail: (event as { detail?: unknown }).detail });
      return super.dispatchEvent(event);
    }
  }
  return new ShellDocument(page.page);
}

/** One run standing in the window, with the surface it displaced beside it. */
export function desk() {
  const region = new El("div", { id: WINDOW_REGION_ID });
  const displaced = new El("div", { [ACTIVE_CAPABILITY_ATTRIBUTE]: "tasks" });
  const subscriber = new El("section", {
    class: "build-stream",
    [BUILD_JOB_ID_ATTRIBUTE]: "build-1",
  });
  const narration = new El("div", { class: "build-stream__narration" });
  const surface = new El("div", { class: "build-stream__fragment" });
  subscriber.append(narration, surface);
  region.append(displaced, subscriber);

  /** Every event a rule stopped at the document — how a capture-phase refusal is seen. */
  const propagationStopped: string[] = [];
  const dispatched: Array<{ type: string; detail: unknown }> = [];
  const processed: El[] = [];
  const notice = new El("div", { id: PROMPT_NOTICE_ID });
  const promptField = new El("input", { id: PROMPT_FIELD_ID });
  const frames: Array<() => void> = [];
  /**
   * The bar itself: the form a prompt is submitted from, and what the 400ms refusal cue goes on.
   * An element, because the desk-action guard steps around this form by its id.
   */
  class FormStub extends El {
    constructor() {
      super("form", {
        id: PROMPT_FORM_ID,
        class: "prompt",
        "hx-target": `#${WINDOW_REGION_ID}`,
      });
    }
  }
  const promptForm = new FormStub();
  // The field is inside the bar, the way it is in the shell: the blank-prompt rule reads
  // what was typed off the form that was submitted, not off the document.
  promptForm.append(promptField);
  /* The page everything stands on. Without one, nothing here can have left the document, and a
   * rule asking whether an answer still has somewhere to land could only be proved live. */
  const page = new El("body");
  page.append(region, notice, promptForm);
  const documentStub = documentOver({ page, region, notice, promptForm, promptField }, dispatched);
  /** The `shell` component, so the courtesy state can be driven the way Alpine drives it. */
  let shellFactory: (() => ShellState) | null = null;
  const windowStub = {
    Alpine: {
      data(_name: string, factory: () => ShellState) {
        shellFactory = factory;
      },
    },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    location: { pathname: "/capability/tasks", search: "" },
    history: { state: null, replaceState() {} },
    htmx: {
      // The real bundle's mutable config object. The shell turns two of its defaults off
      // (`public/app.js`), so a double without one would let that statement be deleted green.
      config: {} as Record<string, unknown>,
      process(node: El) {
        processed.push(node);
      },
    },
  };

  // The prompt bar is a module of the desk, started on this document the way the page starts it:
  // the glue only tells it things, so both halves must stand for a sentence to reach the slot.
  startPromptBar(documentStub as never);

  const appScript = readFileSync(resolve("public/app.js"), "utf8");
  Function(
    "document",
    "window",
    "requestAnimationFrame",
    "HTMLInputElement",
    "HTMLFormElement",
    "HTMLElement",
    "Element",
    "HTMLTemplateElement",
    "Node",
    appScript,
  )(
    documentStub,
    windowStub,
    (frame: () => void) => frames.push(frame),
    El,
    FormStub,
    El,
    El,
    Template,
    { TEXT_NODE: 3 },
  );

  /**
   * Send an event the way the browser would: at its target when that is a node of the page, so it
   * passes every capture and bubble listener on the way; at the document when it has no target.
   */
  const fire = (name: string, event: unknown) => {
    const typed = event as { type?: string };
    if (typed.type === undefined) Object.assign(event as object, { type: name });
    else if (typed.type !== name) throw new Error(`fired as ${name}, but it is a ${typed.type}`);
    watchForStop(event, propagationStopped);
    const target = (event as { target?: unknown }).target;
    if (target instanceof El) target.dispatchEvent(event as Event);
    else documentStub.dispatchEvent(event as Event);
  };

  /** Start the shell component the way Alpine does, and hand back its state. */
  const startShell = () => {
    fire("alpine:init", new CustomEvent("alpine:init"));
    const state = shellFactory?.();
    state?.init();
    return state;
  };

  return {
    /** The document the shell was started on, for a module started on it beside them. */
    root: documentStub,
    /** The window stub, for the two htmx defaults the shell turns off on it. */
    windowStub,
    region,
    displaced,
    subscriber,
    narration,
    surface,
    notice,
    promptField,
    promptForm,
    fire,
    dispatched,
    processed,
    propagationStopped,
    frames,
    FormStub,
    startShell,
  };
}

export const RESTORATION = '<div data-build-restoration="capability"><p>collection</p></div>';

/** The ending arriving on the narration, exactly as the presenter streams it. */
export function narrateEnding(scene: ReturnType<typeof desk>) {
  scene.narration.append(new El("p", { "data-build-ending": "" }));
}

/**
 * A real event, aimed at a node of the double. The glue asks `event instanceof CustomEvent`
 * before it trusts a close, so a plain object would be waved through every rule under test.
 */
export function eventAt(type: string, target: El, detail: unknown) {
  const event = new CustomEvent(type, { detail, cancelable: true, bubbles: true });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

/** The restoration arriving on the fragment, exactly as the presenter streams it. */
export function streamRestoration(scene: ReturnType<typeof desk>, raw = RESTORATION) {
  const event = eventAt("htmx:sseBeforeMessage", scene.surface, { data: raw });
  scene.fire("htmx:sseBeforeMessage", event);
  return event.defaultPrevented;
}

/**
 * The run's stream opening, which is what locks the prompt bar while a build has the window
 * (`public/app.js`). A scene with a run standing in it and no stream open is not a state the
 * browser can be in, and the rules about waking the bar all begin from the lock.
 */
export function openStream(scene: ReturnType<typeof desk>) {
  scene.fire("htmx:sseOpen", eventAt("htmx:sseOpen", scene.surface, null));
}

/** The stream closing the way the server closes it. */
export function closeStream(scene: ReturnType<typeof desk>) {
  scene.fire("htmx:sseClose", eventAt("htmx:sseClose", scene.surface, { type: "message" }));
}

/** The press that ends the wait. */
export function dismiss(scene: ReturnType<typeof desk>) {
  const button = new El("button", { "data-build-dismiss": "" });
  scene.subscriber.append(button);
  scene.fire("click", eventAt("click", button, null));
}

/**
 * One answer arriving for a request `asking` made. htmx dispatches `htmx:beforeSwap` on the swap
 * target, with the element that asked in the request's configuration, and marks a 4xx or 5xx an
 * error; whatever `isError` says once the listeners have run is what htmx reports as `successful`.
 * @returns whether htmx was told to swap it where it was aimed, and whether it counts it a success
 */
export function answerArrives(
  scene: ReturnType<typeof desk>,
  asking: El,
  { status, body }: { status: number; body: string },
): { swapped: boolean; successful: boolean } {
  const detail = {
    xhr: { status, responseText: body },
    shouldSwap: false,
    isError: status >= 400,
    elt: scene.region,
    requestConfig: { elt: asking },
  };
  scene.fire("htmx:beforeSwap", { detail });
  return { swapped: detail.shouldSwap, successful: !detail.isError };
}
