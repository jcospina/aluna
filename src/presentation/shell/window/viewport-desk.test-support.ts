// A standing desk on a screen that can cross the breakpoint: the product's (`startDeskWindow` run
// on it) or the design page's own (`design/scripts/desk.js`), the other consumer of the gestures.
//
// The desk watches the viewport once per module, so each desk imports its own instance, and the
// media query is the page's: the module asks for `PHONE`, and a crossing is that query changing.

import { DESK_GROUND_SELECTOR } from "#shell/desk-window.js";

import { FIRST_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import { cssEscape } from "../../../server/dom-events.test-support.ts";
import { renderCapabilityLogo } from "../../../server/http/fragments.ts";
import { El as ParsedEl, parseHtml } from "../../controls/choice-picker.test-support.ts";
import { El, type StandingDesk, standingDesk } from "./standing-desk.test-support.ts";

type DeskWindowModule = typeof import("#shell/desk-window.js");
type DevPanelModule = typeof import("#shell/desk-dev-panel.js");

let instances = 0;

export interface ViewportDesk {
  readonly desk: StandingDesk;
  readonly module: DeskWindowModule;
  readonly ground: El;
  /** What the module asked the screen about, and the one query it holds. */
  readonly asked: string[];
  readonly htmx: HtmxAsked;
  /** The developer panel's own instance, when the desk was asked to start it. */
  readonly devPanel: DevPanelModule | null;
  /** Cross the breakpoint, or stay where it is and resize: the query answers `phone`. */
  setPhone(phone: boolean): void;
  /** Give a desk that loaded before its stylesheet its edges, and tell whoever was watching. */
  layOut(): void;
  /** The browser's own `resize`, to every listener the page gave it. */
  resize(): void;
  restore(): void;
}

/** The window the standing desk installed, which Bun's own globals do not declare. */
const browserWindow = () => (globalThis as unknown as { window: object }).window;

/** The screen's one media query, answering `phone` until it is told otherwise. */
function screenOf(phone: boolean) {
  const asked: string[] = [];
  const changes: (() => void)[] = [];
  const resizes: (() => void)[] = [];
  const query = {
    matches: phone,
    // A media query list sends one event; a listener for any other type never hears anything.
    addEventListener: (type: string, run: () => void) => {
      if (type === "change") changes.push(run);
    },
  };
  Object.assign(browserWindow(), {
    matchMedia: (media: string) => {
      asked.push(media);
      return query;
    },
    addEventListener: (type: string, run: () => void) => {
      if (type === "resize") resizes.push(run);
    },
  });
  return {
    asked,
    setPhone(next: boolean) {
      query.matches = next;
      for (const run of changes) run();
    },
    resize: () => {
      for (const run of resizes) run();
    },
  };
}

/** What the desk's htmx was asked for while the test ran. */
export interface HtmxAsked {
  readonly requests: { verb: string; path: string; context: Record<string, unknown> }[];
  /** Every swap, with the node it was aimed at: htmx's cleanup is how a story leaves the page. */
  readonly swaps: { target: El; style: unknown }[];
}

/** How the desk is stood up, when the default — a desktop at `/`, no logos — is not it. */
export interface ViewportOptions {
  readonly phone?: boolean;
  /** The address the page loads at, which the desk opens a window for when a logo stands there. */
  readonly pathname?: string;
  /** The logos on the ground, as the server renders each slot. */
  readonly logos?: readonly string[];
  /** What a read the desk asks htmx for resolves with, and when. */
  readonly answer?: () => Promise<unknown>;
  /** False for a cold load, where the desk measures nothing until `layOut` gives it edges. */
  readonly laidOut?: boolean;
  /** What the browser's store already holds when the page loads. */
  readonly stored?: Readonly<Record<string, string>>;
  /** Start the developer panel's module on the desk as well, the way the page does. */
  readonly panel?: boolean;
  /** Anything else the served page stands on the ground before the scripts start. */
  readonly furniture?: readonly string[];
}

/** The server's markup carried into the desk's document, node for node, words and attributes. */
function adopt(from: ParsedEl): El {
  const node = new El(from.tag);
  for (const [name, value] of Object.entries(from.attributes)) {
    node.attrs.set(name, value);
  }
  node.textContent = from.children
    .filter((child) => child.tag === "#text")
    .reduce((words, child) => words + child.ownText, from.ownText);
  node.append(...from.children.filter((child) => child.tag !== "#text").map(adopt));
  return node;
}

/** One capability's slot on the ground, as the server renders it for a fresh desk. */
export const serverLogo = (id: string, label: string): string =>
  renderCapabilityLogo({
    id,
    label,
    display_label_override: null,
    incarnation_id: FIRST_INCARNATION_ID,
    version: 1,
    logo: { status: "absent", attempts: 0 },
  });

/** Server markup as nodes of the desk's document, ready to put anywhere on it. */
export const deskNodes = (html: string): El[] =>
  parseHtml(html, new ParsedEl("div"))
    .children.filter((child) => child.tag !== "#text")
    .map(adopt);

/** A desk on a screen that is, to start with, a phone or not, started the way the page starts it. */
export async function viewportDesk(options: ViewportOptions | boolean = {}): Promise<ViewportDesk> {
  // The shared instances first, with no desk standing, so only the fresh ones start on it.
  await import("#shell/desk-window.js");
  await import("#shell/desk-dev-panel.js");
  const {
    phone = false,
    pathname = "/",
    logos = [],
    answer = () => Promise.resolve(),
    laidOut = true,
    stored = {},
    panel = false,
    furniture = [],
  } = typeof options === "boolean" ? { phone: options } : options;
  const desk = standingDesk(stored);
  const measured = { edges: laidOut };
  const box = desk.layer.getBoundingClientRect();
  desk.layer.getBoundingClientRect = () => (measured.edges ? box : { ...box, width: 0, height: 0 });
  /** Every box watch, with the elements it was asked to watch. */
  const watches: { run: () => void; targets: Set<El> }[] = [];
  // Put back exactly as found: a global left holding `undefined` still answers `in`, and the next
  // suite's installer then skips it and meets `instanceof undefined`.
  const held = ["CSS", "HTMLFormElement"].map(
    (name) => [name, Reflect.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  Object.assign(globalThis, {
    CSS: (globalThis as { CSS?: unknown }).CSS ?? { escape: cssEscape },
    HTMLFormElement: (globalThis as { HTMLFormElement?: unknown }).HTMLFormElement ?? {
      [Symbol.hasInstance]: (value: unknown) => value instanceof El && value.tagName === "form",
    },
    ResizeObserver: class {
      readonly watch: { run: () => void; targets: Set<El> };
      constructor(run: () => void) {
        this.watch = { run, targets: new Set() };
        watches.push(this.watch);
      }
      observe(target: El) {
        this.watch.targets.add(target);
      }
      unobserve(target: El) {
        this.watch.targets.delete(target);
      }
      disconnect() {
        this.watch.targets.clear();
      }
    },
  });
  const ground = new El("div");
  ground.className = DESK_GROUND_SELECTOR.replace(/^\./, "");
  for (const child of [...desk.root.children]) ground.append(child);
  desk.root.append(ground);
  ground.append(...furniture.flatMap(deskNodes));
  if (logos.length > 0) {
    desk.logos.replaceChildren(...logos.flatMap((html) => deskNodes(html)));
  }
  desk.address.pathname = pathname;
  const htmx: HtmxAsked = { requests: [], swaps: [] };
  Object.assign(browserWindow(), {
    htmx: {
      ajax: (verb: string, path: string, context: Record<string, unknown>) => {
        htmx.requests.push({ verb, path, context });
        return answer();
      },
      swap: (target: El, _content: string, spec: { swapStyle?: unknown }) => {
        htmx.swaps.push({ target, style: spec.swapStyle });
        if (spec.swapStyle === "outerHTML") target.remove();
      },
    },
  });
  const { asked, setPhone, resize } = screenOf(phone);
  instances += 1;
  // It starts itself on the document it finds, the way the page loads it.
  const module: DeskWindowModule = await import(
    `../../../../public/desk-window.js?viewport=${instances}`
  );
  const devPanel: DevPanelModule | null = panel
    ? await import(`../../../../public/desk-dev-panel.js?viewport=${instances}`)
    : null;
  return {
    desk,
    module,
    ground,
    asked,
    htmx,
    devPanel,
    setPhone,
    resize,
    layOut() {
      measured.edges = true;
      // Only the layer changed size, so only a watch on the layer hears about it.
      for (const watch of [...watches]) if (watch.targets.has(desk.layer)) watch.run();
    },
    restore() {
      devPanel?.closePanel();
      module.putAway();
      desk.restore();
      for (const [name, had] of held) {
        if (had) Object.defineProperty(globalThis, name, had);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

/** The design page's desk, with one capability on it, on a screen that is a phone or not. */
export async function designDesk(phone: boolean, stored: Readonly<Record<string, string>> = {}) {
  await import("#design/desk.js");
  const desk = standingDesk(stored);
  const screen = screenOf(phone);
  // A window arrives with an entrance animation, which is timing a double has no use for.
  Object.assign(El.prototype, { animate: () => ({}) });
  instances += 1;
  const { Desk } = await import(`../../../../design/scripts/desk.js?viewport=${instances}`);
  const root = new El("div");
  desk.root.append(root);
  const design = new Desk(root, [{ id: "notes", label: "Notes", noun: "note", records: [] }]);
  return {
    desk,
    design,
    root,
    setPhone: screen.setPhone,
    restore() {
      Reflect.deleteProperty(El.prototype, "animate");
      desk.restore();
    },
  };
}
