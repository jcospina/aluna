import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { INVALID_CHOICE_ERROR_CODE } from "../registry/index.ts";
import { NOT_FOUND_FRAGMENT } from "../router/failure-responses.ts";
import {
  BLANK_PROMPT_NOTICE,
  NOT_FOUND_NOTICE,
  PROMPT_REFUSAL_ATTRIBUTE,
  renderPromptNotice,
} from "../web/index.ts";
import {
  closeStream,
  desk,
  El,
  eventAt,
  narrateEnding,
  streamRestoration,
  WINDOW_REGION_ID,
} from "./app.shell-double.test-support.ts";

// The desk has two places to speak and each message goes to the one that was asked
// (PLAN decisions 24 and 26; ARCH §6.1, §6.2).
//
// Run rather than grepped, on the shared shell double: these are rules about which
// surface hears a sentence, and a rule about routing proved by a string match is proved
// against nothing.

/** The seam a module of the desk speaks through, restated the way both sides restate it. */
const PROMPT_BAR_MESSAGE_EVENT = "aluna:prompt-bar-message";

/** What the bar is saying, read the way a person reads it. */
function spoken(scene: ReturnType<typeof desk>): string {
  return scene.notice.textContent;
}

/** Whether the sentence standing there is a refusal, and whether the cue is on. */
function refused(scene: ReturnType<typeof desk>): boolean {
  return scene.notice.querySelector(`[${PROMPT_REFUSAL_ATTRIBUTE}]`) !== null;
}

function flashing(scene: ReturnType<typeof desk>): boolean {
  return scene.promptForm.classList.contains("is-refused");
}

/**
 * One request leaving the page, with the target htmx has already resolved for it. Both
 * halves are what the real event carries: the element that asked, and where its answer
 * would land.
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

/** A capability's logo: on the desk, and the one thing there that opens rather than acts. */
function deskLogo() {
  return new El("button", {
    "data-capability-logo": "",
    "data-capability-id": "notes",
    "hx-target": `#${WINDOW_REGION_ID}`,
  });
}

/** The undeclared-choice refusal, exactly as `src/router/failure-responses.ts` writes it. */
const INVALID_CHOICE_FRAGMENT = `<p class="notice" data-role="error" data-error-code="${INVALID_CHOICE_ERROR_CODE}" data-error-fields="status">That isn’t one of the options I can store here. Mind picking one from the list?</p>`;

/** The read-gate refusal, exactly as `src/router/failure-responses.ts` writes it. */
const READ_UNAVAILABLE =
  '<p class="notice" data-role="error" data-error-code="read_unavailable">I’m making a careful change here. Give me a moment, then try that again.</p>';

/**
 * One structured refusal, asked for by `asking` and answered by the router.
 * @returns whether htmx was told to swap the response where it was aimed.
 */
function structuredRefusal(
  scene: ReturnType<typeof desk>,
  asking: El,
  body = READ_UNAVAILABLE,
  status = 409,
) {
  // htmx dispatches `htmx:beforeSwap` on the swap target, so `elt` here is the region and
  // the element that asked rides in the request's own configuration — the shape a live
  // browser check against the vendored htmx confirmed.
  const detail = {
    xhr: { status, responseText: body },
    shouldSwap: false,
    elt: scene.region,
    requestConfig: { elt: asking },
  };
  scene.fire("htmx:beforeSwap", { detail });
  return detail.shouldSwap;
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

  test("flashes the bar as the cue, and the cue lets go on its own", async () => {
    const scene = desk();

    submitPrompt(scene);
    expect(flashing(scene)).toBe(true);

    // Waited for rather than slept past: the cue is 400ms, this suite runs sharded beside
    // nine hundred other tests, and a margin measured in tens of milliseconds is a flake.
    for (let waited = 0; waited < 4000 && flashing(scene); waited += 25) await Bun.sleep(25);
    expect(flashing(scene)).toBe(false);
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
      expect(spoken(scene)).toBe("What would you like me to make?");
      expect(refused(scene)).toBe(true);
      expect(flashing(scene)).toBe(true);
    }
  });

  test("and neither becomes a request, so no window is opened for it", () => {
    const scene = desk();

    submitBlank(scene, "   ");

    // Stopped at the document in the capture phase: htmx listens on the form itself, so
    // an event that never reaches it never goes on the wire, and the desk's own opener
    // reads `defaultPrevented` rather than standing a frame up to close again.
    expect(scene.propagationStopped).toContain("submit");
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
    submitPrompt(scene);
    expect(spoken(scene)).toContain("I’m still making the last thing you asked for");

    closeStream(scene);

    expect(spoken(scene)).toBe("");
    expect(flashing(scene)).toBe(false);
  });

  test("but the words typed while waiting are kept, because they were never sent", () => {
    const scene = desk();
    scene.startShell();
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

describe("a structured refusal renders on the surface it arrived from", () => {
  test("in the window, when the window is what asked", () => {
    const scene = desk();
    const field = new El("form", { id: "notes-create" });
    scene.region.append(field);

    expect(structuredRefusal(scene, field)).toBe(true);
    // Aimed where the router aimed it, and the bar says nothing it was not asked.
    expect(spoken(scene)).toBe("");
  });

  test("on the prompt bar, when something on the desk is what asked", () => {
    const scene = desk();

    expect(structuredRefusal(scene, deskLogo())).toBe(false);
    expect(spoken(scene)).toBe(
      "I’m making a careful change here. Give me a moment, then try that again.",
    );
    expect(refused(scene)).toBe(true);
    // The window keeps everything it was holding: the refusal never reached it.
    expect(scene.region.childNodes).toEqual([scene.displaced, scene.subscriber]);
  });

  test("where it was aimed, when its sentence cannot be read", () => {
    const scene = desk();
    const unreadable = '<p data-role="error" data-error-code="read_unavailable"></p>';

    // Silence is the one answer this rule may never give, so an empty refusal is left to
    // land where it was already going rather than moved to a slot with nothing in it.
    expect(structuredRefusal(scene, deskLogo(), unreadable)).toBe(true);
    expect(spoken(scene)).toBe("");
  });

  test("a press on a tile whose capability has gone speaks, rather than flickering a window", () => {
    const scene = desk();

    // The router's own fragment, not a copy of it: the code the server marks a refusal
    // with and the codes this shell rescues are two halves of one contract, and htmx drops
    // any 4xx the shell does not claim — so a fragment written for a screen it never
    // reaches is the failure this pins (5.9/03).
    expect(structuredRefusal(scene, deskLogo(), NOT_FOUND_FRAGMENT, 404)).toBe(false);
    expect(spoken(scene)).toBe(NOT_FOUND_NOTICE);
    expect(refused(scene)).toBe(true);
    expect(scene.region.childNodes).toEqual([scene.displaced, scene.subscriber]);
  });

  test("an undeclared choice value lands in the form it was submitted from", () => {
    const scene = desk();
    const field = new El("form", { id: "job_applications-edit" });
    scene.region.append(field);

    // The router's own fragment. The shell claims a refusal by its code or htmx drops the
    // 422 entirely, so a new platform code has to arrive on both halves at once.
    expect(structuredRefusal(scene, field, INVALID_CHOICE_FRAGMENT, 422)).toBe(true);
    expect(spoken(scene)).toBe("");
  });

  test("and an unmarked 4xx is still none of the shell's business", () => {
    const scene = desk();
    const body = '<p class="notice">something else entirely</p>';

    expect(structuredRefusal(scene, deskLogo(), body)).toBe(false);
    expect(spoken(scene)).toBe("");
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

// The duplicate-prompt path does not let htmx place the restoration at all — it keeps the
// active view exactly where it is and lifts only the explanation out of the payload — so
// the sentence reaches the bar through the shell rather than through an out-of-band swap.
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

  const DUPLICATE = [
    '<div data-build-restoration="capability" data-build-restoration-behavior="preserve">',
    '<div data-active-capability-id="tasks" data-active-capability-incarnation="inc-1" data-active-capability-version="1"></div>',
    "</div>",
    '<div id="prompt-notice" hx-swap-oob="innerHTML">',
    "<span data-prompt-refusal>You already have Tasks, so I didn’t create another one.</span>",
    "</div>",
  ].join("");

  test("lifts the refusal onto the bar with its cue, and leaves the view alone", () => {
    const scene = canonicalDesk();

    expect(streamRestoration(scene, DUPLICATE)).toBe(true);

    expect(spoken(scene)).toBe("You already have Tasks, so I didn’t create another one.");
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
      type: "aluna:name-the-window",
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

    expect(scene.dispatched.map(({ type }) => type)).toContain("aluna:put-window-away");
  });

  test("and an answer arriving that way brings no cue with it", () => {
    const scene = canonicalDesk();
    const answered = DUPLICATE.replace(
      "<span data-prompt-refusal>You already have Tasks, so I didn’t create another one.</span>",
      "Here it is, just as you left it.",
    );

    expect(streamRestoration(scene, answered)).toBe(true);

    expect(spoken(scene)).toBe("Here it is, just as you left it.");
    expect(flashing(scene)).toBe(false);
  });
});

describe("a sentence the server sent out of band", () => {
  /** htmx finishing the `#prompt-notice` swap `renderPromptNotice` asked for. */
  function landOutOfBand(scene: ReturnType<typeof desk>, html: string) {
    const sentence = /<div id="prompt-notice"[^>]*>([\s\S]*)<\/div>$/.exec(html)?.[1] ?? "";
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

// The shell is a classic script that imports nothing, so every constant it shares with a
// module or with the server is restated in it. These are the pins that keep the copies
// honest.
describe("the strings the desk restates", () => {
  const shellGlue = readFileSync(resolve("public/app.js"), "utf8");
  const promptBar = readFileSync(resolve("public/prompt-bar.js"), "utf8");

  test("the refusal marker the server writes is the one the bar flashes on", () => {
    expect(renderPromptNotice("x", "refusal")).toContain(`<span ${PROMPT_REFUSAL_ATTRIBUTE}>`);
    expect(promptBar).toContain(`const PROMPT_REFUSAL_ATTRIBUTE = "${PROMPT_REFUSAL_ATTRIBUTE}";`);
    // The glue reads the marker back out of a parked deflection, so it restates it too.
    expect(shellGlue).toContain(`const PROMPT_REFUSAL_SELECTOR = "[${PROMPT_REFUSAL_ATTRIBUTE}]";`);
  });

  test("the bar's own ids agree wherever they are restated", () => {
    const deskWindow = readFileSync(resolve("public/desk-window.js"), "utf8");

    for (const source of [promptBar, shellGlue]) {
      expect(source).toContain('const PROMPT_FORM_ID = "spec-build-form";');
      expect(source).toContain('const PROMPT_FIELD_ID = "spec-build-prompt";');
      expect(source).toContain('const PROMPT_NOTICE_ID = "prompt-notice";');
    }
    // The deletion module hands the keyboard back to the same field every way out of a
    // deletion, so it restates that id too.
    expect(readFileSync(resolve("public/capability-deletion.js"), "utf8")).toContain(
      'const PROMPT_FIELD_ID = "spec-build-prompt";',
    );
    expect(deskWindow).toContain('export const PROMPT_FORM_ID = "spec-build-form";');
  });

  test("what the desk says to the bar, and what it asks of it", () => {
    // The deletion module imports the seam rather than restating it; only the glue,
    // which is a classic script and can import nothing, has a copy to keep honest.
    expect(promptBar).toContain(
      'export const PROMPT_BAR_MESSAGE_EVENT = "aluna:prompt-bar-message";',
    );
    expect(promptBar).toContain(
      'export const PROMPT_BAR_RETIRE_RUN_SENTENCE_EVENT = "aluna:retire-run-sentence";',
    );
    expect(shellGlue).toContain('new CustomEvent("aluna:prompt-bar-message"');
    expect(shellGlue).toContain('new CustomEvent("aluna:retire-run-sentence"');
    expect(readFileSync(resolve("public/capability-deletion.js"), "utf8")).toContain(
      'import { PROMPT_BAR_MESSAGE_EVENT } from "./prompt-bar.js";',
    );
  });

  test("the logo the desk-action rule steps around is the desk's own", () => {
    const deskWindow = readFileSync(resolve("public/desk-window.js"), "utf8");
    const selector = 'const CAPABILITY_LOGO_SELECTOR = "[data-capability-logo]";';

    expect(deskWindow).toContain(`export ${selector}`);
    expect(shellGlue).toContain(selector);
  });

  test("the bar the cue goes on is the form the shell ships", () => {
    const shell = readFileSync(resolve("public/index.html"), "utf8");

    expect(shell).toContain('id="spec-build-form"');
    expect(shell).toContain('<div id="prompt-notice" class="prompt__notice" aria-live="polite">');
    // One slot, and the desk gains no notice component of its own for these messages.
    expect(shell.match(/id="prompt-notice"/g)).toHaveLength(1);
    expect(shell).toContain('<script type="module" src="/static/prompt-bar.js"></script>');
  });

  test("the bar reads a blank submission exactly the way the server does", () => {
    const server = readFileSync(resolve("src/web/prompt-request.ts"), "utf8");
    const pattern = "/[\\p{White_Space}\\p{Default_Ignorable_Code_Point}\\p{Cc}]/gu";

    expect(server).toContain(pattern);
    expect(promptBar).toContain(pattern);
    // And the same sentence, so the two answers are one answer.
    expect(promptBar).toContain(`const BLANK_PROMPT_NOTICE = "${BLANK_PROMPT_NOTICE}";`);
  });

  test("the field carries no browser validation to answer it first", () => {
    const shell = readFileSync(resolve("public/index.html"), "utf8");
    const field = /<input[^>]*id="spec-build-prompt"[\s\S]*?>/.exec(shell)?.[0] ?? "";

    // The browser's bubble cannot tell an empty field from one holding three spaces, and
    // it is not the desk's voice either way.
    expect(field).not.toContain("required");
  });

  test("the desk does not open a window for a submission already refused", () => {
    const deskWindow = readFileSync(resolve("public/desk-window.js"), "utf8");

    expect(deskWindow).toContain("if (event.defaultPrevented) return;");
  });

  test("the cue is the design's own state, at the design's own duration", () => {
    const promptCss = readFileSync(resolve("public/css/prompt.css"), "utf8");

    expect(promptBar).toContain('const PROMPT_REFUSED_CLASS = "is-refused";');
    expect(promptBar).toContain("const PROMPT_REFUSAL_FLASH_MS = 400;");
    // The design's placeholder rule verbatim, and the rail's own alert fill for the case
    // the design never drew: a refusal that keeps what the person typed, where there is
    // no placeholder on screen for the cue to land on.
    expect(promptCss).toContain(".prompt.is-refused .prompt__field::placeholder");
    expect(promptCss).toContain("color: var(--signal)");
    // Scoped so the fill only applies where the placeholder rule has nothing to say.
    expect(promptCss).toContain(
      ".prompt.is-refused:has(.prompt__field:not(:placeholder-shown)) .prompt__composer",
    );
    expect(promptCss).toContain("background: var(--well-alert)");
  });
});
