// @ts-check
/**
 * The desk.
 *
 * Aluna's product surface is a desktop and every capability is an app on it: a
 * logo on the ground, a window when opened, a life cycle you can see. There is
 * no taskbar.
 *
 * One window (D1). The desk shows a single capability window, and that window
 * is the content area (D2): opening a second capability swaps what is inside
 * the frame rather than adding another frame beside it. A record, a build and a
 * confirmation all land in the same place for the same reason. The developer
 * panel (D13) is the one exception, and it is furniture rather than a
 * capability.
 *
 * This is a working implementation of the locked decisions, not a mock-up of
 * one. What it stands in for:
 *
 *   - `localStorage` holds the two remembered boxes (D9). Nothing is kept per
 *     capability, because which capability is open is the address's job (D14) —
 *     and the readout under the desk stands in for an address bar this page
 *     does not own.
 *   - the capabilities are fixtures rather than generated units, and a build is
 *     a timer rather than a model.
 *
 * The window-manager rule holds: CSS transforms and a two-level stack, never a
 * framework, and the frame path is rebuilt on resize only.
 */

import {
  fillDesk,
  fitToDesk,
  PHONE,
  PROMPT_CLEARANCE,
  placeWindow,
  readBox,
  refreshGeometry,
} from "./desk-geometry.js";
import { devTile, logoButton, nameLogo } from "./desk-logo.js";
import { clearStages, DEV_STAGES, devPanelBody, writeStage } from "./devpanel.js";
import { renderCollection } from "./patterns.js";
import { mountPromptBar } from "./prompt-bar.js";
import { wallpaperUrl } from "./wallpaper.js";
import { AlunaWindow } from "./window.js";
import { addWindowDrag, addWindowGrip, setMaximised } from "./window-gestures.js";

/*
 * This page's own layout, and named so. The handbook is served from the product's
 * origin (`/design/*`), so an unqualified `aluna.desk.*` here would sit beside the
 * product's records looking exactly like a third one — and the count is a promise:
 * the browser holds the capability window's and the developer panel's, and nothing
 * else (D9).
 */
const STORAGE_KEY = "aluna.design.desk.layout.v2";

/* Where each window lands the first time, before anything is remembered. */
const DEFAULT_WINDOW = { x: 236, y: 40, w: 470, h: 330 };
const DEFAULT_DEV = { x: 300, y: 150, w: 430, h: 260 };

/**
 * One window's record: the normal box beside the flag, and never a maximised size
 * (D9, decision 18).
 *
 * While a window is maximised the box it stands in is the desk's, and the box it will
 * be given back rides along as `restore`. Writing the pair down would put a second
 * geometry in the one entry — and writing the live box alone would remember *this*
 * screen's width less the inset, which is the stranding the flag exists to prevent.
 *
 * @param {StoredBox} box
 * @returns {Box & { max: boolean }}
 */
function record(box) {
  const { x, y, w, h } = box.restore ?? box;
  return { x, y, w, h, max: box.max === true };
}

/** @typedef {import("./data/capabilities.js").Capability} Capability */

/** @typedef {import("./desk-geometry.js").Box} Box */

/**
 * A box as it is remembered — the shape `window-gestures.js` writes while a window is
 * dragged, resized and maximised.
 * @typedef {import("./window-gestures.js").StoredBox} StoredBox
 */

/**
 * Everything the browser remembers (D9). Two boxes and the flags that say how
 * they are shown — no rows, no z-order, and nothing belonging to a
 * capability's own schema. All of it is how things look to the user, which is
 * the shell's to keep.
 * The capability window's box is `null` until one is authored: a window nobody has
 * moved has no preference to keep, and the box it opens on is decided against the
 * desk it opens on rather than written down once (D9).
 * @typedef {{ window: StoredBox | null, dev: StoredBox & { open: boolean } }} Layout
 */

/**
 * A mounted window and what the desk keeps about it.
 * @typedef {{ kind: "capability" | "dev", win: AlunaWindow, el: HTMLElement,
 *             box: StoredBox, maximised: boolean, gestures: boolean }} DeskWindow
 */

/** A build in flight: what it will become, and what it took the window from. */
/** @typedef {{ id: string, displaced: string | null, timers: number[] }} Build */

/**
 * The eight stages, in the order they arrive. They live with the panel that files
 * them — `devpanel.js` — because the product's second window reads the same list,
 * and a stage the two surfaces disagree about is a stage a developer cannot check.
 */
const STAGES = DEV_STAGES;

export class Desk {
  /**
   * @param {HTMLElement} root
   * @param {Capability[]} capabilities
   * @param {{ onAddress?: (path: string) => void }} [opts]
   */
  constructor(root, capabilities, opts = {}) {
    this.root = root;
    this.capabilities = [...capabilities];
    this.onAddress = opts.onAddress ?? (() => {});
    this.layout = this.#load();

    /** The one capability window, or nothing on a bare desk. */
    /** @type {DeskWindow | null} */
    this.win = null;
    /** @type {DeskWindow | null} */
    this.dev = null;
    /** Which capability the window is showing. The address's other half. */
    /** @type {string | null} */
    this.openId = null;
    /** @type {Build | null} */
    this.build = null;

    const surface = this.#buildSurface();
    this.logoLayer = surface.logoLayer;
    this.windowLayer = surface.windowLayer;
    this.promptBar = surface.promptBar;

    this.#watchViewport();
    this.renderLogos();
    if (this.layout.dev.open) this.openDev();
    this.#announce();
  }

  /* ── the two remembered boxes ─────────────────────────────────────────── */

  /**
   * What was remembered, believing as little of it as possible (D9).
   *
   * Spreading a stored object over a default is not fail-soft: `{"x": "nope"}` becomes
   * the box, `placeWindow` writes `NaNpx`, and the window lands nowhere. Geometry is
   * four finite numbers or it is not geometry, and `readBox` is the one place either
   * surface asks.
   *
   * @returns {Layout}
   */
  #load() {
    /** @type {Layout} */
    const fresh = { window: null, dev: { ...DEFAULT_DEV, open: false } };
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (!stored || typeof stored !== "object") return fresh;
      const window = readBox(stored.window);
      return {
        window: window === null ? null : { ...window, max: stored.window?.max === true },
        dev: {
          ...(readBox(stored.dev) ?? fresh.dev),
          max: stored.dev?.max === true,
          open: stored.dev?.open === true,
        },
      };
    } catch {
      return fresh;
    }
  }

  #save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          window: this.layout.window === null ? null : record(this.layout.window),
          dev: { ...record(this.layout.dev), open: this.layout.dev.open === true },
        }),
      );
    } catch {
      /* A desk that cannot persist is still a working desk. */
    }
  }

  /* ── the desk's own edges ─────────────────────────────────────────────── */

  /**
   * Fit a box to the desk as it is right now and place the window on it: the
   * maximised size if the window is maximised, and inside the edges and above
   * the prompt bar's strip if it is not.
   *
   * Takes the three pieces rather than a mounted window, because the first
   * call happens while one is still being built.
   *
   * On a phone this does nothing. The window is the screen there and the
   * stylesheet places it, so the remembered box is left as it is rather than
   * being squashed to a phone and carried back to a desk that way.
   *
   * @param {HTMLElement} el
   * @param {StoredBox} box
   * @param {boolean} maximised
   */
  #refit(el, box, maximised) {
    if (this.#phone()) return;
    const bounds = this.root.getBoundingClientRect();
    if (maximised) fillDesk(bounds, box);
    else fitToDesk(bounds, box);
    placeWindow(el, box);
  }

  /** Whether the desk is below the breakpoint, where the window is the screen. */
  #phone() {
    return this.root.classList.contains("desk--phone");
  }

  /**
   * The desk's one `window` listener. A screen can change size between two
   * visits and during one, so what is remembered is re-fitted rather than
   * trusted: a maximised window is recomputed against the screen it came back
   * on, and every other box is clamped to it.
   *
   * The desk is watched as well as the viewport, because the two no longer
   * change together. The desk's floor and its minimum are set in rem, so the
   * reader raising their text size grows both without the viewport moving at
   * all — and that is a resize as far as a window is concerned.
   *
   * The phone flag is set here too. Below the breakpoint the window is the
   * screen — no drag, no resize, no maximise — and the flag is what the
   * pointer handlers read to stand down.
   */
  #watchViewport() {
    const phone = window.matchMedia(PHONE);
    let was = phone.matches;

    const onResize = () => {
      refreshGeometry();
      this.root.classList.toggle("desk--phone", phone.matches);
      for (const entry of [this.win, this.dev]) {
        if (!entry) continue;
        this.#syncForm(entry);
        this.#refit(entry.el, entry.box, entry.maximised);
      }
      /* A clamp is not a preference: `#refit` only ever pulls a box in, so writing on
       * every tick would let one transient narrowing erode the remembered box for good.
       * Only the crossing is authored — that is the moment a phone becomes a desk and
       * the desktop box is the live one again. */
      if (was === phone.matches) return;
      was = phone.matches;
      if (this.win) this.layout.window = this.win.box;
      this.#save();
    };

    phone.addEventListener("change", onResize);
    window.addEventListener("resize", onResize);
    /* Once, now. The observer below reports the desk's first size too, but leaving the
     * form to that leaves it undecided until something moves — and the phone class is a
     * thing the desk is *told*, not a thing it drifts into (decision 47). */
    onResize();
    /* A window's box is written as custom properties on the window itself, which
     * is absolutely positioned inside the desk — so re-fitting cannot resize the
     * desk and this cannot feed itself. */
    new ResizeObserver(onResize).observe(this.root);
  }

  /**
   * The box a window with no preference opens on: the default size, centred in the
   * room a window may actually stand in — the desk less the strip the prompt bar
   * holds — so the gaps above, below and to both sides are equal (D9).
   *
   * Measured when it is asked for rather than written down once, because a desk that
   * is hidden or still unstyled has no room to halve — which is why the record holds
   * `null` until a gesture authors a box, rather than holding one decided too early.
   * A desk with no edges at all still falls back to the fixed default, and `#refit`
   * pulls it inside whatever desk it lands on.
   *
   * @returns {Box}
   */
  #defaultWindow() {
    const { w, h } = DEFAULT_WINDOW;
    const bounds = this.root.getBoundingClientRect();
    if (bounds.width < 2 || bounds.height < 2) return { ...DEFAULT_WINDOW };
    refreshGeometry();
    const floor = bounds.height - PROMPT_CLEARANCE;
    return { x: Math.round((bounds.width - w) / 2), y: Math.round((floor - h) / 2), w, h };
  }

  /** Forget both boxes. The capabilities themselves are untouched. */
  resetLayout() {
    this.close();
    this.closeDev();
    this.layout = { window: null, dev: { ...DEFAULT_DEV, open: false } };
    this.#save();
    this.renderLogos();
  }

  /* ── the address ──────────────────────────────────────────────────────── */

  /**
   * What the address bar would read (D14). One window is what makes a single
   * path enough to describe the whole desk: a capability, or nothing.
   */
  #announce() {
    this.onAddress(this.openId ? `/capability/${this.openId}` : "/");
  }

  /* ── surface ──────────────────────────────────────────────────────────── */

  /**
   * Build the desk's own furniture, and hand back the parts it keeps. Returned
   * rather than assigned from in here so the constructor establishes every
   * field — see the same note on `AlunaWindow`.
   *
   * @returns {{ logoLayer: HTMLElement, windowLayer: HTMLElement,
   *             promptBar: ReturnType<typeof mountPromptBar> }}
   */
  #buildSurface() {
    this.root.classList.add("desk");
    this.root.style.backgroundImage = wallpaperUrl();

    const logoLayer = document.createElement("div");
    logoLayer.className = "desk__logos";

    const windowLayer = document.createElement("div");
    windowLayer.className = "desk__windows";

    this.root.append(logoLayer, windowLayer);

    /* The prompt bar floats above the desk, and the strip it occupies is a
     * floor no window may be dragged or resized into. */
    const promptBar = mountPromptBar(this.root, {
      onSubmit: (text) => this.grow(text),
    });

    return { logoLayer, windowLayer, promptBar };
  }

  /* ── logos ────────────────────────────────────────────────────────────── */

  renderLogos() {
    this.logoLayer.replaceChildren(
      ...this.capabilities.map((capability) =>
        logoButton(capability, {
          building: this.build?.id === capability.id,
          onOpen: () => this.open(capability.id),
        }),
      ),
      devTile(() => this.toggleDev()),
    );
  }

  /* ── the one window ───────────────────────────────────────────────────── */

  /**
   * Open a capability. If the window is already up it keeps its box and its
   * hand, and only its contents and its title change — the frame does not move
   * and does not re-roll (D2, D10).
   *
   * @param {string} id
   * @returns {DeskWindow | null}
   */
  open(id) {
    const capability = this.capabilities.find((c) => c.id === id);
    if (!capability) return null;
    /*
     * Only a capability still being built has nothing to show. One whose logo
     * has not arrived yet is finished and usable — it just has no face (L11).
     */
    if (this.build?.id === id) return this.win;

    const entry = this.#ensureWindow();
    this.openId = id;
    entry.win.setTitle(capability.label);
    this.#setBody(entry, renderCollection(capability));
    this.#focus(entry);
    this.#announce();
    return entry;
  }

  /**
   * Close means put away. The window disappears, the logo stays, and the address
   * falls back to the bare desk. Says nothing about the record: this is also how a
   * window goes away when it was never dismissed — a cancelled build takes its
   * window with it — and that is not a decision about where windows go.
   */
  close() {
    if (this.build) this.cancelBuild({ silent: true });
    if (!this.win) return;
    this.win.win.destroy();
    this.win.el.remove();
    this.win = null;
    this.openId = null;
    this.#announce();
  }

  /**
   * The user closing their window: it goes away, and the box it stood in goes with
   * it, so the next window opens on the default (D9). A record is kept so a window
   * survives the browser being closed on it, not so one window's box is inherited by
   * every window after it.
   */
  dismiss() {
    const had = this.win !== null;
    this.close();
    if (!had) return;
    this.layout.window = null;
    this.#save();
  }

  /** @returns {DeskWindow} */
  #ensureWindow() {
    if (this.win) return this.win;
    /* Decided here rather than at load: a desk still gaining its stylesheets measures
     * nothing, and a box halved against nothing is not centred. Not written into the
     * layout either — a box the desk chose is not a box the user asked for, and the
     * record stays empty until a gesture authors one. */
    this.win = this.#mount("capability", "", this.layout.window ?? this.#defaultWindow());
    return this.win;
  }

  /**
   * Swap what the window holds. The frame, the box and the hand are untouched.
   *
   * @param {DeskWindow} entry
   * @param {HTMLElement} node
   */
  #setBody(entry, node) {
    const body = entry.el.querySelector(".desk-window__content");
    if (body instanceof HTMLElement) body.replaceChildren(node);
  }

  /* ── the developer panel ──────────────────────────────────────────────── */

  toggleDev() {
    if (this.dev) this.closeDev();
    else this.openDev();
  }

  openDev() {
    if (this.dev) {
      this.#focus(this.dev);
      return;
    }
    this.dev = this.#mount("dev", "Developer", this.layout.dev);
    this.dev.el.classList.add("window--dev");
    this.#setBody(this.dev, devPanelBody());
    this.layout.dev.open = true;
    this.#focus(this.dev);
    this.#save();
  }

  closeDev() {
    if (!this.dev) return;
    this.dev.win.destroy();
    this.dev.el.remove();
    this.dev = null;
    this.layout.dev.open = false;
    this.#save();
  }

  /**
   * @param {string} stage
   * @param {string} payload
   */
  #devWrite(stage, payload) {
    if (this.dev) writeStage(this.dev.el, stage, payload);
  }

  /** Clear every block back to its resting dash. */
  #devClear() {
    if (this.dev) clearStages(this.dev.el);
  }

  /* ── mounting, focus and stacking ─────────────────────────────────────── */

  /**
   * Every window on the desk is built here, capability or panel. The hand is
   * rolled when the window opens and is not stored (D10): swapping contents
   * cannot re-roll it, because nothing opens.
   *
   * @param {"capability" | "dev"} kind
   * @param {string} title
   * @param {StoredBox} box
   * @returns {DeskWindow}
   */
  #mount(kind, title, box) {
    const el = document.createElement("section");
    el.className = "window window--desk";
    el.dataset.title = title;

    /* What was remembered is fitted to the desk this window is opening on
     * before anything measures it: a maximised window is recomputed against
     * that desk, and any other box that no longer fits is pulled inside.
     *
     * `setMaximised` first, so the remembered box is stashed as the one to give
     * back before `#refit` overwrites the live one with this desk. The record
     * carries no box to restore to — it never holds a maximised size — so this
     * is where the one to restore to comes from. */
    const maximised = box.max === true;
    setMaximised(el, box, maximised);
    this.#refit(el, box, maximised);

    const body = document.createElement("div");
    body.className = "desk-window__content";
    el.append(body);
    this.windowLayer.append(el);

    const win = new AlunaWindow(el, {
      title,
      seed: Math.floor(Math.random() * 9000) + 10,
      /* Over a wallpaper, windows carry their shadow at 40% rather than 24%. */
      shadowAlpha: 0.4,
    });

    /** @type {DeskWindow} */
    const entry = { kind, win, el, box, maximised, gestures: false };
    this.#addLamps(entry);
    this.#syncForm(entry);

    el.addEventListener("pointerdown", () => this.#focus(entry));

    /* A window arrives where it is going to stand: it fades in, and grows the last 4%
     * into itself. Nothing flies in from anywhere — the box is on `translate` (desk.css),
     * which composes before the scale, so this touches no position and cannot go stale
     * against a window that is moved while it is arriving.
     *
     * The fade is life and runs for everyone. The growth is not: a window is a large
     * surface, and 4% of one sweeps its edges further across the desk than any press
     * travels, so it consumes the same axis the stylesheets do. This reads `--travel`
     * rather than asking the OS, because the axis is the one answer and a second one
     * would drift from it (PLAN decision 44). */
    const travel = getComputedStyle(document.documentElement).getPropertyValue("--travel").trim();
    el.animate(
      [
        { opacity: 0, scale: travel === "0" ? "1" : "0.96" },
        { opacity: 1, scale: "1" },
      ],
      { duration: 180, easing: "cubic-bezier(0.2,0.85,0.25,1)" },
    );
    return entry;
  }

  /**
   * Two windows at most, so stacking is a pair rather than a counter: the one
   * you touched last is in front.
   *
   * @param {DeskWindow} entry
   */
  #focus(entry) {
    for (const other of [this.win, this.dev]) {
      if (!other) continue;
      const focused = other === entry;
      other.win.setFocused(focused);
      other.el.classList.toggle("is-focused", focused);
      other.el.style.setProperty("--win-z", focused ? "6" : "5");
    }
  }

  /* ── the three gestures ───────────────────────────────────────────────── */

  /**
   * The desk this window is held inside, and what a gesture on it may do. Dragging,
   * resizing and maximising ship from `window-gestures.js` — one implementation, so
   * no surface can drift from another — and this is everything only the desk knows:
   * where its edges are, that a maximised window and a phone both stand a gesture
   * down, what to bring to the front, and that a finished gesture is remembered.
   *
   * @param {DeskWindow} entry
   * @returns {import("./window-gestures.js").GestureHost}
   */
  #gestureHost(entry) {
    return {
      el: entry.el,
      box: entry.box,
      bounds: () => this.root.getBoundingClientRect(),
      standDown: () => entry.maximised || this.#phone(),
      onStart: () => this.#focus(entry),
      onEnd: () => this.#author(entry),
    };
  }

  /**
   * Where a box becomes a preference. The desk hands a first window a box it chose,
   * and a box the desk chose is not one the user asked for — so the record stays
   * empty until a finished gesture or the leaf lamp says otherwise (D9).
   *
   * The developer panel's box is the layout's own object, mounted by reference and
   * moved in place, so it needs no promoting. So does the capability window's, once
   * there is one; this is only the first box crossing over.
   *
   * @param {DeskWindow} entry
   */
  #author(entry) {
    if (entry.kind === "capability") this.layout.window = entry.box;
    this.#save();
  }

  /* ── lamps ────────────────────────────────────────────────────────────── */

  /**
   * Which form this window is in (decision 47). Below the breakpoint the window is the
   * screen: the drag and the grip do not bind at all rather than binding to controls
   * the stylesheet has hidden, the maximise lamp comes out of the focus order because
   * there is nothing left for it to toggle, and the title bar stops claiming
   * `touch-action: none` on a strip the user needs to scroll from.
   *
   * @param {DeskWindow} entry
   */
  #syncForm(entry) {
    const phone = this.#phone();
    entry.el.querySelector('.lamp[data-action="maximise"]')?.toggleAttribute("hidden", phone);
    entry.win.bar.classList.toggle("window__bar--draggable", !phone);
    if (phone || entry.gestures) return;
    entry.gestures = true;
    const host = this.#gestureHost(entry);
    addWindowGrip(host);
    addWindowDrag(entry.win.bar, host);
  }

  /** @param {DeskWindow} entry */
  #addLamps(entry) {
    entry.el.addEventListener("window:lamp", (event) => {
      event.stopPropagation();
      const { action } = /** @type {CustomEvent<{ action: string }>} */ (event).detail;
      if (action === "maximise" && !this.#phone()) this.#toggleMaximise(entry);
      if (action === "putaway") {
        if (entry.kind === "dev") this.closeDev();
        else this.dismiss();
      }
    });
  }

  /**
   * Maximised is a flag, never a size (D9). What is remembered is that the
   * window was maximised and what box to give back when it is not, so a desk
   * that comes back on a different screen fills that screen instead of the one
   * it left.
   *
   * @param {DeskWindow} entry
   */
  #toggleMaximise(entry) {
    entry.maximised = !entry.maximised;
    setMaximised(entry.el, entry.box, entry.maximised);
    this.#refit(entry.el, entry.box, entry.maximised);
    this.#focus(entry);
    this.#author(entry);
  }

  /* ── growing a capability ─────────────────────────────────────────────── */

  /**
   * What the user watches when they ask Aluna to build something (D6).
   *
   * Two things happen at once and neither is decoration. A placeholder tile
   * lands in the logo grid and stays until the build is done, which is the
   * ambient signal — visible whether or not you are looking at the window. And
   * the window opens on the narration straight away, taking over whatever was
   * in it, because there is one window and a build is what it is doing now.
   *
   * Taking the window over is what puts restoration back on the table: cancel,
   * and whatever the build displaced comes back.
   *
   * @param {string} text what was typed into the prompt bar
   * @returns {Capability | null}
   */
  grow(text) {
    /* One build at a time, which is a lease question rather than a window one. */
    if (this.build) return null;

    const label = titleCase(text) || "Untitled";
    const id = `grown-${Date.now()}`;

    /** @type {Capability} */
    const capability = {
      id,
      label,
      noun: label.toLowerCase().replace(/s$/, ""),
      logo: "",
      pending: true,
      unnamed: true,
      seed: Math.floor(Math.random() * 9000) + 10,
      records: [],
      fields: [{ label: "Name", value: "", guidance: "What to call this one" }],
    };

    /* Registered before the logos are drawn, so the new tile draws working. */
    this.build = { id, displaced: this.openId, timers: [] };
    this.capabilities.push(capability);
    this.renderLogos();

    const entry = this.#ensureWindow();
    this.openId = null;
    entry.win.setTitle("Making it");
    this.#setBody(entry, this.#buildBody(label));
    this.#focus(entry);
    this.#announce();
    this.#devClear();
    this.#runBuild(capability);
    return capability;
  }

  /**
   * The narration surface. A window that does not hold a capability yet holds
   * the story of its own construction instead, which is the whole reason the
   * window opens at submit rather than at commit.
   *
   * @param {string} label
   * @returns {HTMLElement}
   */
  #buildBody(label) {
    const shell = document.createElement("div");
    shell.className = "build";

    const log = document.createElement("div");
    log.className = "build__log";
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");

    const foot = document.createElement("div");
    foot.className = "build__foot";
    const note = document.createElement("span");
    note.className = "build__note xs";
    note.textContent = `Making ${label}`;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--outline";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.cancelBuild());
    foot.append(note, cancel);

    shell.append(log, foot);
    return shell;
  }

  /**
   * Eight stages on a timer. In the product these arrive over SSE and the logo
   * request is made after the gate clears — money is never spent on a build
   * that can still fail (L10).
   *
   * @param {Capability} capability
   */
  #runBuild(capability) {
    const build = this.build;
    if (!build) return;

    STAGES.forEach(({ key, line }, index) => {
      const timer = window.setTimeout(
        () => {
          this.#say(line);
          this.#devWrite(key, `{ "stage": "${key}", "capability": "${capability.id}" }`);
          if (key === "spec") nameLogo(this.root, capability);
          if (index === STAGES.length - 1) this.#commit(capability);
        },
        420 + index * 380,
      );
      build.timers.push(timer);
    });
  }

  /** @param {string} line */
  #say(line) {
    const log = this.win?.el.querySelector(".build__log");
    if (!(log instanceof HTMLElement)) return;
    const row = document.createElement("p");
    row.className = "build__line sm";
    row.textContent = line;
    log.append(row);
    log.scrollTop = log.scrollHeight;
  }

  /**
   * The build cleared. The artwork is requested now — last, once nothing can
   * still refuse the capability — so the tile is a placeholder for a moment
   * longer and then becomes the logo it keeps for life (L7, L10).
   *
   * @param {Capability} capability
   */
  #commit(capability) {
    this.build = null;
    capability.records = [];
    this.renderLogos();
    this.open(capability.id);

    /* The logo request, which the gate has already cleared the way for. */
    window.setTimeout(() => {
      capability.pending = false;
      capability.logo = this.#borrowArtwork(capability);
      this.renderLogos();
    }, 700);
  }

  /**
   * Cancel, fail, go stale or come back a no-op: the window has to give back
   * what the build took. With one window that path is alive rather than
   * vestigial, which is the cost of the window being the content area.
   *
   * @param {{ silent?: boolean }} [opts]
   */
  cancelBuild(opts = {}) {
    const build = this.build;
    if (!build) return;
    for (const timer of build.timers) window.clearTimeout(timer);
    this.build = null;

    this.capabilities = this.capabilities.filter((c) => c.id !== build.id);
    this.renderLogos();
    if (opts.silent) return;

    if (build.displaced) this.open(build.displaced);
    else this.close();
  }

  /**
   * The artwork a grown capability stands on here.
   *
   * In the product this half of the logo is generated once, for that capability
   * alone, and never comes from a pool — there is no Aluna on this page to have
   * one drawn, so a new capability borrows the artwork of one already on the
   * desk. The contract's rule that two capabilities should not arrive on the
   * same ground cannot be kept by borrowing; avoiding the one created before it
   * is as far as a page with no generation can go.
   *
   * @param {Capability} grown
   * @returns {string}
   */
  #borrowArtwork(grown) {
    const drawn = this.capabilities.filter((c) => c.id !== grown.id && c.logo);
    const previous = drawn.at(-1)?.logo;
    const others = drawn.filter((c) => c.logo !== previous);
    const pool = others.length ? others : drawn;
    return pool[Math.floor(Math.random() * pool.length)]?.logo ?? "";
  }
}

/**
 * @param {string} text
 * @returns {string}
 */
function titleCase(text) {
  const cleaned = String(text)
    .replace(/^(build|make|create|grow|add|track)\s+(me\s+)?(an?\s+)?/i, "")
    .replace(/\s+(app|tracker|capability|table)$/i, "")
    .trim();
  if (!cleaned) return "";
  return (
    cleaned
      .split(/\s+/)
      .slice(0, 2)
      /* Split on whitespace after trimming, so no word is ever empty. */
      .map((w) => (w[0] ?? "").toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
  );
}
