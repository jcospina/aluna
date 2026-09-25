// @ts-check
/**
 * The file field: one control for a field that holds a file, in the shape its kind asks
 * for (`styles/components/file-field.css`). A photo or a video fills a frame that is its
 * own preview; a document or a sound is a row a text field's height.
 *
 * The control owns its states and nothing about the bytes. A page hands it a `transfer`
 * that streams a pick and settles with the file as it is served, or refuses it with a
 * sentence; admission is the platform's, so every pick goes to the transfer and every
 * refusal is said in the field. On the design pages the transfer is a timer
 * (`file-bench.js`); in the product it is the upload route. The preview is always what the
 * transfer settled with, never the picked file, because the served copy is the one the
 * record will keep.
 */

/**
 * @typedef {"image" | "video" | "audio" | "document"} Kind
 * @typedef {{ name: string, type: string, size: number, file?: File, url?: string,
 *             duration?: number }} Picked
 * @typedef {{ name: string, size: number, url: string, duration?: number }} Held
 * @typedef {{ done: Promise<Held>, abort: () => void }} Upload
 * @typedef {(picked: Picked, kind: Kind, onProgress: (loaded: number) => void,
 *             host: HTMLElement) => Upload} Transfer
 * @typedef {{ picked: Picked, loaded: number, handle: Upload | null }} InFlight
 * @typedef {{ host: HTMLElement, body: HTMLElement, guidance: HTMLElement | null,
 *             live: HTMLElement, input: HTMLInputElement, kind: Kind, guide: string,
 *             transfer: Transfer, saved: Held | null, current: Held | null,
 *             upload: InFlight | null, refusal: string | null,
 *             seeds: Map<string, number> }} Field
 */

/**
 * The attributes a page draws a field and its form's save with: every name the control finds its
 * markup by, so a server drawing that markup writes the same ones.
 */
export const FILE_FIELD_HOOKS = Object.freeze({
  field: "data-file-field",
  body: "data-file-body",
  kind: "data-kind",
  accept: "data-file-accept",
  holdsName: "data-holds-name",
  holdsSize: "data-holds-size",
  holdsSrc: "data-holds-src",
  holdsDuration: "data-holds-duration",
  focus: "data-file-focus",
  save: "data-held-save",
  saveLabel: "data-held-save-label",
});

/** @param {string} name */
const hooked = (name) => `[${name}]`;

/** A pick the platform would not take, and the sentence it says so with. */
export class FileRefusal extends Error {
  /**
   * @param {string} code
   * @param {string} sentence
   */
  constructor(code, sentence) {
    super(sentence);
    this.code = code;
    this.sentence = sentence;
  }
}

/** What the field says when a transfer fails without a sentence of its own. */
const FAILED = "I couldn’t take that one just now. Mind trying again?";

const G = {
  image:
    '<rect x="3.5" y="5" width="17" height="14"/><path d="M3.5 16l4.5-4.5 4 4 3-3 5.5 5.5"/><circle cx="15.5" cy="9.5" r="1.5"/>',
  video: '<rect x="3" y="6" width="13" height="12"/><path d="M16 10.5l5-3v9l-5-3"/>',
  audio:
    '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  up: '<path d="M12 16V5M7 10l5-5 5 5M5 19h14"/>',
  replace:
    '<path d="M4.5 10a7.5 7.5 0 0 1 13.4-3.6M19.5 14a7.5 7.5 0 0 1-13.4 3.6"/><path d="M18.5 3v4h-4M5.5 21v-4h4"/>',
  clear: '<path d="M6 6l12 12M18 6L6 18"/>',
  stop: '<rect x="7" y="7" width="10" height="10"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
};

/**
 * What a kind decides: its shape, the word for it, and what its picker offers unless its host
 * names the types itself, as a server that admits files does. The picker's list is a courtesy —
 * admission is the platform's, and it refuses in the field.
 *
 * @type {Record<Kind, { shape: "frame" | "row", noun: string, choose: string, accept: string }>}
 */
const KINDS = {
  image: {
    shape: "frame",
    noun: "photo",
    choose: "Choose a photo",
    accept: "image/jpeg,image/png,image/gif,image/webp,image/avif",
  },
  video: {
    shape: "frame",
    noun: "video",
    choose: "Choose a video",
    accept: "video/mp4,video/webm,video/ogg,video/quicktime",
  },
  audio: {
    shape: "row",
    noun: "audio",
    choose: "Choose an audio file",
    accept: "audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,audio/webm,audio/flac",
  },
  document: {
    shape: "row",
    noun: "document",
    choose: "Choose a document",
    accept: ".pdf,.doc,.docx,.md,.txt",
  },
};

const MB = 1024 * 1024;
const HINT = "or drop one here, or paste it";

/** @type {Record<string, string>} */
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {string} text */
const esc = (text) => text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/** @param {number} n */
function sizeOf(n) {
  if (n < MB) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / MB).toFixed(n >= 100 * MB ? 0 : 1)} MB`;
}

/** @param {InFlight} u */
function bytesOf(u) {
  const { size } = u.picked;
  if (size < MB) return `${Math.round(u.loaded / 1024)} of ${Math.round(size / 1024)} KB`;
  return `${(u.loaded / MB).toFixed(1)} of ${(size / MB).toFixed(1)} MB`;
}

/** @param {InFlight} u */
const pctOf = (u) => (u.picked.size > 0 ? Math.floor((u.loaded / u.picked.size) * 100) : 0);

/** @param {number} seconds */
function clock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The length while a player rests at the start, and where it has got to once it moves.
 *
 * @param {number | undefined} duration
 * @param {number | null} at
 */
function timeText(duration, at) {
  const length = duration && Number.isFinite(duration) ? clock(duration) : "";
  if (at === null) return length;
  return length ? `${clock(at)} / ${length}` : clock(at);
}

/**
 * @param {number} size
 * @param {string} body
 * @param {boolean} [fill]
 */
function glyph(size, body, fill = false) {
  const paint = fill
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="2.25"';
  return `<svg class="file__icon" viewBox="0 0 24 24" width="${size}" height="${size}" ${paint} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/**
 * The hand a drawn element keeps from one state to the next. A re-render replaces the
 * element, so its seed is carried by role: first from the field's id, then from whatever
 * the ink last gave it, so a page that re-inks keeps the new hand across renders.
 *
 * @param {Field} f
 * @param {string} role
 */
function seed(f, role) {
  let h = f.seeds.get(role);
  if (h === undefined) {
    h = 7;
    for (const c of `${f.host.id}:${role}`) h = (h * 31 + c.charCodeAt(0)) % 99_991;
    f.seeds.set(role, h);
  }
  return ` data-ink-seed="${h}" data-ink-role="${role}"`;
}

/** @param {Field} f */
function harvestSeeds(f) {
  for (const el of f.body.querySelectorAll("[data-ink-role]")) {
    if (el instanceof HTMLElement && el.dataset.inkRole && el.dataset.inkSeed) {
      f.seeds.set(el.dataset.inkRole, Number(el.dataset.inkSeed));
    }
  }
}

/* ── Markup, one function per shape and state ─────────────────────────────── */

/** @param {Field} f */
const pickAttrs = (f) =>
  ` type="button" data-file-pick ${FILE_FIELD_HOOKS.focus} aria-labelledby="${f.host.id}-label ${f.host.id}-cta" aria-describedby="${f.host.id}-guidance"`;

/** @param {InFlight} u */
const progressAttrs = (u) =>
  ` role="progressbar" aria-label="Uploading ${esc(u.picked.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctOf(u)}" style="--file-progress: ${pctOf(u)}%" data-file-progress`;

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
  <span class="file__glyph">${glyph(28, G[f.kind])}</span>
  <span class="file__cta" id="${f.host.id}-cta">${KINDS[f.kind].choose}</span>
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
 * @param {"frame" | "row"} shape
 */
function playButton(f, held, shape) {
  const mark = `<span data-file-play-glyph>${glyph(12, G.play, true)}</span>`;
  if (shape === "row") {
    return `<button class="file__toggle" type="button" data-file-play aria-pressed="false" aria-label="Play ${esc(held.name)}">${mark}</button>`;
  }
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
  const backdrop = `<span class="file__backdrop file__glyph">${glyph(32, G[f.kind])}</span>`;
  if (!held.url) return `<span class="file__frame">${backdrop}</span>`;
  if (f.kind !== "video")
    return `<span class="file__frame"><img src="${esc(held.url)}" alt=""></span>`;
  return `<span class="file__frame">${backdrop}<video src="${esc(held.url)}" preload="metadata" playsinline data-file-media></video></span>
    ${playButton(f, held, "frame")}`;
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
  ${barButton(f, "replace", "Replace", `Replace ${esc(held.name)}`, `data-file-pick ${FILE_FIELD_HOOKS.focus}`)}
  ${barButton(f, "clear", "Clear", `Clear ${esc(held.name)}`, "data-file-clear")}
</div>`;

/**
 * @param {Field} f
 * @param {string} role
 * @param {string} label
 * @param {string} body
 * @param {string} attrs
 */
const square = (f, role, label, body, attrs) =>
  `<button class="btn btn--outline file__action" type="button" ${attrs} aria-label="${label}" aria-describedby="${f.host.id}-guidance"${seed(f, role)}>${body}</button>`;

/** @param {Field} f */
const emptyRow = (f) => `<div class="file__row">
  <button class="field__control file__well file__pick file__drop"${pickAttrs(f)}${seed(f, "well")}>
    <span class="file__glyph">${glyph(18, G[f.kind])}</span>
    <span class="file__cta" id="${f.host.id}-cta">${KINDS[f.kind].choose}</span>
    <span class="file__meta file__hint">${HINT}</span>
  </button>
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
 * A document shows its glyph and its kind and size; a sound, its toggle and its time.
 *
 * @param {Field} f
 * @param {Held} held
 */
function rowEnds(f, held) {
  if (f.kind !== "audio") {
    const kind = (held.name.split(".").pop() ?? "").toUpperCase();
    return [
      `<span class="file__glyph">${glyph(18, G.document)}</span>`,
      `<span class="file__meta">${esc(kind)} · ${sizeOf(held.size)}</span>`,
    ];
  }
  const media = held.url
    ? `<audio src="${esc(held.url)}" preload="metadata" data-file-media></audio>`
    : "";
  return [
    held.url
      ? playButton(f, held, "row")
      : `<span class="file__glyph">${glyph(18, G.audio)}</span>`,
    `<span class="file__meta" data-file-time>${timeText(held.duration, null)}</span>${media}`,
  ];
}

/**
 * @param {Field} f
 * @param {Held} held
 */
function filledRow(f, held) {
  const [lead, meta] = rowEnds(f, held);
  const name = esc(held.name);
  return `<div class="file__row">
    <span class="field__control file__well file__drop"${seed(f, "well")}>
      ${lead}
      <span class="file__name">${name}</span>
      ${meta}
    </span>
    <span class="file__actions">
      ${square(f, "replace", `Replace ${name}`, glyph(14, G.replace), `data-file-pick ${FILE_FIELD_HOOKS.focus}`)}
      ${square(f, "clear", `Clear ${name}`, glyph(14, G.clear), "data-file-clear")}
    </span>
  </div>`;
}

/** @param {Field} f */
function bodyOf(f) {
  const frame = KINDS[f.kind].shape === "frame";
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

/** @type {WeakMap<HTMLElement, Field>} */
const FIELDS = new WeakMap();

/** @param {Field} f */
const scopeOf = (f) => f.host.closest("form, .form") ?? f.host.parentElement ?? document.body;

/** @param {Element} scope */
const fieldsIn = (scope) =>
  [...scope.querySelectorAll(hooked(FILE_FIELD_HOOKS.field))].flatMap((el) => {
    const f = el instanceof HTMLElement ? FIELDS.get(el) : undefined;
    return f ? [f] : [];
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
function holdSave(scope) {
  const waiting = fieldsIn(scope).filter((f) => f.upload);
  const [only] = waiting;
  let label = null;
  if (only)
    label =
      waiting.length > 1
        ? "I’m waiting on the files…"
        : `I’m waiting on the ${KINDS[only.kind].noun}…`;
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
  f.host.classList.toggle("is-invalid", f.refusal !== null && !f.current && !f.upload);
  if (f.guidance) {
    f.guidance.textContent = f.refusal ?? f.guide;
    f.guidance.hidden = (f.refusal ?? f.guide) === "";
    f.guidance.classList.toggle("field__guidance--error", f.refusal !== null);
  }
  wireMedia(f);
  holdSave(scopeOf(f));
  const next = f.body.querySelector(hooked(FILE_FIELD_HOOKS.focus));
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
      render(f);
      say(f, `${held.name} is in.`);
    },
    (error) => refused(f, u, error),
  );
}

/** @param {File} file */
const fromFile = (file) => ({ name: file.name, type: file.type, size: file.size, file });

/* ── Playback: one control, play and pause, and the time ──────────────────── */

/**
 * The toggle reports the media element's own state, so a sound that ends, or is paused
 * because another started, still reads true.
 *
 * @param {Field} f
 * @param {HTMLMediaElement} media
 */
function showTime(f, media) {
  const held = f.current;
  if (!held) return;
  f.body.querySelector("[data-file-play]")?.setAttribute("aria-pressed", String(!media.paused));
  const mark = f.body.querySelector("[data-file-play-glyph]");
  if (mark) mark.innerHTML = glyph(12, media.paused ? G.play : G.pause, true);
  const time = f.body.querySelector("[data-file-time]");
  const resting = media.ended || (media.paused && media.currentTime < 0.5);
  if (time)
    time.textContent = timeText(
      held.duration ?? media.duration,
      resting ? null : media.currentTime,
    );
}

/** @param {Field} f */
function wireMedia(f) {
  const media = f.body.querySelector("[data-file-media]");
  if (!(media instanceof HTMLMediaElement)) return;
  for (const type of ["play", "pause", "timeupdate", "loadedmetadata", "ended"]) {
    media.addEventListener(type, () => showTime(f, media));
  }
}

/**
 * A play the browser gives up because something else paused or removed the player is not a
 * failure; only a real refusal to play is said.
 *
 * @param {Field} f
 */
function toggle(f) {
  const media = f.body.querySelector("[data-file-media]");
  if (!(media instanceof HTMLMediaElement)) return;
  if (!media.paused) return media.pause();
  media.play().catch((error) => {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      say(f, "I couldn’t play that one here.");
  });
}

/* ── Wiring ───────────────────────────────────────────────────────────────── */

/** @param {Field} f */
function stop(f) {
  const name = f.upload?.picked.name ?? "";
  abandon(f);
  render(f);
  say(f, `I stopped uploading ${name}.`);
}

/** @param {Field} f */
function clear(f) {
  const name = f.current?.name ?? "";
  f.current = null;
  f.refusal = null;
  render(f);
  say(f, `I cleared ${name}. Saving makes that final.`);
}

/** @type {Array<[string, (f: Field) => void]>} */
const ACTIONS = [
  ["[data-file-pick]", (f) => f.input.click()],
  ["[data-file-stop]", stop],
  ["[data-file-clear]", clear],
  ["[data-file-play]", toggle],
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
  if (!name) return null;
  return {
    name,
    url: url ?? "",
    size: Number(size ?? 0),
    ...(duration ? { duration: Number(duration) } : {}),
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
 */
function mountOne(host, transfer) {
  const body = host.querySelector(hooked(FILE_FIELD_HOOKS.body));
  const kind = /** @type {Kind} */ (host.getAttribute(FILE_FIELD_HOOKS.kind) ?? "image");
  if (!(body instanceof HTMLElement) || !(kind in KINDS) || FIELDS.has(host)) return;
  host.setAttribute("role", "group");
  host.setAttribute("aria-labelledby", `${host.id}-label`);
  const input = document.createElement("input");
  const accept = host.getAttribute(FILE_FIELD_HOOKS.accept) || KINDS[kind].accept;
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
    guide: guidance?.textContent?.trim() ?? "",
    transfer,
    saved,
    current: saved,
    upload: null,
    refusal: null,
    seeds: new Map(),
  };
  FIELDS.set(host, f);
  host.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const hit = ACTIONS.find(([selector]) => target?.closest(selector));
    hit?.[1](f);
  });
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
function mountPage() {
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
    if (event.target instanceof Element && event.target.closest(hooked(FILE_FIELD_HOOKS.field)))
      return;
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
 * Mount every `[data-file-field]` under `root`, each streaming its picks through `transfer`.
 *
 * @param {ParentNode} root
 * @param {Transfer} transfer
 */
export function mountFileFields(root, transfer) {
  for (const host of root.querySelectorAll(hooked(FILE_FIELD_HOOKS.field))) {
    if (host instanceof HTMLElement) mountOne(host, transfer);
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
export const uploadingIn = (scope) => fieldsIn(scope).some((f) => f.upload !== null);

/**
 * What a form's save and cancel do to the file fields in it: a save keeps what each field
 * holds now, and a cancel stops what is travelling and puts back what was saved.
 *
 * @param {Element} scope
 * @param {"keep" | "revert"} how
 */
export function settleFileFields(scope, how) {
  for (const f of fieldsIn(scope)) {
    if (how === "revert") {
      abandon(f);
      f.current = f.saved;
      say(f, "");
    } else f.saved = f.current;
    f.refusal = null;
    render(f);
  }
}
