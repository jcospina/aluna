// Leaving a run, continued from `leaving-a-run.test.ts`: giving up on a question, and the two
// facts the desk asks the module for — whether a run is using the window, and what a leave that
// could not be carried out says when nobody injected a way to say it.

import { describe, expect, test } from "bun:test";
import {
  applyLeavingQuestion,
  askBeforeLeaving,
  backOutOfLeaving,
  buildCancelUrl,
  buildJobIdIn,
  cancelBuildIn,
  cancelQuestionIn,
  detachQuestionIn,
  goAheadAndLeave,
  LEAVING_A_RUN_UNAVAILABLE,
  leavingIsBeingAsked,
  questionJobIdIn,
  runIsUsingWindow,
  standDownWith,
  startLeavingGuard,
} from "#shell/desk/leaving-a-run.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "#shell/desk/prompt-bar.js";
import {
  RUN_LEAVING_BACK_ATTRIBUTE,
  RUN_LEAVING_GO_ATTRIBUTE,
  renderBuildEnding,
  renderBuildSubscriber,
} from "../../server/http/fragments/fragments.ts";
import { Doc, El, parseHtml } from "../controls/double/choice-picker.test-support.ts";
import { windowWithQuestion, windowWithRun } from "./leaving-a-run.test-support.ts";

/** A desk with nothing running: the window holds no subscriber at all. */
const bareWindow = { querySelector: () => null };

describe("whether a run is using the window", () => {
  test("a run still going is; one that has ended and waits to be read is not", () => {
    const win = parseHtml(renderBuildSubscriber("build-7"), new El("div"));
    expect(runIsUsingWindow(win as never)).toBe(true);
    const narration = win.querySelector(".build-stream__narration") as El;
    parseHtml(renderBuildEnding("build-7", "That didn’t work."), narration);
    expect(runIsUsingWindow(win as never)).toBe(false);
    expect(runIsUsingWindow(new El("div") as never)).toBe(false);
  });
});

describe("a leave that cannot be carried out, with nobody told how to say so", () => {
  test("says so on the prompt bar, as a refusal", () => {
    const standing = Reflect.getOwnPropertyDescriptor(globalThis, "document");
    const doc = new EventTarget();
    const said: unknown[] = [];
    doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (event) => {
      said.push((event as CustomEvent).detail);
    });
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
    try {
      askBeforeLeaving(windowWithRun([]).el, () => {});
      const how = { post: () => {}, release: () => {}, api: {} };
      expect(goAheadAndLeave({ activeElement: null, body: null }, how)).toBe(false);
    } finally {
      if (standing) Object.defineProperty(globalThis, "document", standing);
      else Reflect.deleteProperty(globalThis, "document");
    }
    expect(said).toEqual([{ sentence: LEAVING_A_RUN_UNAVAILABLE, refused: true }]);
    expect(LEAVING_A_RUN_UNAVAILABLE.trim()).not.toBe("");
  });
});

/** A run the server streamed into a started document, and what the prompt bar was told. */
function deskWithRun() {
  const doc = new Doc();
  parseHtml(`<main>${renderBuildSubscriber("build-7")}</main>`, doc);
  const said: unknown[] = [];
  doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (event) => {
    said.push((event as unknown as CustomEvent).detail.sentence);
  });
  startLeavingGuard(doc as never);
  const part = (attribute: string) => doc.querySelector(`[${attribute}]`) as El;
  return {
    doc,
    said,
    win: doc.querySelector("main") as El,
    back: part(RUN_LEAVING_BACK_ATTRIBUTE),
    go: part(RUN_LEAVING_GO_ATTRIBUTE),
  };
}

/** `run` with `globals` standing, every one put back exactly as it was afterwards. */
async function withGlobals(globals: Record<string, unknown>, run: () => unknown): Promise<void> {
  const host = globalThis as Record<string, unknown>;
  const before = Object.keys(globals).map(
    (name) => [name, Reflect.getOwnPropertyDescriptor(host, name)] as const,
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(host, name, { value, configurable: true, writable: true });
  }
  try {
    await run();
  } finally {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(host, name, descriptor);
      else Reflect.deleteProperty(host, name);
    }
  }
}

describe("the question on a run the server streamed", () => {
  test("a run whose Cancel became Continue mid-question lands on Continue when the question goes", () => {
    const desk = deskWithRun();
    const cancel = desk.win.querySelector(".build-stream__cancel") as El;
    const dismiss = parseHtml(renderBuildEnding("build-7", "Done."), new El("div")).querySelector(
      "[data-build-dismiss]",
    ) as El;
    cancel.replaceWith(dismiss);
    expect(askBeforeLeaving(desk.win as never, () => {})).toBe(true);
    expect(backOutOfLeaving()).toBe(true);
    expect(desk.doc.activeElement).toBe(dismiss);
  });

  test("Stop and leave with no htmx on the page says so on the prompt bar", async () => {
    const desk = deskWithRun();
    await withGlobals({ document: desk.doc, window: {} }, () => {
      askBeforeLeaving(desk.win as never, () => {});
      desk.doc.fire("click", desk.go);
    });
    expect(desk.said).toEqual([LEAVING_A_RUN_UNAVAILABLE]);
    expect(leavingIsBeingAsked()).toBe(false);
  });

  test("a leave carried out takes the story down with nothing put in its place", () => {
    const desk = deskWithRun();
    const swapped: unknown[][] = [];
    askBeforeLeaving(desk.win as never, () => {});
    const how = {
      post: () => {},
      release: () => {},
      api: { swap: (...args: unknown[]) => void swapped.push(args) },
    };
    expect(goAheadAndLeave({ activeElement: null, body: null }, how)).toBe(true);
    expect(swapped.map(([, content]) => content)).toEqual([""]);
  });
});

describe("where focus settles once the run is gone", () => {
  test("nothing holding focus, or no answer about it at all, puts the person on the prompt bar", () => {
    for (const root of [{ activeElement: null, body: {} }, { body: {} }]) {
      const focused: string[] = [];
      const prompt = { focus: () => focused.push("prompt") };
      askBeforeLeaving(windowWithRun([]).el, () => {});
      const how = { post: () => {}, release: () => {}, api: { swap: () => {} } };
      goAheadAndLeave({ ...root, getElementById: () => prompt }, how);
      expect(focused).toEqual(["prompt"]);
    }
  });

  test("a desk with no prompt bar, or no way to look for one, settles nowhere and throws nothing", () => {
    for (const root of [
      { activeElement: null, body: null, getElementById: () => null },
      { activeElement: null, body: null },
    ]) {
      askBeforeLeaving(windowWithRun([]).el, () => {});
      const how = { post: () => {}, release: () => {}, api: { swap: () => {} } };
      expect(() => goAheadAndLeave(root, how)).not.toThrow();
    }
  });
});

describe("the edges of a question standing", () => {
  test("a run that ends with no question standing stands nothing down", () => {
    expect(leavingIsBeingAsked()).toBe(false);
    expect(standDownWith({ name: "a run" })).toBe(false);
  });

  test("a question with no row, no control or no answer to land on moves only what is there", () => {
    const focused: unknown[] = [];
    const focus = (node: unknown) => void focused.push(node);
    expect(() =>
      applyLeavingQuestion({ asking: true, control: null, warning: null, backOut: null, focus }),
    ).not.toThrow();
    expect(() =>
      applyLeavingQuestion({ asking: false, control: null, warning: null, backOut: null, focus }),
    ).not.toThrow();
    expect(focused).toEqual([]);
  });
});

describe("a cancel posted on the person's behalf that does not land", () => {
  test("is written down, whether the server refused it or the connection failed, and one that lands is not", async () => {
    const logged: unknown[][] = [];
    const failures = [
      () => Promise.resolve(new Response(null, { status: 200 })),
      () => Promise.resolve(new Response(null, { status: 503 })),
      () => Promise.reject(new Error("offline")),
    ];
    await withGlobals(
      {
        fetch: () => (failures.shift() as () => Promise<Response>)(),
        console: { ...console, error: (...args: unknown[]) => void logged.push(args) },
      },
      async () => {
        for (const _ of failures.slice()) cancelBuildIn(windowWithRun([]).el);
        for (let turn = 0; turn < 5; turn += 1) await Bun.sleep(0);
      },
    );
    expect(logged.map(([said]) => typeof said === "string" && said !== "")).toEqual([true, true]);
    expect(logged.map(([, why]) => (why instanceof Error ? why.message : why))).toEqual([
      503,
      "offline",
    ]);
  });
});

// Asking something else and dismissing the answer are decision 10's two user-raised triggers
// (6.5/04). Both are raised in `public/desk/window/desk-answer-window.js` and both stop the question here, at
// the same call a desk action reaches — one cancel path, not three.
describe("giving up on a question", () => {
  test("is the same cancel, and nothing is asked first", () => {
    const posted: string[] = [];
    const asked = windowWithQuestion([]);

    expect(cancelQuestionIn(asked.el, (url) => posted.push(url))).toBe("build-7");

    expect(posted).toEqual([buildCancelUrl("build-7")]);
    // A build warns before it is lost (decision 17). A question does not: it can be asked again.
    expect(asked.warning.hidden).toBe(true);
    expect(leavingIsBeingAsked()).toBe(false);
  });

  test("and the story comes down only once something has taken its place", () => {
    // Left standing until then, so the window is never a frame holding nothing — and taken down
    // before the run that replaced it can speak, so no frame of hers can reach the new question.
    const order: string[] = [];
    const asked = windowWithQuestion([]);
    const how = {
      api: { swap: () => order.push("detach") },
      release: () => order.push("release"),
    };

    expect(detachQuestionIn(asked.el, how as never)).toBe(true);
    expect(order).toEqual(["release", "detach"]);
    // Nothing to take down twice, and a desk with no htmx has no way to close a stream at all.
    expect(detachQuestionIn(bareWindow, how as never)).toBe(false);
    expect(detachQuestionIn(asked.el, { api: {}, release: how.release } as never)).toBe(false);
    expect(order).toEqual(["release", "detach"]);
  });

  test("a build is not a question, and a question is not a build", () => {
    const posted: string[] = [];
    const building = windowWithRun([]);
    const asked = windowWithQuestion([]);

    // The two live in the window one at a time, and neither lookup may answer about the other:
    // ending a build without its warning, or warning about a question, are the same mistake.
    expect(cancelQuestionIn(building.el, (url) => posted.push(url))).toBeNull();
    expect(questionJobIdIn(building.el)).toBeNull();
    expect(questionJobIdIn(asked.el)).toBe("build-7");
    expect(buildJobIdIn(asked.el)).toBeNull();
    expect(posted).toEqual([]);
  });

  test("a desk with nothing running has no question to stop", () => {
    const posted: string[] = [];
    expect(cancelQuestionIn(bareWindow, (url) => posted.push(url))).toBeNull();
    expect(questionJobIdIn(bareWindow)).toBeNull();
    expect(posted).toEqual([]);
  });
});
