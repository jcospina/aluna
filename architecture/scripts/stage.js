// @ts-check
/**
 * The desk the deck stands on, set the way the app sets it at each point of the walk. Every slide
 * names a scene: what the prompt bar holds and says, the Finance tracker's logo, and whether the
 * window holds a build, which run and stage it is in, or the Finance tracker itself.
 */

import { logoButton, nameLogo } from "../../design/scripts/desk/desk-logo.js";
import { AlunaWindow } from "../../design/scripts/window/window.js";
import { LABEL, RUNS } from "./build.js";
import { collection, olderRecord } from "./finance.js";
import { Replay } from "./replay.js";

/**
 * @typedef {"none" | "unnamed" | "named" | "live"} Logo
 * @typedef {{ run: "first" | "evolution", cue: number, lands?: 1 | 2 }} Build
 * @typedef {{ version: 1 | 2, saved: boolean }} App
 * @typedef {{ prompt: string, make?: true, busy?: true, notice?: string, logo: Logo,
 *   title?: string, build?: Build, app?: App, opens?: number }} Scene
 */

const FIRST = "I want to track my personal finances";
const SECOND = "Let me separate income from expenses";
const MULLING = "Mulling over what you said.";
const BUILDING = "Building…";
/** What a window that holds something says while a sentence is worked out. */
const THINKING = "Thinking…";

/** How long a landed build holds its last line before the window becomes what it made. */
const LANDING_HOLD_MS = 1600;
/** How long after the commit the logo the build asked for arrives. */
const LOGO_MS = 700;

/** @param {number} cue @param {Logo} [logo] @returns {Scene} */
const first = (cue, logo = "named") => ({
  prompt: FIRST,
  busy: true,
  logo,
  title: BUILDING,
  build: { run: "first", cue },
});

/** @param {number} cue @returns {Scene} */
const evolving = (cue) => ({
  prompt: SECOND,
  busy: true,
  logo: "live",
  title: LABEL,
  build: { run: "evolution", cue },
});

/** @type {Record<string, Scene>} */
const SCENES = {
  cover: { prompt: FIRST, make: true, logo: "none" },
  mulling: { prompt: FIRST, busy: true, notice: MULLING, logo: "none" },
  scheming: first(0, "unnamed"),
  shelving: first(1),
  "rule-writing": first(2),
  tinkering: first(3),
  prodding: first(4),
  mending: first(5),
  polishing: first(6),
  landing: { ...first(7), build: { run: "first", cue: 7, lands: 1 } },
  later: {
    prompt: SECOND,
    make: true,
    logo: "live",
    title: LABEL,
    app: { version: 1, saved: true },
  },
  "evolution-mulling": {
    prompt: SECOND,
    busy: true,
    notice: MULLING,
    logo: "live",
    title: THINKING,
    app: { version: 1, saved: true },
  },
  "evolution-scheming": evolving(0),
  "diff-engine": evolving(0),
  "only-what-changed": evolving(1),
  "version-swap": evolving(2),
  "evolution-landing": { ...evolving(3), build: { run: "evolution", cue: 3, lands: 2 }, opens: 1 },
  path: { prompt: "", logo: "live" },
};

export class Stage {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.input = /** @type {HTMLInputElement} */ (root.querySelector("[data-prompt-input]"));
    this.make = /** @type {HTMLButtonElement} */ (root.querySelector("[data-make]"));
    this.notice = /** @type {HTMLElement} */ (root.querySelector("[data-notice]"));
    this.logos = /** @type {HTMLElement} */ (root.querySelector("[data-logos]"));
    const el = /** @type {HTMLElement} */ (root.querySelector("[data-build-window]"));
    this.win = new AlunaWindow(el, { title: BUILDING });
    // A picture of the app's window: its lamps would offer what nothing here does.
    this.win.lampsEl.inert = true;
    this.win.titleEl.id = "app-window-title";
    el.setAttribute("role", "region");
    el.setAttribute("aria-labelledby", this.win.titleEl.id);
    this.replay = new Replay(() => this.#landed());
    /** @type {Logo} */
    this.logo = "none";
    /** @type {Scene | null} */
    this.scene = null;
    this.step = 0;
    /** @type {1 | 2 | null} the version the window shows once its build landed on this scene */
    this.landedOn = null;
    /** @type {ReturnType<typeof setTimeout>[]} */
    this.timers = [];
  }

  /**
   * @param {HTMLElement} slide
   * @param {number} step
   */
  show(slide, step) {
    const scene = SCENES[slide.dataset.scene ?? ""];
    if (!scene) throw new Error(`No scene for the slide ${slide.id}`);
    const same = scene === this.scene;
    this.scene = scene;
    this.step = step;
    // A step on the same scene only adds notes, or opens a record once the window has landed.
    if (!same) this.#set(scene);
    else if (this.landedOn) this.#app(this.landedOn, this.landedOn === 2);
  }

  /** @param {Scene} scene */
  #set(scene) {
    this.#cancel();
    this.landedOn = null;
    this.#prompt(scene.prompt, scene.busy === true, scene.make === true);
    this.notice.textContent = scene.notice ?? "";
    this.#setLogo(scene.logo);
    this.win.el.hidden = !scene.title;
    if (scene.title) this.win.setTitle(scene.title);
    // Coming back to a landing past its first press finds it the way it was left: landed.
    if (scene.build?.lands && this.step > 0) {
      this.replay.stop();
      this.#land(scene.build.lands);
      this.#setLogo("live");
    } else if (scene.build) {
      const { run, cue } = scene.build;
      this.replay.show(this.#story(), RUNS[run], cue);
    } else {
      this.replay.stop();
      if (scene.app) this.#app(scene.app.version, scene.app.saved);
    }
  }

  /** The window lands: its last line holds, then it becomes what the build made. */
  #landed() {
    const lands = this.scene?.build?.lands;
    if (!lands) return;
    this.timers.push(
      setTimeout(() => {
        this.replay.stop();
        this.#land(lands);
        this.timers.push(setTimeout(() => this.#setLogo("live"), LOGO_MS));
      }, LANDING_HOLD_MS),
    );
  }

  /** @param {1 | 2} lands the version the window becomes */
  #land(lands) {
    this.landedOn = lands;
    this.win.setTitle(LABEL);
    this.#prompt("", false, false);
    this.#app(lands, lands === 2);
  }

  /**
   * @param {1 | 2} version
   * @param {boolean} saved
   */
  #app(version, saved) {
    const opened = this.step >= (this.scene?.opens ?? Number.POSITIVE_INFINITY);
    const view = opened ? olderRecord() : collection(version, saved);
    view.inert = true;
    this.win.body.replaceChildren(view);
  }

  /** The narration's place in the window: the design desk's build shell, made once per build. */
  #story() {
    const found = this.win.body.querySelector(".build__story");
    if (found instanceof HTMLElement) return found;
    const shell = document.createElement("div");
    shell.className = "build";
    const story = document.createElement("div");
    story.className = "build__story";
    shell.append(story);
    this.win.body.replaceChildren(shell);
    return story;
  }

  /**
   * @param {string} text
   * @param {boolean} busy
   * @param {boolean} make
   */
  #prompt(text, busy, make) {
    this.input.value = text;
    this.make.textContent = busy ? "Making it" : "Make it";
    this.make.disabled = !make;
    this.root.classList.toggle("is-making", busy);
  }

  /** @param {Logo} logo */
  #setLogo(logo) {
    if (logo === this.logo) return;
    const was = this.logo;
    this.logo = logo;
    const capability = {
      id: "finance-tracker",
      label: LABEL,
      noun: "transaction",
      logo: logo === "live" ? "./assets/finance-tracker.svg" : "",
      seed: 1150,
      records: [],
      fields: [],
      pending: logo !== "live",
      unnamed: logo === "unnamed",
    };
    if (was === "unnamed" && logo === "named") return nameLogo(this.logos, capability);
    this.logos.replaceChildren(
      ...(logo === "none"
        ? []
        : [logoButton(capability, { building: logo !== "live", onOpen: () => {} })]),
    );
  }

  #cancel() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }
}
