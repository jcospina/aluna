// The stack: which slot each window is in, and the one thing a press on it may not do.
//
// Three windows stand at most, and a press brings one forward, so most presses on this desk are
// reaching for a window rather than choosing anything inside it. The browser reads that press as
// the start of a selection, and the smallest drift of the hand leaves a word highlighted in a
// window the person was passing through. What is pinned here is which presses are refused and
// which are left whole — the caret and the context menu are not this rule's to take — and that
// all three windows raise the same way, or one of them still starts a selection when pressed.
//
// The design page's own desk keeps the rule from the same module; the parity suite beside this
// one is where the two surfaces are held to one another.

import { describe, expect, test } from "bun:test";
import { refusePress } from "#design/window-press.js";
import { dismissAnswerWindow, openAnswerWindow } from "#shell/desk-answer-window.js";
import {
  BACK_Z,
  BEHIND_Z,
  FRONT_Z,
  joinStack,
  leaveStack,
  raise,
  raiseFromPress,
  standingCount,
} from "#shell/desk-stack.js";
import { stackMember } from "./desk-window.test-support.ts";
import type { El as DeskEl } from "./standing-desk.test-support.ts";
import { designDesk, deskNodes, viewportDesk } from "./viewport-desk.test-support.ts";

type Standing = ReturnType<typeof stackMember>;

/** An element the press landed on, and the ancestors `closest` climbs from it, as selectors. */
function target(...lineage: string[]) {
  return {
    closest: (selector: string) => {
      const wanted = selector.split(",").map((one) => one.trim());
      return lineage.find((tag) => wanted.includes(tag)) ?? null;
    },
  };
}

/** A pointer press, as much of one as the refusal reads. `PointerEvent` is not a name here. */
type Press = {
  button: number;
  pointerType: string;
  target: unknown;
  view: unknown;
  preventDefault: () => void;
};

/** A press, and whether it was refused. A mouse, because a finger is refused nothing. */
function press(on: unknown = null, over: Partial<Press> = {}) {
  const taken = { refused: false };
  const event = {
    button: 0,
    pointerType: "mouse",
    target: on,
    view: null,
    preventDefault: () => (taken.refused = true),
    ...over,
  } as never;
  return { event, taken };
}

/** Three windows standing, and the desk left empty however the test ends. */
function desk(run: (windows: Record<"behind" | "under" | "front", Standing>) => void) {
  const windows = { behind: stackMember(), under: stackMember(), front: stackMember() };
  for (const one of Object.values(windows)) joinStack(one);
  try {
    run(windows);
  } finally {
    for (const one of Object.values(windows)) leaveStack(one);
    expect(standingCount()).toBe(0);
  }
}

describe("a slot is which window this is, not a number that climbs", () => {
  test("a second window takes the front slot and the first steps back one", () => {
    const capability = stackMember();
    const panel = stackMember();

    joinStack(capability);
    expect(capability.marks.focused).toBe(true);
    expect(capability.marks.z).toBe(FRONT_Z);

    // Opening the panel puts it in front and the capability window steps back one slot. Not down
    // a counter: the slots are named and there is a fixed set of them.
    joinStack(panel);
    expect(panel.marks.z).toBe(FRONT_Z);
    expect(capability.marks.z).toBe(BACK_Z);
    expect(capability.marks.focused).toBe(false);
    expect(standingCount()).toBe(2);

    raise(capability);
    expect(capability.marks.z).toBe(FRONT_Z);
    expect(panel.marks.z).toBe(BACK_Z);

    // Whatever is left when one goes is the only window, so it is the front one — and
    // on a phone that is the difference between the survivor showing and a blank desk.
    leaveStack(capability);
    expect(panel.marks.z).toBe(FRONT_Z);
    expect(panel.marks.focused).toBe(true);
    leaveStack(panel);
    expect(standingCount()).toBe(0);
  });

  test("three windows take three slots, and no two are ever left sharing one", () => {
    desk(({ behind, under, front }) => {
      expect(standingCount()).toBe(3);
      expect(front.marks.z).toBe(FRONT_Z);

      // A press on any window brings it forward, the answer included: a window that cannot be
      // covered makes opening a capability behave like a fault, however it was planned.
      for (const raised of [behind, under, front, behind]) {
        raise(raised);
        expect(raised.marks.z).toBe(FRONT_Z);
        expect(raised.marks.focused).toBe(true);
        // Two windows sharing a slot would hand paint order to the order they were built in,
        // which changes the moment one is put away and opened again.
        const levels = [behind, under, front].map((one) => one.marks.z);
        expect(new Set(levels).size, "two windows share a slot").toBe(3);
        expect(levels).toContain(BEHIND_Z);
      }

      // Dismissing the answer gives back the window it stood over — the one the user was in
      // before it, not whichever opened first. With two windows those were the same thing.
      raise(under);
      raise(front);
      leaveStack(front);
      expect(under.marks.z, "dismissing the answer raised the wrong window").toBe(FRONT_Z);
      expect(behind.marks.z).toBe(BACK_Z);
      joinStack(front);
    });
  });

  test("a window that is not standing is not raised, and takes nobody down with it", () => {
    desk(({ front }) => {
      raise(stackMember());
      // Every window unfocused is no window in front, and below the breakpoint that is a desk
      // with nothing in the page at all.
      expect(front.marks.focused, "a stranger unfocused the whole desk").toBe(true);
      expect(front.marks.z).toBe(FRONT_Z);
    });
  });

  test("a window restored behind another is not mistaken for the one in front", () => {
    // The desk on a deep link: the address opens the capability window, then the remembered
    // developer panel joins behind it. A panel counted as the front window would refuse the
    // next press on the capability window, and the person could select nothing where they are.
    const address = stackMember();
    const restored = stackMember();
    joinStack(address);
    joinStack(restored, false);
    try {
      expect(address.marks.z).toBe(FRONT_Z);
      expect(restored.marks.z).toBe(BACK_Z);

      const held = press();
      raiseFromPress(address, held.event);
      expect(held.taken.refused, "a press in the window in front was taken for a reach").toBe(
        false,
      );

      const reach = press();
      raiseFromPress(restored, reach.event);
      expect(restored.marks.z).toBe(FRONT_Z);
      expect(reach.taken.refused).toBe(true);
    } finally {
      leaveStack(address);
      leaveStack(restored);
      expect(standingCount()).toBe(0);
    }
  });
});

describe("a press on the window behind is a reach, not a choice of text", () => {
  test("it comes forward, and the selection the press would have started never begins", () => {
    desk(({ behind }) => {
      const reach = press();
      raiseFromPress(behind, reach.event);
      expect(behind.marks.z, "the press did not raise the window it landed on").toBe(FRONT_Z);
      expect(reach.taken.refused, "the press was left to start a selection").toBe(true);
    });
  });

  test("the window already in front keeps every press whole", () => {
    desk(({ front }) => {
      const choice = press();
      raiseFromPress(front, choice.event);
      // Selecting text in the window you are in is the gesture this rule must not reach: a
      // record whose text cannot be selected is a record you cannot quote out of the collection.
      expect(choice.taken.refused).toBe(false);
      expect(front.marks.z).toBe(FRONT_Z);
    });
  });

  test("a press at a field is left whole, wherever in the field it lands", () => {
    // Only a real press puts the caret where the person pressed. The shell carries the padding
    // and the boundary and the control sits inside it, so a press at the edge of a field is a
    // press at the field — `closest` is asked of the ancestors for exactly that reason.
    for (const lineage of [["input"], ["span", ".field__control"], ["textarea"]]) {
      desk(({ behind }) => {
        const aimed = press(target(...lineage));
        raiseFromPress(behind, aimed.event);
        expect(behind.marks.z, "aiming at a field cost the window its raise").toBe(FRONT_Z);
        expect(aimed.taken.refused, `refused a press at ${lineage.join(" > ")}`).toBe(false);
      });
    }
  });

  test("a record is a button, and a button is not a field", () => {
    desk(({ behind }) => {
      // The largest text in a capability window sits inside a `<button>`. Exempt buttons and the
      // whole collection goes on selecting itself under a press that only reached the window.
      const card = press(target("span", "button"));
      raiseFromPress(behind, card.event);
      expect(card.taken.refused).toBe(true);
    });
  });

  test("the context menu and the finger are not this rule's to take", () => {
    desk(({ behind }) => {
      for (const over of [{ button: 2 }, { pointerType: "touch" }, { pointerType: "pen" }]) {
        const other = press(null, over);
        raiseFromPress(behind, other.event);
        expect(behind.marks.z).toBe(FRONT_Z);
        expect(other.taken.refused, `refused ${JSON.stringify(over)}`).toBe(false);
      }
    });
  });

  test("a refused press still does the rest of what the browser would have done", () => {
    // Suppressing the `mousedown` suppresses two more of its defaults. Without them a highlight
    // made in one window stays lit while the person works in another, and the caret keeps taking
    // the keys in a window that is now behind.
    const cleared: string[] = [];
    const held = { blur: () => cleared.push("blurred") };
    const body = {};
    const view = {
      getSelection: () => ({ removeAllRanges: () => cleared.push("collapsed") }),
      document: { activeElement: held, body },
    };
    const reach = press(null, { view });
    expect(refusePress(reach.event, true)).toBe(true);
    expect(cleared).toEqual(["collapsed", "blurred"]);

    // Nothing to give up: the body holding focus is focus already unclaimed.
    cleared.length = 0;
    const bare = press(null, { view: { ...view, document: { activeElement: body, body } } });
    refusePress(bare.event, true);
    expect(cleared).toEqual(["collapsed"]);
  });
});

/** A press landing on `on` — a mouse's main button unless told otherwise — and whether it was refused. */
function pressOn(on: DeskEl, how: { pointerType?: string; button?: number } = {}) {
  const taken = { refused: false };
  on.dispatchEvent({
    type: "pointerdown",
    target: on,
    button: 0,
    pointerType: "mouse",
    view: null,
    preventDefault: () => (taken.refused = true),
    ...how,
  } as never);
  return taken.refused;
}

/**
 * The presses a window behind leaves whole, on either desk: a finger, the context menu, and a
 * press into a field, whose caret is the whole point of it. Each still brings the window forward.
 */
function keptWhole(behind: DeskEl, sendBehind: () => void) {
  const field = deskNodes('<input name="title">')[0] as DeskEl;
  behind.querySelector(".window__body")?.append(field);
  const presses = [
    () => pressOn(behind, { pointerType: "touch" }),
    () => pressOn(behind, { button: 2 }),
    () => pressOn(field),
  ];
  return presses.map((press) => {
    sendBehind();
    const wasBehind = !inFront(behind);
    const refused = press();
    return { wasBehind, refused, raised: inFront(behind) };
  });
}

const inFront = (el: DeskEl) => el.classList.contains("is-focused");

describe("every desk that stands a window keeps the same rule", () => {
  test("a press on any of the three windows behind brings it forward, and is refused", async () => {
    const screen = await viewportDesk({ panel: true });
    try {
      screen.module.openWindow("Notes", screen.desk.doc as never);
      screen.devPanel?.openPanel(screen.desk.doc as never);
      openAnswerWindow(screen.desk.doc, "how many notes?", "You have 22 notes.");
      const [capability, panel, answer] = screen.desk.windows() as DeskEl[];
      const three = [capability, panel, answer] as DeskEl[];
      for (const [at, behind] of three.entries()) {
        pressOn(three[(at + 1) % three.length] as DeskEl);
        expect(inFront(behind)).toBe(false);
        expect(pressOn(behind)).toBe(true);
        expect(inFront(behind)).toBe(true);
        // The window already in front keeps every press whole.
        expect(pressOn(behind)).toBe(false);
      }
    } finally {
      dismissAnswerWindow();
      screen.restore();
    }
  });

  test("the design page's desk refuses the same press", async () => {
    // One implementation, the way the gestures are one: `design/scripts/desk.js` is the other
    // surface that stands windows, and a second copy drifts the moment one of them is corrected.
    const design = await designDesk(false);
    try {
      const capability = design.design.open("notes").el as DeskEl;
      design.design.openDev();
      expect(inFront(capability)).toBe(false);
      expect(pressOn(capability)).toBe(true);
      expect(inFront(capability)).toBe(true);
      // The window already in front keeps every press whole, here as on the product's desk.
      expect(pressOn(capability)).toBe(false);
    } finally {
      design.restore();
    }
  });

  test("and on both, a finger, the context menu and a field are never refused", async () => {
    const whole = { wasBehind: true, refused: false, raised: true };
    const screen = await viewportDesk({ panel: true });
    try {
      screen.module.openWindow("Notes", screen.desk.doc as never);
      const [capability] = screen.desk.windows() as DeskEl[];
      const toPanel = () => screen.devPanel?.openPanel(screen.desk.doc as never);
      expect(keptWhole(capability as DeskEl, toPanel)).toEqual([whole, whole, whole]);
    } finally {
      screen.restore();
    }
    const design = await designDesk(false);
    try {
      const capability = design.design.open("notes").el as DeskEl;
      expect(keptWhole(capability, () => design.design.openDev())).toEqual([whole, whole, whole]);
    } finally {
      design.restore();
    }
  });
});
