// @ts-check
/**
 * The field that holds many files (`file[]`): an ordered column of rows, one per file, and a
 * well at its foot that adds more (`styles/components/controls/file-field.css`). A file joins the end of
 * the list in the order it was picked, and the list is never reordered by hand: removing one
 * and adding another is how it changes.
 *
 * Every file travels on its own upload the moment it is picked, through the same `transfer` a
 * single field uses, and the form's save waits while any of them is in flight. Removing a row
 * that is still travelling stops its upload. A pick that would take the list past its count
 * is refused whole, in the guidance's place, before anything travels; a file admission refuses
 * is refused by name, because several may be travelling at once. A list that takes sound records
 * too, beside its add well, and what the recorder keeps joins the list as one more file.
 */

import {
  FILE_FIELD_HOOKS,
  FILE_FIELD_OPEN,
  holdSave,
  mountPage,
  registerFileControl,
  scopeOf,
} from "./file-field.js";
import {
  acceptOf,
  esc,
  FileRefusal,
  G,
  glyph,
  goesTo,
  harvestSeeds,
  KINDS,
  kindOf,
  kindsIn,
  nounFor,
  pctOf,
  pressOnce,
  progressAttrs,
  rowEnds,
  seed,
  square,
  togglePlayback,
  wirePreview,
} from "./file-parts.js";
import {
  forget,
  heldBack,
  keepUnsent,
  settle as pauseClicks,
  record,
  resend,
} from "./file-recording.js";
import { browserRecorderEnv, canRecord } from "./recorder-env.js";
import { recordButton, unsentRow } from "./recorder-parts.js";

/**
 * @typedef {import("./file-parts.js").Kind} Kind
 * @typedef {import("./file-parts.js").Held} Held
 * @typedef {import("./file-parts.js").Picked} Picked
 * @typedef {import("./file-parts.js").InFlight} InFlight
 * @typedef {import("./file-field.js").Transfer} Transfer
 * @typedef {import("./file-field.js").FieldOptions} FieldOptions
 * @typedef {{ id: number, held: Held | null, upload: InFlight | null }} Entry
 * @typedef {{ host: HTMLElement, body: HTMLElement, guidance: HTMLElement | null,
 *             live: HTMLElement, input: HTMLInputElement, kinds: Kind[], cap: number,
 *             guide: string, transfer: Transfer, saved: Entry[], entries: Entry[],
 *             refusals: Array<{ at: number, sentence: string }>, focus: string | null,
 *             seeds: Map<string, number>, wired: AbortController | null,
 *             next: number, waiting?: string | null }
 *           & import("./file-recording.js").Field} List
 */

/**
 * Said by a list after every change of state, bubbling, as a single field says
 * `file-field:change`. `current` is what the list holds now, in order, uploads excluded.
 *
 * @typedef {{ saved: Held[], current: Held[], uploading: boolean }} FileListChange
 */
export const FILE_LIST_CHANGE = "file-list:change";

/** @type {Record<Kind, string>} */
const PLURAL = { image: "photos", video: "videos", audio: "audio files", document: "documents" };

const ADD_GLYPH = '<path d="M12 5v14M5 12h14"/>';

/** @type {WeakMap<HTMLElement, List>} */
const LISTS = new WeakMap();

/**
 * @param {List} l
 * @param {Held} held
 */
const kindHeld = (l, held) => kindOf(held, l.kinds);

/**
 * A pick that would take the list past its count. While there is room it asks for fewer;
 * once the list is full it asks for as many removals as the pick needs.
 *
 * @param {number} count
 * @param {number} cap
 * @param {number} held
 */
export function overCapSentence(count, cap, held) {
  const ask =
    held < cap
      ? "Mind picking fewer?"
      : `Mind removing ${count - cap === 1 ? "one" : "a few"} first?`;
  return `This field takes up to ${cap} ${cap === 1 ? "file" : "files"}, and that would make ${count}. ${ask}`;
}

/**
 * A row's place in the list, which its actions say after the file's name.
 *
 * @param {List} l
 * @param {Entry} e
 */
const placeOf = (l, e) => `, ${l.entries.indexOf(e) + 1} of ${l.entries.length}`;

/** @param {List} l */
const addLabel = (l) =>
  l.kinds.length === 1 ? `Add ${PLURAL[l.kinds[0] ?? "document"]}` : "Add files";

/**
 * @param {List} l
 * @param {Entry} e
 * @param {Held} held
 */
function heldRow(l, e, held) {
  const name = esc(held.name);
  const where = placeOf(l, e);
  const [lead, meta] = rowEnds(held, kindHeld(l, held));
  return `<div class="file__row" data-file-entry="${e.id}">
    <span class="field__control file__well"${seed(l, `well:${e.id}`)}>
      ${lead}
      <span class="file__name">${name}</span>
      ${meta}
    </span>
    <span class="file__actions">
      ${goesTo(l, held, kindHeld(l, held), `data-file-list-open="${e.id}"`, `go:${e.id}`, where)}
      ${square(l, `remove:${e.id}`, `Remove ${name}${where}`, glyph(14, G.clear), `data-file-list-remove="${e.id}"`)}
    </span>
  </div>`;
}

/**
 * @param {List} l
 * @param {Entry} e
 * @param {InFlight} u
 */
const travellingRow = (l, e, u) => `<div class="file__row" data-file-entry="${e.id}">
  <span class="field__control file__well"${progressAttrs(u)}${seed(l, `well:${e.id}`)}>
    <span class="file__glyph">${glyph(18, G.up)}</span>
    <span class="file__name">${esc(u.picked.name)}</span>
    <span class="file__meta" data-file-pct>${pctOf(u)}%</span>
  </span>
  <span class="file__actions">
    ${square(l, `stop:${e.id}`, `Stop uploading ${esc(u.picked.name)}${placeOf(l, e)}`, glyph(12, G.stop, true), `data-file-list-stop="${e.id}"`)}
  </span>
</div>`;

/** @param {List} l */
const addWell = (
  l,
) => `<div class="file__row"><button class="field__control file__well file__pick file__drop" type="button" data-file-list-add ${FILE_FIELD_HOOKS.focus} aria-labelledby="${l.host.id}-label ${l.host.id}-cta" aria-describedby="${l.host.id}-guidance"${seed(l, "add")}>
  <span class="file__glyph">${glyph(18, ADD_GLYPH)}</span>
  <span class="file__cta" id="${l.host.id}-cta">${addLabel(l)}</span>
  <span class="file__meta file__hint">or drop them here, or paste them</span>
</button>${records(l) ? recordButton(l) : ""}</div>`;

/**
 * A list that takes a sound records one too, where the browser can, as a single field does, while
 * a recording could join it: none is on its way already, and the list has room.
 *
 * @param {List} l
 */
const records = (l) =>
  l.kinds.includes("audio") && canRecord(l.env) && !l.unsent && !grows(l, l.entries.length + 1);

/**
 * Whether holding `count` files takes the list past its count. A list a lowered count already
 * passes may still change, so long as it holds no more than it was saved holding, as the server
 * holds it to.
 *
 * @param {List} l
 * @param {number} count
 */
const grows = (l, count) => count > l.cap && count > l.saved.length;

/**
 * A recording whose upload failed or was stopped, waiting on the list to go up again or be thrown
 * away; while it travels, its row is the entry's.
 *
 * @param {List} l
 */
const unsentWaits = (l) =>
  l.unsent != null && !l.entries.some((e) => e.upload?.picked === l.unsent);

/**
 * What stands at the list's foot: the recorder while it records, a recording still unsent, or the
 * add well.
 *
 * @param {List} l
 */
function footOf(l) {
  if (l.recorder) return l.recorder.markup();
  if (l.unsent && unsentWaits(l)) return unsentRow(l, l.unsent.name);
  return addWell(l);
}

/** @param {List} l */
function bodyOf(l) {
  const rows = l.entries.map((e) => {
    if (e.upload) return travellingRow(l, e, e.upload);
    return e.held ? heldRow(l, e, e.held) : "";
  });
  return `<div class="field-list__values">${rows.join("")}${footOf(l)}</div>`;
}

/** @param {List} l */
const holding = (l) => l.entries.flatMap((e) => (e.held ? [e.held] : []));

/** @param {List} l */
const travelling = (l) => l.entries.filter((e) => e.upload !== null);

/**
 * Where the keyboard goes when the control it was on is redrawn away: a Stop whose file
 * landed hands over to that row's Remove, a removed row to its neighbour, and anything else
 * to what stands at the foot, the add well, the recorder or a recording still unsent.
 *
 * @param {List} l
 * @param {string} role
 */
function successor(l, role) {
  const roles = [role, role.replace(/^stop:/, "remove:"), l.focus ?? ""];
  for (const r of roles) {
    const el = r && l.body.querySelector(`[data-ink-role="${r}"]`);
    if (el instanceof HTMLElement) return el;
  }
  return l.body.querySelector(`[${FILE_FIELD_HOOKS.focus}]`);
}

/**
 * The refusals take the guidance's place, and the add well turns only while the list is empty.
 *
 * @param {List} l
 */
function showRefusals(l) {
  const said = refused(l);
  l.host.classList.toggle("is-refused", said !== "");
  l.host.classList.toggle("is-invalid", said !== "" && !l.quiet && l.entries.length === 0);
  if (!l.guidance) return;
  l.guidance.textContent = said || l.waiting || l.notice || l.guide;
  l.guidance.hidden = l.guidance.textContent === "";
  l.guidance.classList.toggle("field__guidance--error", said !== "");
}

/**
 * Every refusal from one picking, in the order its files were picked.
 *
 * @param {List} l
 */
const refused = (l) =>
  [
    ...[...l.refusals].sort((a, b) => a.at - b.at).map((r) => r.sentence),
    ...(l.refusal ? [l.refusal] : []),
  ].join(" ");

/**
 * The rows are redrawn whole, so a sound that is playing is carried into its new row rather
 * than stopped and rewound; moved within one task, a media element keeps playing.
 *
 * @param {List} l
 * @param {Map<string, Element>} playing
 */
function wireRows(l, playing) {
  l.wired?.abort();
  l.wired = new AbortController();
  for (const e of l.entries) {
    const row = l.body.querySelector(`[data-file-entry="${e.id}"]`);
    if (!row || !e.held) continue;
    const kept = playing.get(String(e.id));
    if (kept) row.querySelector("[data-file-media]")?.replaceWith(kept);
    const heard = (/** @type {string} */ text) => say(l, text);
    wirePreview(row, e.held, kindHeld(l, e.held), heard, l.wired.signal, e.held.name);
  }
  l.recorder?.wire(l.body, l.wired.signal);
}

/**
 * The hands of rows no longer drawn are let go, so a long session doesn't keep them.
 *
 * @param {List} l
 */
function pruneSeeds(l) {
  for (const role of l.seeds.keys()) {
    if (!l.body.querySelector(`[data-ink-role="${role}"]`)) l.seeds.delete(role);
  }
}

/**
 * The sounds a redraw must not stop or rewind: playing, or paused partway.
 *
 * @param {List} l
 */
function underway(l) {
  /** @type {Map<string, Element>} */
  const kept = new Map();
  for (const media of l.body.querySelectorAll("[data-file-media]")) {
    const id = media.closest("[data-file-entry]")?.getAttribute("data-file-entry");
    if (!(id && media instanceof HTMLMediaElement)) continue;
    if (!media.paused || (media.currentTime > 0 && !media.ended)) kept.set(id, media);
  }
  return kept;
}

/**
 * Put the keyboard back where it was, once the rows it was on are redrawn: where a change asked
 * for it, on the same row's Play, or on the control that took the place of the one it was on.
 *
 * @param {List} l
 * @param {string} role
 * @param {string | undefined} played the entry whose Play had it
 */
function refocus(l, role, played) {
  const asked = l.focus?.startsWith("[") ? l.body.querySelector(l.focus) : null;
  const toggle = played && l.body.querySelector(`[data-file-entry="${played}"] [data-file-play]`);
  const next = asked || toggle || successor(l, role);
  if (next instanceof HTMLElement) next.focus({ focusVisible: true });
}

/** @param {List} l */
function render(l) {
  const active = document.activeElement;
  const hadFocus = l.body.contains(active);
  const role = hadFocus ? (active?.getAttribute("data-ink-role") ?? "") : "";
  const played = hadFocus && active?.matches("[data-file-play]") ? entryOf(active) : undefined;
  if (!unsentWaits(l) && !l.recorder?.losesAudio()) l.waiting = null;
  harvestSeeds(l);
  const playing = underway(l);
  l.body.innerHTML = bodyOf(l);
  pruneSeeds(l);
  showRefusals(l);
  wireRows(l, playing);
  holdSave(scopeOf(l.host));
  if (hadFocus) refocus(l, role, played);
  l.focus = null;
  l.host.dispatchEvent(
    new CustomEvent(FILE_LIST_CHANGE, {
      bubbles: true,
      detail: {
        saved: l.saved.flatMap((e) => (e.held ? [e.held] : [])),
        current: holding(l),
        uploading: travelling(l).length > 0,
      },
    }),
  );
}

/**
 * @param {List} l
 * @param {Entry} e
 */
function paint(l, e) {
  const row = l.body.querySelector(`[data-file-entry="${e.id}"]`);
  if (!row || !e.upload) return;
  const pct = pctOf(e.upload);
  const bar = row.querySelector("[data-file-progress]");
  if (bar instanceof HTMLElement) {
    bar.style.setProperty("--file-progress", `${pct}%`);
    bar.setAttribute("aria-valuenow", String(pct));
  }
  for (const el of row.querySelectorAll("[data-file-pct]")) el.textContent = `${pct}%`;
}

/**
 * @param {List} l
 * @param {string} text
 */
const say = (l, text) => {
  l.live.textContent = text;
};

/**
 * A refused file leaves the list and says why by name, beside any other refusal from the
 * same picking, so no file disappears without a sentence.
 *
 * @param {List} l
 * @param {Entry} e
 * @param {unknown} error
 */
function failed(l, e, error) {
  if (!l.entries.includes(e)) return;
  const name = e.upload?.picked.name ?? "";
  l.entries = l.entries.filter((x) => x !== e);
  const stopped = error instanceof DOMException && error.name === "AbortError";
  const sentence =
    error instanceof FileRefusal
      ? error.sentence
      : `I couldn’t take ${name} just now. Mind trying again?`;
  // A recording its upload refuses is not one to send again; one that failed or stopped waits.
  if (error instanceof FileRefusal && l.unsent && l.unsent === e.upload?.picked) {
    keepUnsent(l, null);
  }
  if (stopped) return render(l);
  l.quiet = false;
  l.refusals.push({ at: e.id, sentence });
  render(l);
  say(l, refused(l));
}

/**
 * Whether the file set off; a transfer that refuses it on the spot has already said so.
 *
 * @param {List} l
 * @param {Picked} picked
 */
function start(l, picked) {
  /** @type {Entry} */
  const e = { id: l.next++, held: null, upload: { picked, loaded: 0, handle: null } };
  const u = e.upload;
  if (!u) return false;
  l.entries.push(e);
  try {
    u.handle = l.transfer(
      picked,
      l.kinds[0] ?? "document",
      (loaded) => {
        if (e.upload !== u) return;
        u.loaded = loaded;
        paint(l, e);
      },
      l.host,
    );
  } catch (error) {
    failed(l, e, error);
    return false;
  }
  u.handle.done.then(
    (held) => {
      if (e.upload !== u || !l.entries.includes(e)) return;
      e.upload = null;
      e.held = held;
      if (l.unsent === picked) keepUnsent(l, null);
      l.waiting = null;
      render(l);
      say(l, `${held.name} is in.`);
    },
    (error) => failed(l, e, error),
  );
  return true;
}

/**
 * Take a pick of one or more files onto the end of the list, or refuse the whole pick when it
 * would pass the list's count, answering whether any set off.
 *
 * @param {List} l
 * @param {Picked[]} picks
 */
function take(l, picks) {
  const wait = waitFor(l, picks);
  if (picks.length === 0 || wait) {
    if (wait) refuseWith(l, () => (l.waiting = wait), wait);
    return false;
  }
  l.refusal = null;
  l.waiting = null;
  // The recorder's own note on how its recording ended stays with the recording it describes.
  if (!(picks.length === 1 && picks[0] === l.unsent)) l.notice = null;
  const count = l.entries.length + picks.length;
  if (grows(l, count)) {
    const sentence = overCapSentence(count, l.cap, l.entries.length);
    l.quiet = false;
    refuseWith(l, () => (l.refusals = [{ at: -1, sentence }]), sentence);
    return false;
  }
  l.refusals = [];
  const started = picks.filter((picked) => start(l, picked));
  render(l);
  const [only] = started;
  const going = only
    ? started.length > 1
      ? `I’m uploading ${started.length} files.`
      : `I’m uploading ${only.name}.`
    : "";
  say(l, [going, refused(l)].filter(Boolean).join(" "));
  return started.length > 0;
}

/**
 * Why `picks` must wait, if they must: a recording still being made, or one waiting unsent. A
 * recording travelling on its way into the list holds nothing back.
 *
 * @param {List} l
 * @param {Picked[]} picks
 */
function waitFor(l, picks) {
  if (!(l.recorder?.losesAudio() || unsentWaits(l))) return null;
  return picks.map((picked) => heldBack(l, picked)).find(Boolean) ?? null;
}

/**
 * A pick the list will not take: what `note` sets is drawn, and `sentence` said.
 *
 * @param {List} l
 * @param {() => unknown} note
 * @param {string} sentence
 */
function refuseWith(l, note, sentence) {
  note();
  render(l);
  say(l, sentence);
}

/**
 * @param {List} l
 * @param {string | undefined} id
 * @param {"remove" | "stop"} how
 */
function drop(l, id, how) {
  const e = l.entries.find((x) => String(x.id) === id);
  if (!e) return;
  const name = e.held?.name ?? e.upload?.picked.name ?? "";
  const kept = l.saved.includes(e);
  // The rows close up under the pointer, so a double click's second press waits out the redraw.
  pauseClicks(l);
  e.upload?.handle?.abort();
  const at = l.entries.indexOf(e);
  l.entries = l.entries.filter((x) => x !== e);
  const neighbour = l.entries[at] ?? l.entries[at - 1];
  if (neighbour) l.focus = `${neighbour.upload ? "stop" : "remove"}:${neighbour.id}`;
  for (const role of ["well", "remove", "stop", "go"]) l.seeds.delete(`${role}:${e.id}`);
  l.refusals = [];
  render(l);
  say(l, droppedSentence(name, how, kept));
}

/**
 * @param {string} name
 * @param {"remove" | "stop"} how
 * @param {boolean} kept whether the list was saved holding the file
 */
const droppedSentence = (name, how, kept) =>
  how === "stop"
    ? `I stopped uploading ${name}.`
    : `I removed ${name}.${kept ? " Saving makes that final." : ""}`;

/**
 * `entry` names the row the file was opened from, so a way back can land on it.
 *
 * @param {List} l
 * @param {string | undefined} id
 */
function open(l, id) {
  const held = l.entries.find((x) => String(x.id) === id)?.held;
  if (!held) return;
  l.host.dispatchEvent(
    new CustomEvent(FILE_FIELD_OPEN, {
      bubbles: true,
      detail: { held, kind: kindHeld(l, held), field: l.host, entry: id },
    }),
  );
}

/**
 * @param {List} l
 * @param {"keep" | "revert"} how
 */
function settle(l, how) {
  l.recorder?.dispose();
  keepUnsent(l, null);
  l.notice = null;
  l.waiting = null;
  l.refusal = null;
  if (how === "revert") {
    for (const e of travelling(l)) e.upload?.handle?.abort();
    l.entries = [...l.saved];
    say(l, "");
  } else l.saved = l.entries.filter((e) => e.held !== null);
  l.refusals = [];
  render(l);
}

/** @param {File} file */
const fromFile = (file) => ({ name: file.name, type: file.type, size: file.size, file });

/** @param {FileList | null | undefined} files */
const picksOf = (files) => [...(files ?? [])].map(fromFile);

/** @param {Element} el */
const entryOf = (el) =>
  el.closest("[data-file-entry]")?.getAttribute("data-file-entry") ?? undefined;

/** What recording draws and takes with (`file-recording.js`): a kept recording is one more pick. */
const LIST_API = {
  render: (/** @type {List} */ l) => render(l),
  take: (/** @type {List} */ l, /** @type {Picked} */ picked) => take(l, [picked]),
  say: (/** @type {List} */ l, /** @type {string} */ text) => say(l, text),
  cap: (/** @type {List} */ l) =>
    Number(l.host.getAttribute(FILE_FIELD_HOOKS.cap)) || Number.POSITIVE_INFINITY,
};

/** @type {Array<[string, (l: List, hit: Element) => void]>} */
const ACTIONS = [
  ["[data-file-list-add]", (l) => l.input.click()],
  ["[data-file-record]", (l) => record(l, LIST_API)],
  ["[data-file-resend]", (l) => resend(l, LIST_API)],
  ["[data-file-forget]", (l) => forget(l, LIST_API)],
  ["[data-file-list-remove]", (l, hit) => drop(l, entryOf(hit), "remove")],
  ["[data-file-list-stop]", (l, hit) => drop(l, entryOf(hit), "stop")],
  ["[data-file-list-open]", (l, hit) => open(l, entryOf(hit))],
  [
    "[data-file-play]",
    (l, hit) => {
      const row = hit.closest("[data-file-entry]");
      const name = l.entries.find((e) => String(e.id) === entryOf(hit))?.held?.name;
      if (row) togglePlayback(row, (text) => say(l, text), "audio", name);
    },
  ],
];

/** @param {List} l */
function wire(l) {
  const { host } = l;
  host.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (l.env.now() < (l.settleUntil ?? 0)) return;
    for (const [selector, run] of ACTIONS) {
      const hit = target?.closest(selector);
      if (hit) return run(l, hit);
    }
  });
  host.addEventListener("keydown", pressOnce, true);
  l.input.addEventListener("change", () => {
    take(l, picksOf(l.input.files));
    l.input.value = "";
  });
  const carries = (/** @type {DragEvent} */ event) =>
    Boolean(event.dataTransfer?.types.includes("Files"));
  host.addEventListener("dragenter", (event) => {
    if (!carries(event)) return;
    event.preventDefault();
    host.classList.add("is-dragover");
  });
  host.addEventListener("dragover", (event) => {
    if (carries(event)) event.preventDefault();
  });
  host.addEventListener("drop", (event) => {
    event.preventDefault();
    host.classList.remove("is-dragover");
    take(l, picksOf(event.dataTransfer?.files));
  });
  host.addEventListener("paste", (event) => {
    const picks = picksOf(event.clipboardData?.files);
    if (picks.length === 0) return;
    event.preventDefault();
    take(l, picks);
  });
}

/**
 * One file as the server wrote it, or null when it isn't one: a name, a size, an address,
 * and a known kind, type and length when it says them.
 *
 * @param {unknown} raw
 * @returns {Held | null}
 */
function heldFrom(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const { name, size, url, kind, type, duration } = /** @type {Record<string, unknown>} */ (raw);
  const whole = typeof name === "string" && name !== "" && typeof url === "string";
  if (!whole || typeof size !== "number" || !(size >= 0)) return null;
  /** @type {Held} */
  const held = { name, size, url };
  if (typeof kind === "string" && kind in KINDS) held.kind = /** @type {Kind} */ (kind);
  if (typeof type === "string") held.type = type;
  if (typeof duration === "number" && duration > 0) held.duration = duration;
  return held;
}

/**
 * What the list held when it was drawn, as the server writes it: a JSON array of files.
 *
 * @param {HTMLElement} host
 * @returns {Held[]}
 */
function heldOn(host) {
  try {
    const parsed = JSON.parse(host.getAttribute(FILE_FIELD_HOOKS.holds) ?? "[]");
    return Array.isArray(parsed) ? parsed.flatMap((raw) => heldFrom(raw) ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * @param {HTMLElement} host
 * @param {Transfer} transfer
 * @param {FieldOptions} options
 */
function mountOne(host, transfer, options) {
  const body = host.querySelector(`[${FILE_FIELD_HOOKS.body}]`);
  if (!(body instanceof HTMLElement) || LISTS.has(host)) return;
  const kinds = kindsIn(host.getAttribute(FILE_FIELD_HOOKS.kind) ?? "");
  host.setAttribute("role", "group");
  host.setAttribute("aria-labelledby", `${host.id}-label`);
  const input = document.createElement("input");
  Object.assign(input, { type: "file", hidden: true, tabIndex: -1, multiple: true });
  input.accept = host.getAttribute(FILE_FIELD_HOOKS.accept) || acceptOf(kinds);
  host.append(input);
  const live = document.createElement("span");
  live.className = "file__live";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  host.append(live);
  const guidance = host.querySelector(".field__guidance");
  /** @type {List} */
  const l = {
    host,
    body,
    guidance: guidance instanceof HTMLElement ? guidance : null,
    live,
    input,
    kinds: kinds.length > 0 ? kinds : ["document"],
    cap: Number(host.getAttribute(FILE_FIELD_HOOKS.count)) || Number.POSITIVE_INFINITY,
    guide: guidance?.textContent?.trim() ?? "",
    transfer,
    saved: [],
    entries: [],
    refusals: [],
    focus: null,
    wired: null,
    seeds: new Map(),
    next: 0,
    env: options.recorder ?? browserRecorderEnv(),
    recorder: null,
    hold: options.hold,
    refusal: null,
  };
  l.saved = heldOn(host).map((held) => ({ id: l.next++, held, upload: null }));
  l.entries = [...l.saved];
  LISTS.set(host, l);
  registerFileControl(host, {
    uploading: () => {
      const going = travelling(l).map(() => nounFor(l.kinds));
      if (unsentWaits(l)) going.push("unsent recording");
      return l.recorder?.holds() ? [...going, "recording"] : going;
    },
    settle: (how) => settle(l, how),
  });
  wire(l);
  render(l);
}

/**
 * Mount every `[data-file-list]` under `root`, each streaming its picks through `transfer`, with
 * the options a single field takes: `hold` for a page that owns what its regions hold, and
 * `recorder` standing in for the browser's media.
 *
 * @param {ParentNode} root
 * @param {Transfer} transfer
 * @param {FieldOptions} [options]
 */
export function mountFileLists(root, transfer, options = {}) {
  for (const host of root.querySelectorAll(`[${FILE_FIELD_HOOKS.list}]`)) {
    if (host instanceof HTMLElement) mountOne(host, transfer, options);
  }
  mountPage();
}

/**
 * Hand a list a pick from somewhere other than its own picker.
 *
 * @param {HTMLElement} host
 * @param {Picked[]} picks
 */
export function pickIntoList(host, picks) {
  const l = LISTS.get(host);
  if (l) take(l, picks);
}
