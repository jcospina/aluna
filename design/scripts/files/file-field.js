// @ts-check
/**
 * The file field: one control for a field that holds a file, in the shape its families ask
 * for (`styles/components/controls/file-field.css`). A photo or a video fills a frame that is its
 * own preview; a field that takes a document or a sound is a row a text field's height.
 * A field of many files is `file-list.js`, the record's full player `file-player.js`, and
 * what all three draw with `file-parts.js`; the controls share the form's held save here.
 *
 * The control owns its states and nothing about the bytes. A page hands it a `transfer`
 * that streams a pick and settles with the file as it is served, or refuses it with a
 * sentence; admission is the platform's, so every pick goes to the transfer and every
 * refusal is said in the field. On the design pages the transfer is a timer
 * (`file-bench.js`); in the product it is the upload route. The preview is always what the
 * transfer settled with, never the picked file, because the served copy is the one the
 * record will keep.
 */

import {
  acceptOf,
  bytesOf,
  chooseOf,
  esc,
  FileRefusal,
  G,
  glyph,
  goesTo,
  HINT,
  harvestSeeds,
  kindOf,
  kindsIn,
  nounFor,
  pctOf,
  progressAttrs,
  rowEnds,
  seed,
  shapeOf,
  sizeOf,
  square,
  timeText,
  togglePlayback,
  UNPLAYABLE,
  wirePreview,
} from "./file-parts.js";

import { forget, heldBack, keepUnsent, record, resend, settle } from "./file-recording.js";
import { browserRecorderEnv, canRecord } from "./recorder-env.js";
import { recordAgainSquare, recordButton, unsentRow } from "./recorder-parts.js";

export { FileRefusal } from "./file-parts.js";

/**
 * @typedef {import("./file-parts.js").Kind} Kind
 * @typedef {import("./file-parts.js").Picked} Picked
 * @typedef {import("./file-parts.js").Held} Held
 * @typedef {import("./file-parts.js").Upload} Upload
 * @typedef {import("./file-parts.js").InFlight} InFlight
 * @typedef {(picked: Picked, kind: Kind, onProgress: (loaded: number) => void,
 *             host: HTMLElement) => Upload} Transfer
 * @typedef {{ host: HTMLElement, body: HTMLElement, guidance: HTMLElement | null,
 *             live: HTMLElement, input: HTMLInputElement, kind: Kind, kinds: Kind[],
 *             guide: string,
 *             transfer: Transfer, saved: Held | null, current: Held | null,
 *             upload: InFlight | null, refusal: string | null, notice?: string | null,
 *             quiet?: boolean, unsent?: Picked | null, unholdUnsent?: () => void,
 *             settleUntil?: number,
 *             seeds: Map<string, number>, wired?: AbortController,
 *             env: RecorderEnv, recorder: import("./file-recorder.js").Recorder | null,
 *             hold?: Hold, focus?: string }} Field
 * @typedef {import("./recorder-env.js").RecorderEnv} RecorderEnv
 * @typedef {(host: HTMLElement, label: string, release: () => void) => () => void} Hold
 * @typedef {{ recorder?: RecorderEnv, hold?: Hold }} FieldOptions
 */

/**
 * The attributes a page draws a field and its form's save with: every name the control finds its
 * markup by, so a server drawing that markup writes the same ones.
 */
export const FILE_FIELD_HOOKS = Object.freeze({
  field: "data-file-field",
  list: "data-file-list",
  holds: "data-holds",
  cap: "data-file-cap",
  body: "data-file-body",
  kind: "data-kind",
  accept: "data-file-accept",
  holdsName: "data-holds-name",
  holdsSize: "data-holds-size",
  holdsSrc: "data-holds-src",
  holdsDuration: "data-holds-duration",
  holdsType: "data-holds-type",
  focus: "data-file-focus",
  save: "data-held-save",
  saveLabel: "data-held-save-label",
});

/** @param {string} name */
const hooked = (name) => `[${name}]`;

/** What the field says when a transfer fails without a sentence of its own. */
const FAILED = "I couldn’t take that one just now. Mind trying again?";

/* ── Markup, one function per shape and state ─────────────────────────────── */

/** @param {Field} f */
const pickAttrs = (f) =>
  ` type="button" data-file-pick ${FILE_FIELD_HOOKS.focus} aria-labelledby="${f.host.id}-label ${f.host.id}-cta" aria-describedby="${f.host.id}-guidance"`;

/**
 * A named action on the frame's line: the word it shows, and the file it acts on for a
 * screen reader.
 *
 * @param {Field} f
 * @param {string} role
 * @param {string} text
 * @param {string} label
 * @param {string} attrs
 */
const barButton = (f, role, text, label, attrs) =>
  `<button class="btn btn--outline btn--sm" type="button" ${attrs} aria-label="${label}" aria-describedby="${f.host.id}-guidance"${seed(f, role)}>${text}</button>`;

/** @param {Field} f */
const emptyFrame = (
  f,
) => `<button class="field__control file__stage file__pick file__drop"${pickAttrs(f)}${seed(f, "well")}>
  <span class="file__glyph">${glyph(28, f.kinds.length > 1 ? G.up : G[f.kind])}</span>
  <span class="file__cta" id="${f.host.id}-cta">${chooseOf(f.kinds)}</span>
  <span class="file__sub">${HINT}</span>
</button>`;

/**
 * @param {Field} f
 * @param {InFlight} u
 */
const uploadingFrame = (
  f,
  u,
) => `<span class="field__control file__stage file__drop"${progressAttrs(u)}${seed(f, "well")}>
  <span class="file__pct" data-file-pct>${pctOf(u)}%</span>
  <span class="file__sub" data-file-bytes>${bytesOf(u)}</span>
  <span class="file__track"><span class="file__line"></span></span>
</span>
<div class="file__bar">
  <span class="file__meta">${esc(u.picked.name)}</span>
  ${barButton(f, "stop", "Stop", `Stop uploading ${esc(u.picked.name)}`, `data-file-stop ${FILE_FIELD_HOOKS.focus}`)}
</div>`;

/**
 * @param {Field} f
 * @param {Held} held
 */
function playButton(f, held) {
  const mark = `<span data-file-play-glyph>${glyph(12, G.play, true)}</span>`;
  return `<button class="btn btn--outline btn--sm file__play" type="button" data-file-play aria-pressed="false" aria-label="Play ${esc(held.name)}"${seed(f, "play")}>${mark}<span data-file-time>${timeText(held.duration, null)}</span></button>`;
}

/**
 * No poster and no promise of a first frame (decision 28): the kind's glyph stands behind the
 * picture, so a browser that draws nothing — or a file too large to preview here — still
 * shows what the field holds.
 *
 * @param {Field} f
 * @param {Held} held
 */
function preview(f, held) {
  const kind = kindOf(held, f.kinds);
  const backdrop = `<span class="file__backdrop file__glyph">${glyph(32, G[kind])}</span>`;
  if (!held.url || UNPLAYABLE.has(held)) return `<span class="file__frame">${backdrop}</span>`;
  if (kind !== "video")
    return `<span class="file__frame"><img src="${esc(held.url)}" alt=""></span>`;
  return `<span class="file__frame">${backdrop}<video src="${esc(held.url)}" preload="metadata" playsinline data-file-media></video></span>
    ${playButton(f, held)}`;
}

/**
 * @param {Field} f
 * @param {Held} held
 */
const filledFrame = (
  f,
  held,
) => `<span class="field__control file__stage file__drop is-filled"${seed(f, "well")}>
  ${preview(f, held)}
  <span class="file__veil" aria-hidden="true">Drop to replace</span>
</span>
<div class="file__bar">
  <span class="file__meta">${esc(held.name)} · ${sizeOf(held.size)}</span>
  ${kindOf(held, f.kinds) === "video" && held.url ? barButton(f, "open", "Open", `Open ${esc(held.name)}`, "data-file-open") : ""}
  ${barButton(f, "replace", "Replace", `Replace ${esc(held.name)}`, `data-file-pick ${FILE_FIELD_HOOKS.focus}`)}
  ${barButton(f, "clear", "Clear", `Clear ${esc(held.name)}`, "data-file-clear")}
</div>`;

/**
 * Every field that takes a sound records one too, where the browser can (7.2/04).
 *
 * @param {Field} f
 */
const records = (f) => f.kinds.includes("audio") && canRecord(f.env);

/** @param {Field} f */
const emptyRow = (f) => `<div class="file__row">
  <button class="field__control file__well file__pick file__drop"${pickAttrs(f)}${seed(f, "well")}>
    <span class="file__glyph">${glyph(18, f.kinds.length > 1 ? G.up : G[f.kind])}</span>
    <span class="file__cta" id="${f.host.id}-cta">${chooseOf(f.kinds)}</span>
    <span class="file__meta file__hint">${HINT}</span>
  </button>
  ${records(f) ? recordButton(f) : ""}
</div>`;

/**
 * @param {Field} f
 * @param {InFlight} u
 */
const uploadingRow = (f, u) => `<div class="file__row">
  <span class="field__control file__well file__drop"${progressAttrs(u)}${seed(f, "well")}>
    <span class="file__glyph">${glyph(18, G.up)}</span>
    <span class="file__name">${esc(u.picked.name)}</span>
    <span class="file__meta" data-file-pct>${pctOf(u)}%</span>
  </span>
  <span class="file__actions">
    ${square(f, "stop", `Stop uploading ${esc(u.picked.name)}`, glyph(12, G.stop, true), `data-file-stop ${FILE_FIELD_HOOKS.focus}`)}
  </span>
</div>`;

/**
 * @param {Field} f
 * @param {Held} held
 */
function filledRow(f, held) {
  const kind = kindOf(held, f.kinds);
  const [lead, meta] = rowEnds(held, kind);
  const name = esc(held.name);
  return `<div class="file__row">
    <span class="field__control file__well file__drop"${seed(f, "well")}>
      ${lead}
      <span class="file__name">${name}</span>
      ${meta}
    </span>
    <span class="file__actions">
      ${goesTo(f, held, kind, "data-file-open", "go")}
      ${square(f, "replace", `Replace ${name}`, glyph(14, G.replace), `data-file-pick ${FILE_FIELD_HOOKS.focus}`)}
      ${records(f) ? recordAgainSquare(f, held.name) : ""}
      ${square(f, "clear", `Clear ${name}`, glyph(14, G.clear), "data-file-clear")}
    </span>
  </div>`;
}

/** @param {Field} f */
function bodyOf(f) {
  if (f.recorder) return f.recorder.markup();
  if (f.unsent && !f.upload) return unsentRow(f, f.unsent.name);
  const frame = shapeOf(f.kinds) === "frame";
  if (f.upload) return frame ? uploadingFrame(f, f.upload) : uploadingRow(f, f.upload);
  if (f.current) return frame ? filledFrame(f, f.current) : filledRow(f, f.current);
  return frame ? emptyFrame(f) : emptyRow(f);
}

/* ── State ────────────────────────────────────────────────────────────────── */

/**
 * Said by a field after every change of state, bubbling, so a page can keep what it posts in
 * step with what the field holds. `saved` and `current` are the same object while the field
 * holds what it was mounted with.
 *
 * @typedef {{ saved: Held | null, current: Held | null, uploading: boolean }} FileFieldChange
 */
export const FILE_FIELD_CHANGE = "file-field:change";

/**
 * Asked for by a held video or sound, bubbling, so the page can take the window to the record's
 * render view, where it plays in full (decision 29).
 *
 * @typedef {{ held: Held, kind: Kind, field: HTMLElement }} FileFieldOpen
 */
export const FILE_FIELD_OPEN = "file-field:open";

/** @type {WeakMap<HTMLElement, Field>} */
const FIELDS = new WeakMap();

/**
 * What a form asks of every file control in it, a single field or a list: which kinds are
 * travelling, and how to settle when the form saves or cancels.
 *
 * @typedef {{ uploading: () => string[], settle: (how: "keep" | "revert") => void }} FileControl
 * @type {WeakMap<Element, FileControl>}
 */
const CONTROLS = new WeakMap();

/**
 * @param {HTMLElement} host
 * @param {FileControl} control
 */
export const registerFileControl = (host, control) => CONTROLS.set(host, control);

/** @param {HTMLElement} host */
export const scopeOf = (host) => host.closest("form, .form") ?? host.parentElement ?? document.body;

/** @param {Element} scope */
const controlsIn = (scope) =>
  [
    ...scope.querySelectorAll(
      `${hooked(FILE_FIELD_HOOKS.field)}, ${hooked(FILE_FIELD_HOOKS.list)}`,
    ),
  ].flatMap((el) => {
    const c = CONTROLS.get(el);
    return c ? [c] : [];
  });

/**
 * @param {HTMLElement} save
 * @param {string | null} waiting
 */
function holdOne(save, waiting) {
  const label = save.querySelector(hooked(FILE_FIELD_HOOKS.saveLabel));
  if (!(label instanceof HTMLElement)) return;
  label.dataset.rest ??= label.textContent ?? "";
  if (waiting === null) {
    save.removeAttribute("aria-disabled");
    label.textContent = label.dataset.rest;
  } else {
    save.setAttribute("aria-disabled", "true");
    label.textContent = waiting;
  }
}

/**
 * A form cannot be saved while any upload in it is in flight (decision 19). Its save stays in
 * the tab order, so a keyboard lands on it and a screen reader says what it is waiting on.
 *
 * @param {Element} scope
 */
export function holdSave(scope) {
  const waiting = controlsIn(scope).flatMap((c) => c.uploading());
  const [only] = waiting;
  let label = null;
  if (only)
    label = waiting.length > 1 ? "I’m waiting on the files…" : `I’m waiting on the ${only}…`;
  for (const save of scope.querySelectorAll(hooked(FILE_FIELD_HOOKS.save))) {
    if (save instanceof HTMLElement) holdOne(save, label);
  }
}

/** @param {Field} f */
function render(f) {
  const hadFocus = f.body.contains(document.activeElement);
  harvestSeeds(f);
  f.body.innerHTML = bodyOf(f);
  f.host.classList.toggle("is-refused", f.refusal !== null);
  f.host.classList.toggle("is-invalid", f.refusal !== null && !f.quiet && !f.current && !f.upload);
  if (f.guidance) {
    f.guidance.textContent = f.refusal ?? f.notice ?? f.guide;
    f.guidance.hidden = f.guidance.textContent === "";
    f.guidance.classList.toggle("field__guidance--error", f.refusal !== null);
  }
  f.wired?.abort();
  f.wired = new AbortController();
  const heard = (/** @type {string} */ text) => say(f, text);
  if (f.current && !f.recorder)
    wirePreview(f.body, f.current, kindOf(f.current, f.kinds), heard, f.wired.signal);
  f.recorder?.wire(f.body, f.wired.signal);
  holdSave(scopeOf(f.host));
  const next = f.body.querySelector(f.focus ?? hooked(FILE_FIELD_HOOKS.focus));
  f.focus = undefined;
  if (hadFocus && next instanceof HTMLElement) next.focus({ focusVisible: true });
  f.host.dispatchEvent(
    new CustomEvent(FILE_FIELD_CHANGE, {
      bubbles: true,
      detail: { saved: f.saved, current: f.current, uploading: f.upload !== null },
    }),
  );
}

/** @param {Field} f */
function paint(f) {
  const u = f.upload;
  if (!u) return;
  const pct = pctOf(u);
  const bar = f.body.querySelector("[data-file-progress]");
  if (bar instanceof HTMLElement) {
    bar.style.setProperty("--file-progress", `${pct}%`);
    bar.setAttribute("aria-valuenow", String(pct));
  }
  for (const el of f.body.querySelectorAll("[data-file-pct]")) el.textContent = `${pct}%`;
  for (const el of f.body.querySelectorAll("[data-file-bytes]")) el.textContent = bytesOf(u);
}

/**
 * @param {Field} f
 * @param {string} text
 */
function say(f, text) {
  f.live.textContent = text;
}

/** @param {Field} f */
function abandon(f) {
  f.upload?.handle?.abort();
  f.upload = null;
}

/**
 * @param {Field} f
 * @param {InFlight} u
 * @param {unknown} error
 */
function refused(f, u, error) {
  if (f.upload !== u) return;
  f.upload = null;
  // An upload the page stopped, as it does when the field leaves it, is a Stop, not a failure.
  const stopped = error instanceof DOMException && error.name === "AbortError";
  f.refusal = stopped ? null : error instanceof FileRefusal ? error.sentence : FAILED;
  f.quiet = false;
  if (error instanceof FileRefusal && f.unsent === u.picked) keepUnsent(f, null);
  render(f);
  if (f.refusal) say(f, f.refusal);
}

/**
 * Take a pick into the field. A pick made while another is uploading replaces it, and the
 * one it replaced is aborted (decision 19); the file held before stays until one lands.
 *
 * @param {Field} f
 * @param {Picked} picked
 */
function take(f, picked) {
  const wait = heldBack(f, picked);
  if (wait) {
    f.notice = wait;
    if (f.guidance) Object.assign(f.guidance, { textContent: wait, hidden: false });
    return say(f, wait);
  }
  f.recorder?.dispose();
  if (picked !== f.unsent) {
    keepUnsent(f, null);
    f.notice = null;
  }
  abandon(f);
  f.refusal = null;
  /** @type {InFlight} */
  const u = { picked, loaded: 0, handle: null };
  f.upload = u;
  render(f);
  say(f, `I’m uploading ${picked.name}.`);
  try {
    u.handle = f.transfer(
      picked,
      f.kind,
      (loaded) => {
        if (f.upload !== u) return;
        u.loaded = loaded;
        paint(f);
      },
      f.host,
    );
  } catch (error) {
    refused(f, u, error);
    return;
  }
  u.handle.done.then(
    (held) => {
      if (f.upload !== u) return;
      f.upload = null;
      f.current = held;
      if (f.unsent === picked) keepUnsent(f, null);
      render(f);
      say(f, `${held.name} is in.`);
    },
    (error) => refused(f, u, error),
  );
}

/** @param {File} file */
const fromFile = (file) => ({ name: file.name, type: file.type, size: file.size, file });

/* ── Wiring ───────────────────────────────────────────────────────────────── */

/** @param {Field} f */
function stop(f) {
  const name = f.upload?.picked.name ?? "";
  abandon(f);
  if (f.unsent) settle(f);
  else f.notice = null;
  render(f);
  say(f, `I stopped uploading ${name}.`);
}

/** @param {Field} f */
function clear(f) {
  const name = f.current?.name ?? "";
  const kept = f.current !== null && f.current === f.saved;
  f.current = null;
  f.refusal = null;
  f.notice = null;
  render(f);
  say(f, `I cleared ${name}.${kept ? " Saving makes that final." : ""}`);
}

/** What recording draws and takes with (`file-recording.js`). */
const FIELD_API = {
  render,
  take,
  say,
  cap: (/** @type {Field} */ f) =>
    Number(f.host.getAttribute(FILE_FIELD_HOOKS.cap)) || Number.POSITIVE_INFINITY,
};

/** @type {Array<[string, (f: Field) => void]>} */
const ACTIONS = [
  ["[data-file-pick]", (f) => f.input.click()],
  ["[data-file-record]", (f) => record(f, FIELD_API)],
  ["[data-file-resend]", (f) => resend(f, FIELD_API)],
  ["[data-file-forget]", (f) => forget(f, FIELD_API)],
  ["[data-file-stop]", stop],
  ["[data-file-clear]", clear],
  [
    "[data-file-play]",
    (f) => {
      const kind = f.current && kindOf(f.current, f.kinds) === "video" ? "video" : "audio";
      togglePlayback(f.body, (text) => say(f, text), kind);
    },
  ],
  [
    "[data-file-open]",
    (f) =>
      f.current &&
      f.host.dispatchEvent(
        new CustomEvent(FILE_FIELD_OPEN, {
          bubbles: true,
          detail: { held: f.current, kind: kindOf(f.current, f.kinds), field: f.host },
        }),
      ),
  ],
];

/** @param {DragEvent} event */
const carriesFiles = (event) => Boolean(event.dataTransfer?.types.includes("Files"));

/**
 * @param {Field} f
 * @param {boolean} on
 */
const lit = (f, on) => f.host.classList.toggle("is-dragover", on);

/** @param {Field} f */
function wireDrop(f) {
  const { host } = f;
  host.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    lit(f, true);
  });
  host.addEventListener("dragover", (event) => {
    if (carriesFiles(event)) event.preventDefault();
  });
  host.addEventListener("drop", (event) => {
    event.preventDefault();
    lit(f, false);
    const file = event.dataTransfer?.files[0];
    if (file) take(f, fromFile(file));
  });
  host.addEventListener("paste", (event) => {
    const file = event.clipboardData?.files[0];
    if (!file) return;
    event.preventDefault();
    take(f, fromFile(file));
  });
}

/**
 * @param {HTMLElement} host
 * @returns {Held | null}
 */
function heldOn(host) {
  const name = host.getAttribute(FILE_FIELD_HOOKS.holdsName);
  const url = host.getAttribute(FILE_FIELD_HOOKS.holdsSrc);
  const size = host.getAttribute(FILE_FIELD_HOOKS.holdsSize);
  const duration = host.getAttribute(FILE_FIELD_HOOKS.holdsDuration);
  const type = host.getAttribute(FILE_FIELD_HOOKS.holdsType);
  if (!name) return null;
  return {
    name,
    url: url ?? "",
    size: Number(size ?? 0),
    ...(duration ? { duration: Number(duration) } : {}),
    ...(type ? { type } : {}),
  };
}

/** @param {HTMLElement} host */
function live(host) {
  const el = document.createElement("span");
  el.className = "file__live";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  host.append(el);
  return el;
}

/**
 * The field is a group named by its label, so every action inside it — Replace, Clear,
 * Stop, Play — is heard with the field it belongs to.
 *
 * @param {HTMLElement} host
 * @param {Transfer} transfer
 * @param {FieldOptions} options
 */
function mountOne(host, transfer, options) {
  const body = host.querySelector(hooked(FILE_FIELD_HOOKS.body));
  const kinds = kindsIn(host.getAttribute(FILE_FIELD_HOOKS.kind) ?? "image");
  const [kind] = kinds;
  if (!(body instanceof HTMLElement) || !kind || FIELDS.has(host)) return;
  host.setAttribute("role", "group");
  host.dataset.families = String(kinds.length);
  host.setAttribute("aria-labelledby", `${host.id}-label`);
  const input = document.createElement("input");
  const accept = host.getAttribute(FILE_FIELD_HOOKS.accept) || acceptOf(kinds);
  Object.assign(input, { type: "file", hidden: true, tabIndex: -1, accept });
  host.append(input);
  const guidance = host.querySelector(".field__guidance");
  const saved = heldOn(host);
  /** @type {Field} */
  const f = {
    host,
    body,
    guidance: guidance instanceof HTMLElement ? guidance : null,
    live: live(host),
    input,
    kind,
    kinds,
    guide: guidance?.textContent?.trim() ?? "",
    transfer,
    saved,
    current: saved,
    upload: null,
    refusal: null,
    seeds: new Map(),
    env: options.recorder ?? browserRecorderEnv(),
    recorder: null,
    hold: options.hold,
  };
  FIELDS.set(host, f);
  registerFileControl(host, {
    uploading: () => {
      if (f.upload) return [nounFor(f.kinds)];
      if (f.unsent) return ["unsent recording"];
      return f.recorder?.holds() ? ["recording"] : [];
    },
    settle: (how) => settleOne(f, how),
  });
  host.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const hit = ACTIONS.find(([selector]) => target?.closest(selector));
    if (hit && f.env.now() >= (f.settleUntil ?? 0)) hit[1](f);
  });
  // A held Enter presses once: its repeats would press whatever the first press put there.
  host.addEventListener("keydown", (event) => event.repeat && event.preventDefault(), true);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) take(f, fromFile(file));
    input.value = "";
  });
  wireDrop(f);
  render(f);
}

/* ── The page around the fields ───────────────────────────────────────────── */

/** @param {EventTarget | null} target */
function unlightAllBut(target) {
  for (const el of document.querySelectorAll(".file.is-dragover")) {
    if (!(target instanceof Node && el.contains(target))) el.classList.remove("is-dragover");
  }
}

/**
 * Once per page. A held save is focusable, so a click or Enter on it must still do nothing;
 * one sound plays at a time; and a file dragged anywhere but a field is refused there rather
 * than opened in place of the page. A drag that carries no file — text into an input — is
 * left to the browser.
 */
export function mountPage() {
  if (document.documentElement.dataset.fileFields) return;
  document.documentElement.dataset.fileFields = "mounted";
  document.addEventListener(
    "click",
    (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(`${hooked(FILE_FIELD_HOOKS.save)}[aria-disabled="true"]`)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  document.addEventListener(
    "play",
    (event) => {
      for (const media of document.querySelectorAll("[data-file-media]")) {
        if (media !== event.target && media instanceof HTMLMediaElement) media.pause();
      }
    },
    true,
  );
  window.addEventListener("dragover", (event) => {
    if (!carriesFiles(event)) return;
    unlightAllBut(event.target);
    const fields = `${hooked(FILE_FIELD_HOOKS.field)}, ${hooked(FILE_FIELD_HOOKS.list)}`;
    if (event.target instanceof Element && event.target.closest(fields)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  });
  window.addEventListener("drop", (event) => {
    unlightAllBut(null);
    if (carriesFiles(event)) event.preventDefault();
  });
  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) unlightAllBut(null);
  });
}

/**
 * Mount every `[data-file-field]` under `root`, each streaming its picks through `transfer`. A
 * page that owns what its regions hold passes `hold`, so a recorder's microphone goes off with
 * the form it is in; `recorder` stands in for the browser's media.
 *
 * @param {ParentNode} root
 * @param {Transfer} transfer
 * @param {FieldOptions} [options]
 */
export function mountFileFields(root, transfer, options = {}) {
  for (const host of root.querySelectorAll(hooked(FILE_FIELD_HOOKS.field))) {
    if (host instanceof HTMLElement) mountOne(host, transfer, options);
  }
  mountPage();
}

/**
 * Hand a field a pick from somewhere other than its own picker.
 *
 * @param {HTMLElement} host
 * @param {Picked} picked
 */
export function pickInto(host, picked) {
  const f = FIELDS.get(host);
  if (f) take(f, picked);
}

/**
 * Whether any field under `scope` has a file travelling, which a page asks before it sends a form.
 *
 * @param {Element} scope
 */
export const uploadingIn = (scope) => controlsIn(scope).some((c) => c.uploading().length > 0);

/**
 * What a form's save and cancel do to the file fields in it: a save keeps what each field
 * holds now, and a cancel stops what is travelling and puts back what was saved.
 *
 * @param {Element} scope
 * @param {"keep" | "revert"} how
 */
export function settleFileFields(scope, how) {
  for (const c of controlsIn(scope)) c.settle(how);
}

/**
 * @param {Field} f
 * @param {"keep" | "revert"} how
 */
function settleOne(f, how) {
  f.recorder?.dispose();
  keepUnsent(f, null);
  f.notice = null;
  if (how === "revert") {
    abandon(f);
    f.current = f.saved;
    say(f, "");
  } else f.saved = f.current;
  f.refusal = null;
  render(f);
}
