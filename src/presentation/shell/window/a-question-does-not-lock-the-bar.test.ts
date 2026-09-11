// A question does not lock the prompt bar, and giving up on one ends it (6.5/04).
//
// PLAN decisions 27 and 10. The bar comes back the moment a run says it turned out to be a
// question; the mark that says so is what the desk finds a running question by; and the answer
// window raises both of decision 10's user triggers at `leaving-a-run.js`'s one cancel.
//
// The server's half — what a cancel does to the read scope, and what a cancelled question says on
// its way out — is `src/pipeline/query/data-query.test.ts` and `question-pipeline.test.ts`.

import { describe, expect, test } from "bun:test";
import {
  ANSWER_WINDOW_SELECTOR,
  dismissAnswerWindow,
  openAnswerWindow,
  startDeskAnswerWindow,
} from "#shell/desk-answer-window.js";
import { openWindow, PROMPT_FORM_ID, putAway, startDeskWindow } from "#shell/desk-window.js";
import {
  buildCancelUrl,
  QUESTION_IN_THE_WINDOW_SELECTOR,
  QUESTION_RUN_ATTRIBUTE,
  RUN_ID_ATTRIBUTE,
} from "#shell/leaving-a-run.js";
import { WINDOW_CONTENT_ID } from "#shell/shell-dom.js";
import {
  closeStream,
  desk,
  eventAt,
  openStream,
} from "../../../server/app.shell-double.test-support.ts";
import {
  ANSWER_WINDOW_OPENING,
  renderAnswerWindowOpening,
  renderBuildWindowTitle,
} from "../../../server/http/index.ts";
import { El, standingDesk } from "./standing-desk.test-support.ts";

const QUESTION = "how many notes did I add last week?";

/** One frame of a run's own stream, arriving on the surface the shell listens on. */
function streamFrame(scene: ReturnType<typeof desk>, data: string): boolean {
  const event = eventAt("htmx:sseBeforeMessage", scene.surface, { data });
  scene.fire("htmx:sseBeforeMessage", event);
  return event.defaultPrevented;
}

/** The run saying it turned out to be a question: the answer window's own opening frame. */
const saysItIsAQuestion = (scene: ReturnType<typeof desk>) =>
  streamFrame(scene, renderAnswerWindowOpening(QUESTION));

/** A desk with the shell started, a run standing in the window and its stream open. */
function running() {
  const scene = desk();
  const shell = scene.startShell();
  openStream(scene);
  return { scene, shell };
}

/** Everything the browser does between one rule and the next. */
function settle(scene: ReturnType<typeof desk>) {
  for (const frame of scene.frames.splice(0)) frame();
}

describe("the prompt bar while a question runs", () => {
  test("comes back when the run says it is a question, with the words that asked it taken", () => {
    const { scene, shell } = running();
    scene.promptField.value = QUESTION;
    // Locked at the open, where nothing yet knows what the sentence was.
    expect(shell?.promptBusy).toBe(true);

    expect(saysItIsAQuestion(scene)).toBe(true);
    settle(scene);

    expect(shell?.promptBusy).toBe(false);
    // Cleared and handed back the keyboard, because the question has been taken: a field still
    // holding it would have to be emptied by hand before anything else could be asked.
    expect(scene.promptField.value).toBe("");
    expect(scene.promptField.focused).toBe(true);
  });

  test("a build still locks it for the whole of the run, and wakes it at the end", () => {
    const { scene, shell } = running();
    scene.promptField.value = "track my houseplants";

    // A build says what it turned out to be by naming the window, and goes on holding the bar.
    expect(streamFrame(scene, renderBuildWindowTitle("Houseplants"))).toBe(true);
    expect(shell?.promptBusy).toBe(true);

    closeStream(scene);
    settle(scene);
    expect(shell?.promptBusy).toBe(false);
    expect(scene.promptField.value).toBe("");
  });

  test("and the answer arriving does not take back what has been typed since", () => {
    const { scene, shell } = running();
    saysItIsAQuestion(scene);
    settle(scene);
    scene.promptField.value = "how many teas do I have?";
    scene.promptField.focused = false;

    closeStream(scene);
    settle(scene);

    // The bar was never this run's to wake: it woke itself when the window opened, and the next
    // question is half typed by the time the answer lands.
    expect(shell?.promptBusy).toBe(false);
    expect(scene.promptField.value).toBe("how many teas do I have?");
    expect(scene.promptField.focused).toBe(false);
  });

  test("a second question is not turned down the way a second build is", () => {
    const { scene } = running();
    saysItIsAQuestion(scene);
    settle(scene);

    const asking = eventAt("htmx:beforeRequest", scene.promptForm, { elt: scene.promptForm });
    scene.fire("htmx:beforeRequest", asking);

    // The refusal is for a run that has the window. A question gave it back, so the sentence
    // would be false twice over: she is not making anything, and asking again is allowed.
    expect(asking.defaultPrevented).toBe(false);
    expect(scene.notice.textContent).toBe("");
  });

  test("and the run carries the mark the desk finds a running question by", () => {
    const { scene } = running();
    saysItIsAQuestion(scene);

    expect(scene.subscriber.matches(QUESTION_IN_THE_WINDOW_SELECTOR)).toBe(true);
    // A build never carries it, or every second prompt would end a run nobody stopped.
    const building = running();
    streamFrame(building.scene, renderBuildWindowTitle("Houseplants"));
    expect(building.scene.subscriber.matches(QUESTION_IN_THE_WINDOW_SELECTOR)).toBe(false);
  });
});

/** One question standing in the window, as much of it as stopping one reaches for. */
function regionHolding(jobId: string | null) {
  const run = {
    getAttribute: (name: string) => (name === RUN_ID_ATTRIBUTE ? jobId : null),
    /* The release walks whatever the desk has anchored under this run before the story leaves
     * the page (`public/region-scope.js`). This one anchors nothing, and says so. */
    contains: () => false,
  };
  return {
    querySelector: (selector: string) =>
      selector === QUESTION_IN_THE_WINDOW_SELECTOR && jobId !== null ? run : null,
  };
}

/** The module started on a page of its own, with every rule it binds kept by the event it answers. */
function startedOn(jobId: string | null) {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const captured: string[] = [];
  startDeskAnswerWindow({
    querySelector: () => ({ getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
    addEventListener: (type: string, fn: (event: unknown) => void, capture?: boolean) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      if (capture === true) captured.push(type);
    },
    getElementById: (id: string) => (id === WINDOW_CONTENT_ID ? regionHolding(jobId) : null),
  } as never);
  return {
    captured,
    fire: (type: string, event: unknown = { detail: {} }) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

/** One person asking something else, as htmx announces it. */
const ASKING_AGAIN = { detail: { elt: { id: PROMPT_FORM_ID } } };

/**
 * As much of a browser as stopping a question touches: the cancel route, and htmx's swap, which
 * is what closes a stream. Both are globals a shell module reads, so both are put back.
 */
function withCancelling<T>(run: (asked: { posted: string[]; detached: number }) => T): T {
  const asked = { posted: [] as string[], detached: 0 };
  const held = ["window", "fetch"].map(
    (name) => [name, Reflect.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  const put = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  put("window", {
    htmx: {
      swap: () => {
        asked.detached += 1;
      },
    },
  });
  put("fetch", (url: string) => {
    asked.posted.push(url);
    return Promise.resolve();
  });
  try {
    return run(asked);
  } finally {
    for (const [name, had] of held) {
      if (had) Object.defineProperty(globalThis, name, had);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

describe("the two ways a person gives up on a question", () => {
  test("asking something else stops it, from the capture phase, before anything is sent", () => {
    const desk = startedOn("question-7");
    // Capture, so the shell's own one-run guard reads the window after this (`public/app.js`).
    // On the way back up it would already have refused the second question.
    expect(desk.captured).toEqual(["htmx:beforeRequest"]);

    withCancelling((asked) => {
      desk.fire("htmx:beforeRequest", ASKING_AGAIN);
      expect(asked.posted).toEqual([buildCancelUrl("question-7")]);
      // And its story comes down with it, which is what closes the stream: the sentence going out
      // is about to open a window of its own, and a frame of hers would land in it.
      expect(asked.detached).toBe(1);

      // A request from anywhere else on the desk is not a person asking something else.
      desk.fire("htmx:beforeRequest", { detail: { elt: { id: "notes-search" } } });
      expect(asked.posted).toHaveLength(1);
      expect(asked.detached).toBe(1);
    });
  });

  test("dismissing the answer stops it too, and leaves the story its own ending", () => {
    startedOn("question-7");
    withCancelling((asked) => {
      dismissAnswerWindow();

      // The same cancel a desk action reaches. The story stays where it stands, because nothing
      // is coming to take its place: the close the server sends is what puts the frame it stood
      // in away, the way it does for every other run that ends.
      expect(asked.posted).toEqual([buildCancelUrl("question-7")]);
      expect(asked.detached).toBe(0);
    });
  });

  test("and a desk with no question running is left alone", () => {
    const desk = startedOn(null);
    withCancelling((asked) => {
      dismissAnswerWindow();
      desk.fire("htmx:beforeRequest", ASKING_AGAIN);
      expect(asked.posted).toEqual([]);
      expect(asked.detached).toBe(0);
    });
  });
});

/**
 * A window left showing a question nobody will finish. A question asked next takes the window over
 * (PLAN decision 25: the frame is never closed and reopened between questions), so what is proved
 * here is the other case — the sentence that replaced it was not a question at all, and the words
 * standing in the window are about something the desk stopped doing.
 */
describe("a question given up on for something that is not a question", () => {
  /** A real desk, with one question standing in its window region. */
  function askingDesk() {
    const scene = standingDesk();
    const region = new El("div");
    region.id = WINDOW_CONTENT_ID;
    const run = new El("section");
    run.setAttribute(RUN_ID_ATTRIBUTE, "question-7");
    run.setAttribute(QUESTION_RUN_ATTRIBUTE, "true");
    region.append(run);
    scene.root.append(region);
    startDeskAnswerWindow(scene.doc as never);
    openAnswerWindow(
      scene.doc as never,
      "how many notes did I add last week?",
      ANSWER_WINDOW_OPENING,
    );
    return {
      scene,
      run,
      windows: () => scene.windows().filter((w) => w.matches(ANSWER_WINDOW_SELECTOR)),
    };
  }

  /** One stream closing the way the server closes it, from inside the run that was narrating. */
  function closeFrom(scene: ReturnType<typeof standingDesk>, from: El) {
    const closed = new CustomEvent("htmx:sseClose", { detail: { type: "message" } });
    Object.defineProperty(closed, "target", { value: from });
    scene.doc.dispatchEvent(closed as never);
  }

  test("takes the window down when the run that replaced it ends", () => {
    const { scene, run, windows } = askingDesk();
    try {
      withCancelling(() => {
        scene.doc.dispatchEvent(new CustomEvent("htmx:beforeRequest", ASKING_AGAIN) as never);
      });
      expect(windows()).toHaveLength(1);

      // Her own ending arrives first, within a moment of the cancel, and decides nothing: what
      // the window is waiting on is the run that took her place.
      closeFrom(scene, run);
      expect(windows()).toHaveLength(1);

      const build = new El("section");
      build.setAttribute(RUN_ID_ATTRIBUTE, "build-9");
      closeFrom(scene, build);
      expect(windows()).toHaveLength(0);
    } finally {
      dismissAnswerWindow();
      scene.restore();
    }
  });

  test("and a question asked next takes the window over instead", () => {
    const { scene, windows } = askingDesk();
    try {
      withCancelling(() => {
        scene.doc.dispatchEvent(new CustomEvent("htmx:beforeRequest", ASKING_AGAIN) as never);
      });
      // The sentence turned out to be a question too. It opens in the frame already standing
      // (decision 25), and the window is about her question now rather than the abandoned one.
      openAnswerWindow(scene.doc as never, "how many teas do I have?", ANSWER_WINDOW_OPENING);

      const next = new El("section");
      next.setAttribute(RUN_ID_ATTRIBUTE, "question-8");
      closeFrom(scene, next);
      expect(windows()).toHaveLength(1);
    } finally {
      dismissAnswerWindow();
      scene.restore();
    }
  });

  test("but a question that answered is the person's to keep", () => {
    const { scene, windows } = askingDesk();
    try {
      const build = new El("section");
      build.setAttribute(RUN_ID_ATTRIBUTE, "build-9");
      closeFrom(scene, build);
      // Nothing was given up on, so nothing about this run is the answer window's business.
      expect(windows()).toHaveLength(1);
    } finally {
      dismissAnswerWindow();
      scene.restore();
    }
  });
});

/**
 * The frame a prompt stands up before anything is known about the sentence. It is invisible until
 * a run says what it is, which is what makes one left standing empty hard to see: the next
 * capability opened goes into it, unseen. A question taken down at the press empties one, and so
 * does a request that never comes back — and neither ends in the swap or the close that usually
 * answers for a window holding nothing.
 */
describe("a frame left holding nothing", () => {
  test("goes when the request that stood it up never comes back", () => {
    const scene = standingDesk();
    try {
      startDeskWindow(scene.doc as never, "/");
      openWindow("Thinking…", scene.doc as never);
      expect(scene.windows()).toHaveLength(1);

      scene.doc.dispatchEvent(new CustomEvent("htmx:responseError") as never);
      expect(scene.windows()).toHaveLength(0);
    } finally {
      putAway();
      scene.restore();
    }
  });

  test("and one holding something is left exactly as it is", () => {
    const scene = standingDesk();
    try {
      startDeskWindow(scene.doc as never, "/");
      const region = openWindow("Coffee tasting", scene.doc as never);
      region.append(new El("div"));

      scene.doc.dispatchEvent(new CustomEvent("htmx:sendError") as never);
      // A failed request somewhere else on the desk is not a reason to take a capability away.
      expect(scene.windows()).toHaveLength(1);
    } finally {
      putAway();
      scene.restore();
    }
  });
});
