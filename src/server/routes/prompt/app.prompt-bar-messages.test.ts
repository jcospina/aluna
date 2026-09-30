import { describe, expect, jest, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fc from "fast-check";
import { PROMPT_FIELD_ID, PROMPT_NOTICE_ID } from "#shell/core/shell-dom.js";
import {
  PROMPT_BAR_MESSAGE_EVENT,
  PROMPT_REFUSAL_FLASH_MS,
  PROMPT_REFUSED_CLASS,
} from "#shell/desk/prompt-bar.js";
import {
  CAPABILITY_LOGO_SELECTOR,
  NAME_THE_WINDOW_EVENT,
  PROMPT_FORM_ID,
  PUT_WINDOW_AWAY_EVENT,
} from "#shell/desk/window/desk-window.js";
import {
  BLANK_PROMPT_NOTICE,
  hasMeaningfulPromptContent,
  PROMPT_REFUSAL_ATTRIBUTE,
  renderPromptNotice,
} from "../../http/index.ts";
import { byId, elementsOf, moduleSources } from "../../http/served-page.test-support.ts";
import {
  closeStream,
  desk,
  El,
  eventAt,
  narrateEnding,
  openStream,
  streamRestoration,
  WINDOW_REGION_ID,
} from "../../shell-glue/app.shell-double.test-support.ts";

// The desk has two places to speak and each message goes to the one that was asked (PLAN decisions
// 24 and 26; ARCH §6.1, §6.2). Run rather than grepped: routing proved by a string match is not.

/** What the bar is saying, read the way a person reads it. */
function spoken(scene: ReturnType<typeof desk>): string {
  return scene.notice.textContent;
}

/** Whether the sentence standing there is a refusal, and whether the cue is on. */
function refused(scene: ReturnType<typeof desk>): boolean {
  return scene.notice.querySelector(`[${PROMPT_REFUSAL_ATTRIBUTE}]`) !== null;
}

function flashing(scene: ReturnType<typeof desk>): boolean {
  return scene.promptForm.classList.contains(PROMPT_REFUSED_CLASS);
}

/**
 * One request leaving the page, with the target htmx has already resolved for it: the element
 * that asked, and where its answer would land — both halves the real event carries.
 * @returns whether it was refused
 */
function request(scene: ReturnType<typeof desk>, asking: El, target: El | null) {
  let prevented = false;
  scene.fire("htmx:beforeRequest", {
    detail: { elt: asking, target },
    preventDefault: () => {
      prevented = true;
    },
  });
  return prevented;
}

/** A prompt submitted the way the bar submits one. @returns whether it was refused. */
function submitPrompt(scene: ReturnType<typeof desk>) {
  return request(scene, scene.promptForm, scene.region);
}

/** One thing on the desk asking for the window. @returns whether it was refused. */
function pressDeskAction(scene: ReturnType<typeof desk>, asking: El) {
  const named = asking.getAttribute("hx-target");
  return request(scene, asking, named === `#${WINDOW_REGION_ID}` ? scene.region : null);
}

/** A control on the ground that would fill the window — Delete on a logo, and its like. */
function deskFurniture() {
  return new El("button", {
    "hx-target": `#${WINDOW_REGION_ID}`,
    "hx-get": "/capability-deletion/notes",
  });
}

/** The attribute the desk finds a logo by, read off the desk's own selector. */
const LOGO_ATTRIBUTE = CAPABILITY_LOGO_SELECTOR.slice(1, -1);

/** A capability's logo: on the desk, and the one thing there that opens rather than acts. */
function deskLogo() {
  return new El("button", {
    [LOGO_ATTRIBUTE]: "",
    "data-capability-id": "notes",
    "hx-target": `#${WINDOW_REGION_ID}`,
  });
}

describe("a build refused because a run already has the window", () => {
  test("says so on the prompt bar instead of looking like nothing happened", () => {
    const scene = desk();

    expect(submitPrompt(scene)).toBe(true);
    expect(spoken(scene)).toBe(
      "I’m still making the last thing you asked for. Let me finish, then tell me the next one.",
    );
    expect(refused(scene)).toBe(true);
    // The run keeps its story and its place: nothing about the window moved.
    expect(scene.subscriber.parent).toBe(scene.region);
  });

  test("keeps what was typed and leaves the keyboard where it was", () => {
    const scene = desk();
    scene.promptField.value = "track my plants";

    submitPrompt(scene);

    expect(scene.promptField.value).toBe("track my plants");
    expect(scene.promptField.focused).toBe(false);
  });

  test("flashes the bar as the cue, and the cue lets go on its own", () => {
    jest.useFakeTimers();
    const scene = desk();
    try {
      submitPrompt(scene);
      jest.advanceTimersByTime(PROMPT_REFUSAL_FLASH_MS - 1);
      expect(flashing(scene)).toBe(true);
      jest.advanceTimersByTime(1);
      expect(flashing(scene)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
    // The words stay: the flash is the cue, not the message, and nothing times the
    // sentence away.
    expect(spoken(scene)).toContain("I’m still making the last thing you asked for");
  });

  test("replaces rather than stacks, however many times it is refused", () => {
    const scene = desk();

    submitPrompt(scene);
    submitPrompt(scene);

    expect(scene.notice.childNodes).toHaveLength(1);
  });
});

// Nothing to build is nothing to open a window for. The bar answers a blank submission
// itself, and the desk never gets as far as standing a frame up for it.
describe("a submission with nothing in it", () => {
  /** @returns whether the submission was stopped before it could become a request. */
  function submitBlank(scene: ReturnType<typeof desk>, typed: string) {
    scene.promptField.value = typed;
    const event = eventAt("submit", scene.promptForm, null);
    scene.fire("submit", event);
    return event.defaultPrevented;
  }

  test("an empty field and one holding only spaces get the same answer", () => {
    for (const typed of ["", "   ", "\u200b\u00ad", "\t\n "]) {
      const scene = desk();

      expect(submitBlank(scene, typed)).toBe(true);
      expect(spoken(scene)).toBe(BLANK_PROMPT_NOTICE);
      expect(refused(scene)).toBe(true);
      expect(flashing(scene)).toBe(true);
    }
  });

  test("and neither becomes a request, so no window is opened for it", () => {
    const blank = desk();
    const typed = desk();
    // htmx's own listener, on the form itself: whatever reaches it goes on the wire.
    const sent = (scene: ReturnType<typeof desk>) => {
      const onTheWire: string[] = [];
      scene.promptForm.addEventListener("submit", () => onTheWire.push("sent"));
      return onTheWire;
    };
    const blankSent = sent(blank);
    const typedSent = sent(typed);

    submitBlank(blank, "   ");
    submitBlank(typed, "keep track of my plants");

    // Stopped at the document in the capture phase, before the form's own listener runs.
    expect(blankSent).toEqual([]);
    expect(typedSent).toEqual(["sent"]);
    expect(blank.propagationStopped).toContain("submit");
  });

  test("a prompt with something in it is left alone", () => {
    const scene = desk();

    expect(submitBlank(scene, "keep track of my plants")).toBe(false);
    expect(spoken(scene)).toBe("");
  });
});

describe("what retires a sentence on the bar", () => {
  test("editing the prompt, because it is about words no longer in the field", () => {
    const scene = desk();
    submitPrompt(scene);

    scene.fire("input", { target: scene.promptField });

    expect(spoken(scene)).toBe("");
    expect(flashing(scene)).toBe(false);
  });

  test("typing anywhere else does not", () => {
    const scene = desk();
    submitPrompt(scene);

    scene.fire("input", { target: new El("input", { id: "notes-title" }) });

    expect(spoken(scene)).toContain("I’m still making the last thing you asked for");
  });

  test("the run it was about ending, because it stops being true with it", () => {
    const scene = desk();
    scene.startShell();
    openStream(scene);
    submitPrompt(scene);
    expect(spoken(scene)).toContain("I’m still making the last thing you asked for");

    closeStream(scene);

    expect(spoken(scene)).toBe("");
    expect(flashing(scene)).toBe(false);
  });

  test("but the words typed while waiting are kept, because they were never sent", () => {
    const scene = desk();
    scene.startShell();
    openStream(scene);
    scene.promptField.value = "and my succulents";
    submitPrompt(scene);

    closeStream(scene);
    for (const frame of scene.frames.splice(0)) frame();

    // The ordinary clear-on-success would wipe the field here. What is in it was typed
    // *after* the prompt that succeeded, while the bar was telling them to wait.
    expect(scene.promptField.value).toBe("and my succulents");
  });

  test("and a sentence that replaced it since is about something else, so it stays", () => {
    const scene = desk();
    scene.startShell();
    openStream(scene);
    submitPrompt(scene);
    scene.fire(PROMPT_BAR_MESSAGE_EVENT, { detail: { sentence: "I deleted Notes permanently." } });

    closeStream(scene);

    expect(spoken(scene)).toBe("I deleted Notes permanently.");
  });

  test("the next desk action that goes ahead", () => {
    const scene = desk();
    submitPrompt(scene);
    scene.subscriber.remove();

    expect(pressDeskAction(scene, deskFurniture())).toBe(false);
    expect(spoken(scene)).toBe("");
  });

  test("opening a capability, which is a desk action like any other", () => {
    const scene = desk();
    submitPrompt(scene);

    expect(pressDeskAction(scene, deskLogo())).toBe(false);
    expect(spoken(scene)).toBe("");
  });

  test("an admitted prompt, which clears the cue with the words", () => {
    const scene = desk();
    submitPrompt(scene);
    narrateEnding(scene);
    streamRestoration(scene);
    closeStream(scene);

    expect(submitPrompt(scene)).toBe(false);
    expect(spoken(scene)).toBe("");
    expect(flashing(scene)).toBe(false);
  });
});

describe("a desk action asking for the window a run is using", () => {
  test("is refused on the prompt bar, and the run stays exactly where it is", () => {
    const scene = desk();

    expect(pressDeskAction(scene, deskFurniture())).toBe(true);
    expect(spoken(scene)).toBe(
      "I’m still making the last thing you asked for. Let me finish, then try that again.",
    );
    expect(refused(scene)).toBe(true);
    expect(scene.region.childNodes).toEqual([scene.displaced, scene.subscriber]);
  });

  test("is admitted once the run has stopped and is only waiting to be read", () => {
    const scene = desk();
    narrateEnding(scene);

    expect(pressDeskAction(scene, deskFurniture())).toBe(false);
    expect(spoken(scene)).toBe("");
  });

  test("is admitted when nothing is using the window", () => {
    const scene = desk();
    scene.subscriber.remove();

    expect(pressDeskAction(scene, deskFurniture())).toBe(false);
  });

  test("is what a control hung on a logo is — 5.9's menu and rename editor", () => {
    const scene = desk();
    const logo = deskLogo();
    const menuItem = new El("button", {
      "hx-get": "/capability-deletion/notes",
      "hx-target": `#${WINDOW_REGION_ID}`,
    });
    logo.append(menuItem);

    // The navigation's exemption belongs to the press that opens a capability, not to
    // everything that happens to be drawn on the tile.
    expect(pressDeskAction(scene, menuItem)).toBe(true);
    expect(spoken(scene)).toContain("Let me finish, then try that again");
  });

  test("is not what the prompt bar is, which has its own sentence", () => {
    const scene = desk();

    // The bar's own `hx-target` is the window, so only its id keeps it out of here — and
    // what it must hear is the sentence about a second prompt, not about desk furniture.
    expect(submitPrompt(scene)).toBe(true);
    expect(spoken(scene)).toBe(
      "I’m still making the last thing you asked for. Let me finish, then tell me the next one.",
    );
  });

  test("is not what a press on a capability's logo is", () => {
    const scene = desk();

    // Opening a capability is a navigation. What it owes the run it walks away from is a
    // warning, and that is a different issue's subject — never this refusal.
    expect(pressDeskAction(scene, deskLogo())).toBe(false);
    expect(spoken(scene)).toBe("");
  });

  test("is not what an action inside the window is", () => {
    const scene = desk();
    const inside = new El("button", { "hx-target": `#${WINDOW_REGION_ID}` });
    scene.region.append(inside);

    expect(pressDeskAction(scene, inside)).toBe(false);
  });

  test("is not what an action aimed somewhere else is", () => {
    const scene = desk();
    const elsewhere = new El("button", { "hx-target": "#capability-logos" });

    expect(pressDeskAction(scene, elsewhere)).toBe(false);
  });
});

describe("the seam the desk's modules speak through", () => {
  test("places what a module asks for, with the cue when it is a refusal", () => {
    const scene = desk();

    scene.fire(PROMPT_BAR_MESSAGE_EVENT, {
      detail: { sentence: "I still can’t tell what happened.", refused: true },
    });

    expect(spoken(scene)).toBe("I still can’t tell what happened.");
    expect(refused(scene)).toBe(true);
    expect(flashing(scene)).toBe(true);
  });

  test("an answer arriving inside a refusal's 400ms takes the cue down with it", () => {
    const scene = desk();
    submitPrompt(scene);
    expect(flashing(scene)).toBe(true);

    scene.fire(PROMPT_BAR_MESSAGE_EVENT, { detail: { sentence: "That’s sorted." } });

    // The cue means *this* sentence was a refusal. Left running over the next one it
    // means nothing at all.
    expect(flashing(scene)).toBe(false);
    expect(spoken(scene)).toBe("That’s sorted.");
  });

  test("the empty sentence retires whatever is standing", () => {
    const scene = desk();
    submitPrompt(scene);

    scene.fire(PROMPT_BAR_MESSAGE_EVENT, { detail: { sentence: "" } });

    expect(spoken(scene)).toBe("");
    expect(flashing(scene)).toBe(false);
  });
});

// The duplicate-prompt path does not let htmx place the restoration: it keeps the active view
// where it is, so the sentence reaches the bar through the shell, not an out-of-band swap.
describe("a deflection that keeps the view it would have replaced", () => {
  /** The scene that path needs: an untouched canonical collection standing in the window. */
  function canonicalDesk() {
    const scene = desk();
    scene.displaced.setAttribute("data-active-capability-incarnation", "inc-1");
    scene.displaced.setAttribute("data-active-capability-version", "1");
    scene.displaced.append(
      new El("div", { "data-search-state": "idle" }),
      new El("input", { "data-capability-search-input": "" }),
    );
    return scene;
  }

  const DECLINED = "You already have Tasks, so I didn’t create another one.";
  const RESTORED = [
    '<div data-build-restoration="capability" data-build-restoration-behavior="preserve">',
    '<div data-active-capability-id="tasks" data-active-capability-incarnation="inc-1" data-active-capability-version="1"></div>',
    "</div>",
  ].join("");
  /** The duplicate's deflection, its sentence written the way the server writes one. */
  const DUPLICATE = RESTORED + renderPromptNotice(DECLINED, "refusal");

  test("lifts the refusal onto the bar with its cue, and leaves the view alone", () => {
    const scene = canonicalDesk();

    expect(streamRestoration(scene, DUPLICATE)).toBe(true);

    expect(spoken(scene)).toBe(DECLINED);
    expect(refused(scene)).toBe(true);
    expect(flashing(scene)).toBe(true);
    expect(scene.displaced.parent).toBe(scene.region);
  });

  test("gives the window back the name the run took from it", () => {
    const scene = canonicalDesk();
    streamRestoration(scene, DUPLICATE);

    closeStream(scene);

    // A prompt that built nothing may not leave the window called `Thinking…` over a
    // collection that has been standing there the whole time.
    expect(scene.dispatched).toContainEqual({
      type: NAME_THE_WINDOW_EVENT,
      detail: { title: null },
    });
  });

  test("and leaves a bare desk bare, because a window holding nothing does not exist", () => {
    const scene = canonicalDesk();
    // Nothing was open: the prompt asked for something the desk already has, and the run
    // took over a window that had only just been stood up for it.
    scene.displaced.remove();
    streamRestoration(scene, DUPLICATE.replace(' data-build-restoration="capability"', ""));
    scene.subscriber.dataset.preserveActiveView = "true";

    closeStream(scene);

    expect(scene.dispatched.map(({ type }) => type)).toContain(PUT_WINDOW_AWAY_EVENT);
  });

  test("and an answer arriving that way brings no cue with it", () => {
    const scene = canonicalDesk();
    const answered = RESTORED + renderPromptNotice("Here it is, just as you left it.");

    expect(streamRestoration(scene, answered)).toBe(true);

    expect(spoken(scene)).toBe("Here it is, just as you left it.");
    expect(flashing(scene)).toBe(false);
  });
});

describe("a sentence the server sent out of band", () => {
  /** htmx finishing the `#prompt-notice` swap `renderPromptNotice` asked for. */
  function landOutOfBand(scene: ReturnType<typeof desk>, html: string) {
    const sentence =
      new RegExp(`<div id="${PROMPT_NOTICE_ID}"[^>]*>([\\s\\S]*)<\\/div>$`).exec(html)?.[1] ?? "";
    const marked = /<span ([\w-]+)>([\s\S]*)<\/span>/.exec(sentence);
    const child = new El("span", marked ? { [marked[1] ?? ""]: "" } : {});
    child.textContent = marked ? (marked[2] ?? "") : sentence;
    scene.notice.replaceChildren(child);
    scene.fire("htmx:oobAfterSwap", { detail: { target: scene.notice } });
  }

  test("flashes the bar when it is a refusal", () => {
    const scene = desk();

    landOutOfBand(scene, renderPromptNotice("What would you like me to make?", "refusal"));

    expect(flashing(scene)).toBe(true);
  });

  test("does not when it is an answer", () => {
    const scene = desk();

    landOutOfBand(scene, renderPromptNotice("I deleted Notes permanently."));

    expect(flashing(scene)).toBe(false);
  });
});

// The shell is a classic script that imports nothing, so every constant it shares with a module or
// the server is restated in it. The scenes above run it against the owners' own names; what is left
// is the page the bar ships on and the one reading of a blank prompt both halves have to share.
describe("the bar the page ships, and the blank prompt both halves refuse", () => {
  /** A submission the bar is asked to judge. @returns whether it was stopped. */
  function submitted(scene: ReturnType<typeof desk>, typed: string) {
    scene.promptField.value = typed;
    const event = eventAt("submit", scene.promptForm, null);
    scene.fire("submit", event);
    return event.defaultPrevented;
  }

  test("one form, with its field and the one slot it speaks in, and the module that runs it", async () => {
    const elements = await elementsOf(readFileSync(resolve("public/index.html"), "utf8"));
    const slots = elements.filter((element) => element.attributes.get("id") === PROMPT_NOTICE_ID);
    const field = byId(elements, PROMPT_FIELD_ID);

    expect(
      slots.map(({ attributes, within }) => [attributes.get("aria-live"), within.at(-1)]),
    ).toEqual([["polite", PROMPT_FORM_ID]]);
    expect(field.within.at(-1)).toBe(PROMPT_FORM_ID);
    // The browser's bubble cannot tell an empty field from one holding three spaces, and it is
    // not the desk's voice either way.
    expect(field.attributes.has("required")).toBe(false);
    expect(moduleSources(elements)).toContain("/static/desk/prompt-bar.js");
  });

  test("the bar refuses exactly the prompts the server would", () => {
    // The server is the oracle: every code point it reads as nothing, found by asking it.
    const nothing: number[] = [];
    for (let point = 0; point <= 0x10ffff; point += 1) {
      if (!hasMeaningfulPromptContent(String.fromCodePoint(point))) nothing.push(point);
    }
    const point = fc.oneof(fc.constantFrom(...nothing), fc.integer({ min: 0, max: 0x10ffff }));
    const scene = desk();

    fc.assert(
      fc.property(fc.array(point, { maxLength: 4 }), (points) => {
        const typed = String.fromCodePoint(...points);
        expect(submitted(scene, typed)).toBe(!hasMeaningfulPromptContent(typed));
      }),
      { seed: 20260926, numRuns: 3000 },
    );
  });
});
