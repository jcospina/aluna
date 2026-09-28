// The shell glue's rules about the desk around a run, run rather than grepped: when a press from
// the ground is refused, which runs a new prompt takes down, when the window's name goes back, and
// where the keyboard lands. `app.shell-glue.test.ts` holds the glue's other rules.

import { describe, expect, test } from "bun:test";
import { NAME_THE_WINDOW_EVENT } from "#shell/desk-window.js";
import { QUESTION_RUN_ATTRIBUTE } from "#shell/leaving-a-run.js";
import { PROMPT_REFUSAL_SELECTOR, PROMPT_REFUSED_CLASS } from "#shell/prompt-bar.js";
import {
  closeStream,
  desk,
  El,
  eventAt,
  openStream,
  Template,
} from "./app.shell-double.test-support.ts";
import { renderAnswerWindowOpening, renderBuildEnding } from "./http/index.ts";

type Scene = ReturnType<typeof desk>;

/** Every name the glue gave the window, in order. */
function namings(scene: Scene): unknown[] {
  return scene.dispatched
    .filter(({ type }) => type === NAME_THE_WINDOW_EVENT)
    .map(({ detail }) => (detail as { title: unknown }).title);
}

/** Everything the browser does between one rule and the next. */
function settle(scene: Scene): void {
  for (const frame of scene.frames.splice(0)) frame();
}

/** The run ending with `line`, as the server writes it: the sentence, then the control. */
function endWith(scene: Scene, line: string, control = true): El {
  const written = new Template();
  written.innerHTML = renderBuildEnding("build-1", line);
  const [ending, button] = written.content.children;
  if (ending === undefined || button === undefined) throw new Error("no ending was written");
  scene.narration.append(ending);
  if (control) scene.subscriber.append(button);
  return button;
}

/** A request htmx is about to send for `elt`, landing on `target`. */
function request(scene: Scene, elt: El, target: El | null = null): Event {
  const event = eventAt("htmx:beforeRequest", elt, { elt, target });
  scene.fire("htmx:beforeRequest", event);
  return event;
}

/** The person typing somewhere on the page other than the prompt bar. */
function typeElsewhere(scene: Scene): void {
  const field = new El("input");
  scene.region.parent?.append(field);
  field.focus();
}

/** A press on the desk's ground, out of the window. */
function deskButton(scene: Scene): El {
  const button = new El("button");
  scene.region.parent?.append(button);
  return button;
}

describe("a press from the ground while a run is working", () => {
  test("is refused when it would take the window, and the refusal retires with the run", () => {
    const scene = desk();
    scene.startShell();
    openStream(scene);

    expect(request(scene, deskButton(scene), scene.region).defaultPrevented).toBe(true);
    expect(scene.notice.querySelector(PROMPT_REFUSAL_SELECTOR)).not.toBeNull();
    const refusal = scene.notice.textContent;

    // A press aimed anywhere but the window goes ahead, and leaves what the bar is saying alone.
    const elsewhere = new El("div");
    expect(request(scene, deskButton(scene), elsewhere).defaultPrevented).toBe(false);
    expect(request(scene, deskButton(scene)).defaultPrevented).toBe(false);
    expect(scene.notice.textContent).toBe(refusal);

    closeStream(scene);
    expect(scene.notice.textContent).toBe("");
  });

  test("an event with nothing about the request is none of the rule's business", () => {
    const scene = desk();
    expect(() =>
      scene.fire("htmx:beforeRequest", new CustomEvent("htmx:beforeRequest")),
    ).not.toThrow();
  });
});

describe("a new prompt over a run still standing", () => {
  test("takes down a run that was waiting to be read, and gives the window its name back", () => {
    const scene = desk();
    endWith(scene, "That did not work.");

    expect(request(scene, scene.promptForm).defaultPrevented).toBe(false);

    expect(scene.subscriber.parent).toBeNull();
    expect(namings(scene)).toEqual([null]);
  });

  test("leaves a question standing: the answer window ends it, not the next prompt", () => {
    const scene = desk();
    scene.subscriber.setAttribute(QUESTION_RUN_ATTRIBUTE, "true");

    expect(request(scene, scene.promptForm).defaultPrevented).toBe(false);

    expect(scene.subscriber.parent).toBe(scene.region);
    expect(namings(scene)).toEqual([]);
  });
});

describe("a run that turns out to be a question", () => {
  function saysItIsAQuestion(scene: Scene): void {
    const data = renderAnswerWindowOpening("how many notes do I have?");
    scene.fire("htmx:sseBeforeMessage", eventAt("htmx:sseBeforeMessage", scene.surface, { data }));
  }

  test("gives back the name of a window it borrowed, and not of one it stood up", () => {
    const borrowed = desk();
    saysItIsAQuestion(borrowed);
    const stoodUp = desk();
    stoodUp.displaced.remove();
    saysItIsAQuestion(stoodUp);

    expect(namings(borrowed)).toEqual([null]);
    expect(namings(stoodUp)).toEqual([]);
  });

  test("hands the keyboard back only if nobody has taken it somewhere else meanwhile", () => {
    const idle = desk();
    idle.startShell();
    openStream(idle);
    const typing = desk();
    typing.startShell();
    openStream(typing);
    typeElsewhere(typing);

    for (const scene of [idle, typing]) {
      saysItIsAQuestion(scene);
      settle(scene);
    }

    expect(idle.promptField.focused).toBe(true);
    expect(typing.promptField.focused).toBe(false);
  });
});

describe("where the keyboard goes when a run finishes", () => {
  test("a run that finished takes it back to the bar, wherever it was", () => {
    const scene = desk();
    scene.startShell();
    openStream(scene);
    typeElsewhere(scene);

    closeStream(scene);
    settle(scene);

    expect(scene.promptField.focused).toBe(true);
  });

  test("a run with something to say puts it on the control, visibly, and on none it lacks", () => {
    const scene = desk();
    scene.startShell();
    openStream(scene);
    const control = endWith(scene, "That did not work.");
    const bare = desk();
    bare.startShell();
    openStream(bare);
    endWith(bare, "That did not work.", false);

    closeStream(scene);
    closeStream(bare);
    settle(scene);

    expect(control.focused).toBe(true);
    expect(control.focusOptions).toEqual({ focusVisible: true });
    expect(() => settle(bare)).not.toThrow();
  });
});

describe("an ending taken down before it was read", () => {
  test("moves to the bar as the ending it was, without a refusal's cue", () => {
    const scene = desk();
    endWith(scene, "That did not work.");

    scene.fire(
      "htmx:beforeCleanupElement",
      eventAt("htmx:beforeCleanupElement", scene.subscriber, null),
    );

    expect(scene.notice.textContent).toBe("That did not work.");
    expect(scene.notice.querySelector(PROMPT_REFUSAL_SELECTOR)).toBeNull();
    expect(scene.promptForm.classList.contains(PROMPT_REFUSED_CLASS)).toBe(false);
  });
});
