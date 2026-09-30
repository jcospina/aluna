// @ts-check
/**
 * What every file control draws with: the kinds and their words, the glyphs, the sizes and
 * times as a person reads them, and the pieces of markup a single field and a list of files
 * both draw. A leaf, so the controls and the record's player can share it without importing
 * one another.
 */

/**
 * @typedef {"image" | "video" | "audio" | "document"} Kind
 * @typedef {{ name: string, type: string, size: number, file?: File, url?: string,
 *             duration?: number }} Picked
 * @typedef {{ name: string, size: number, url: string, duration?: number, kind?: Kind,
 *             type?: string }} Held
 * @typedef {{ done: Promise<Held>, abort: () => void }} Upload
 * @typedef {{ picked: Picked, loaded: number, handle: Upload | null }} InFlight
 * @typedef {{ host: HTMLElement, seeds: Map<string, number> }} Seeded
 */

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

export const G = {
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
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  microphone:
    '<path d="M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
};

/**
 * What a kind decides: its shape, the word for it, and what its picker offers unless its host
 * names the types itself, as a server that admits files does. The picker's list is a courtesy —
 * admission is the platform's, and it refuses in the field.
 *
 * @type {Record<Kind, { shape: "frame" | "row", noun: string, choose: string, accept: string }>}
 */
export const KINDS = {
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
    noun: "audio file",
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
export const HINT = "or drop one here, or paste it";

/** @type {Record<string, string>} */
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {string} text */
export const esc = (text) => text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/** @param {number} n */
export function sizeOf(n) {
  if (n < MB) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / MB).toFixed(n >= 100 * MB ? 0 : 1)} MB`;
}

/** @param {InFlight} u */
export function bytesOf(u) {
  const { size } = u.picked;
  if (size < MB) return `${Math.round(u.loaded / 1024)} of ${Math.round(size / 1024)} KB`;
  return `${(u.loaded / MB).toFixed(1)} of ${(size / MB).toFixed(1)} MB`;
}

/** @param {InFlight} u */
export const pctOf = (u) => (u.picked.size > 0 ? Math.floor((u.loaded / u.picked.size) * 100) : 0);

/** @param {number} seconds */
export function clock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The length while a player rests at the start, and where it has got to once it moves.
 *
 * @param {number | undefined} duration
 * @param {number | null} at
 */
export function timeText(duration, at) {
  const length = duration && Number.isFinite(duration) ? clock(duration) : "";
  if (at === null) return length;
  return length ? `${clock(at)} / ${length}` : clock(at);
}

/**
 * @param {number} size
 * @param {string} body
 * @param {boolean} [fill]
 */
export function glyph(size, body, fill = false) {
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
 * @param {Seeded} f
 * @param {string} role
 */
export function seed(f, role) {
  let h = f.seeds.get(role);
  if (h === undefined) {
    h = 7;
    for (const c of `${f.host.id}:${role}`) h = (h * 31 + c.charCodeAt(0)) % 99_991;
    f.seeds.set(role, h);
  }
  return ` data-ink-seed="${h}" data-ink-role="${role}"`;
}

/** @param {{ body: HTMLElement, seeds: Map<string, number> }} f */
export function harvestSeeds(f) {
  for (const el of f.body.querySelectorAll("[data-ink-role]")) {
    if (el instanceof HTMLElement && el.dataset.inkRole && el.dataset.inkSeed) {
      f.seeds.set(el.dataset.inkRole, Number(el.dataset.inkSeed));
    }
  }
}

/** @param {InFlight} u */
export const progressAttrs = (u) =>
  ` role="progressbar" aria-label="Uploading ${esc(u.picked.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctOf(u)}" style="--file-progress: ${pctOf(u)}%" data-file-progress`;

/**
 * @param {Seeded} f
 * @param {string} role
 * @param {string} label
 * @param {string} body
 * @param {string} attrs
 * @param {string} [variant] the button's kind: outline, primary for Record, danger for a square that
 *   throws a recording away
 */
export const square = (f, role, label, body, attrs, variant = "btn--outline") =>
  `<button class="btn ${variant} file__action" type="button" ${attrs} aria-label="${label}" aria-describedby="${f.host.id}-guidance"${seed(f, role)}>${body}</button>`;

/**
 * Where a held file goes from its row: a video or a sound opens in the record's render view,
 * where it plays in full (decision 29); a PDF opens in a tab of its own; anything else
 * downloads under its own name (decision 27). A file with no address yet has nowhere to go.
 *
 * @param {Seeded} f
 * @param {Held} held
 * @param {Kind} kind
 * @param {string} attrs the hook that asks for the render view, and names the entry
 * @param {string} role the hand the square keeps from one render to the next
 * @param {string} [where] a row's place in a list, so two files of one name are told apart
 */
export function goesTo(f, held, kind, attrs, role, where = "") {
  const name = esc(held.name);
  const guided = `aria-describedby="${f.host.id}-guidance"${seed(f, role)}`;
  if (!held.url || kind === "image") return "";
  if (kind === "video" || kind === "audio")
    return `<button class="btn btn--outline file__action" type="button" ${attrs} aria-label="Open ${name}${where}" ${guided}>${glyph(14, G.expand)}</button>`;
  const pdf = held.type === "application/pdf";
  const how = pdf
    ? `target="_blank" rel="noopener" aria-label="Open ${name} in a new tab${where}"`
    : `download="${name}" aria-label="Download ${name}${where}"`;
  return `<a class="btn btn--outline file__action" href="${esc(held.url)}" ${how} ${guided}>${glyph(14, pdf ? G.open : G.download)}</a>`;
}

/* ── Kinds, by name and by field ──────────────────────────────────────────── */

/**
 * The family a file's extension names, for a file admission has not labelled yet.
 *
 * @type {Record<string, Kind>}
 */
export const BY_EXTENSION = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  mp4: "video",
  m4v: "video",
  mov: "video",
  webm: "video",
  ogv: "video",
  mp3: "audio",
  m4a: "audio",
  aac: "audio",
  wav: "audio",
  oga: "audio",
  ogg: "audio",
  opus: "audio",
  flac: "audio",
  pdf: "document",
  doc: "document",
  docx: "document",
  md: "document",
  txt: "document",
};

/** @param {string} name */
export const extensionOf = (name) => (name.includes(".") ? (name.split(".").pop() ?? "") : "");

/**
 * The kind a held file is: as admission settled it, or as its verified type says; then the
 * field's one family, when it takes one; then, for a WebM or an Ogg, the one of video and
 * sound the field takes; and last, what its name says.
 *
 * @param {{ name: string, kind?: Kind, type?: string }} file
 * @param {Kind[]} kinds the families the field takes, in their canonical order
 * @returns {Kind}
 */
export function kindOf(file, kinds) {
  const typed = /^(image|video|audio)\//i.exec(file.type ?? "")?.[1]?.toLowerCase();
  const settled = file.kind ?? /** @type {Kind | undefined} */ (typed);
  if (settled) return settled;
  const [only] = kinds;
  if (only && kinds.length === 1) return only;
  const extension = extensionOf(file.name).toLowerCase();
  const media = kinds.filter((k) => k === "video" || k === "audio");
  const [one] = media;
  if ((extension === "webm" || extension === "ogg") && one && media.length === 1) return one;
  return BY_EXTENSION[extension] ?? only ?? "document";
}

/** @param {string} value a host's `data-kind`, one family or several */
export const kindsIn = (value) =>
  /** @type {Kind[]} */ (value.split(/\s+/).filter((k) => k in KINDS));

/**
 * A field whose every family fills a frame is a frame; a field that takes anything a row
 * holds is a row, because a frame cannot show a document and a row can show a photo.
 *
 * @param {Kind[]} kinds
 */
export const shapeOf = (kinds) =>
  kinds.every((k) => KINDS[k].shape === "frame") ? "frame" : "row";

/** @param {string[]} things */
export function either(things) {
  const rest = [...things];
  const last = rest.pop() ?? "";
  return rest.length > 0 ? `${rest.join(", ")} or ${last}` : last;
}

/** @param {Kind[]} kinds */
export const chooseOf = (kinds) =>
  `Choose ${either(kinds.map((k) => KINDS[k].choose.replace(/^Choose /, "")))}`;

/** @param {Kind[]} kinds */
export const acceptOf = (kinds) => kinds.map((k) => KINDS[k].accept).join(",");

/**
 * What the save waits on while a file travels, before admission has named its family.
 *
 * @param {Kind[]} kinds
 */
export const nounFor = (kinds) =>
  kinds.length === 1 ? KINDS[kinds[0] ?? "document"].noun : "file";

/* ── A row's two ends, and a preview that plays ───────────────────────────── */

/**
 * What a video or a sound says when it won't play here, wherever that is found out. A browser
 * reports a codec it lacks and a file it couldn't fetch alike, so the sentence claims neither.
 * A list names the file, since "this" could be any of its rows.
 *
 * @param {"video" | "audio"} kind
 * @param {string} [name]
 */
export const cantPlay = (kind, name) =>
  `I can’t play ${name ?? (kind === "video" ? "this video" : "this audio file")} here.`;

/**
 * Files found not to play, so a redraw draws them without a toggle and doesn't say so again.
 *
 * @type {WeakSet<object>}
 */
export const UNPLAYABLE = new WeakSet();

/** @param {Held} held */
const toggleMarkup = (held) =>
  `<button class="file__toggle" type="button" data-file-play aria-pressed="false" aria-label="Play ${esc(held.name)}"><span data-file-play-glyph>${glyph(12, G.play, true)}</span></button>`;

/**
 * What a row shows either side of the name: a sound, its toggle and its time; a photo,
 * itself, small; anything else, its glyph and its type and size.
 *
 * @param {Held} held
 * @param {Kind} kind
 */
export function rowEnds(held, kind) {
  if (kind === "audio") {
    const plays = held.url !== "" && !UNPLAYABLE.has(held);
    const media = plays
      ? `<audio src="${esc(held.url)}" preload="metadata" data-file-media></audio>`
      : "";
    const lead = plays
      ? toggleMarkup(held)
      : `<span class="file__glyph">${glyph(18, G.audio)}</span>`;
    return [
      lead,
      `<span class="file__meta" data-file-time>${timeText(held.duration, null)}</span>${media}`,
    ];
  }
  const lead =
    kind === "image" && held.url
      ? `<span class="file__glyph file__thumb"><img src="${esc(held.url)}" alt="" loading="lazy" decoding="async"></span>`
      : `<span class="file__glyph">${glyph(18, G[kind])}</span>`;
  const extension = extensionOf(held.name).toUpperCase();
  return [
    lead,
    `<span class="file__meta">${extension ? `${esc(extension)} · ` : ""}${sizeOf(held.size)}</span>`,
  ];
}

/**
 * The toggle reports the media element's own state, so a sound that ends, or is paused
 * because another started, still reads true; its glyph is swapped only when that state
 * changes, so a drawn button's line is not rebuilt on every tick.
 *
 * @param {Element} scope
 * @param {Held} held
 * @param {HTMLMediaElement} media
 */
function showPlayback(scope, held, media) {
  scope.querySelector("[data-file-play]")?.setAttribute("aria-pressed", String(!media.paused));
  const mark = scope.querySelector("[data-file-play-glyph]");
  const shows = media.paused ? "play" : "pause";
  if (mark instanceof HTMLElement && mark.dataset.shows !== shows) {
    mark.dataset.shows = shows;
    mark.innerHTML = glyph(12, G[shows], true);
  }
  const time = scope.querySelector("[data-file-time]");
  const resting = media.ended || (media.paused && media.currentTime < 0.5);
  if (time)
    time.textContent = timeText(
      held.duration ?? media.duration,
      resting ? null : media.currentTime,
    );
}

/**
 * Whether the browser refused the file itself, rather than failing to fetch it: a source it
 * can't decode, or a video it plays as sound alone because it can't draw the picture.
 *
 * @param {HTMLMediaElement} media
 */
export function refusesToPlay(media) {
  const code = media.error?.code;
  if (code === 3 || code === 4) return true;
  return (
    media.tagName === "VIDEO" &&
    media.readyState >= 1 &&
    "videoWidth" in media &&
    media.videoWidth === 0
  );
}

/**
 * A refused toggle hands the keyboard to the first action beside it rather than to the page.
 *
 * @param {Element} scope
 * @param {Element} play
 */
function handOver(scope, play) {
  if (!play.contains(document.activeElement)) return;
  const next = scope.querySelector(".file__actions > *, .file__bar .btn");
  if (next instanceof HTMLElement) next.focus({ focusVisible: true });
}

/**
 * @param {Element} scope
 * @param {Element} play
 * @param {Kind} kind
 */
function dropToggle(scope, play, kind) {
  handOver(scope, play);
  if (kind === "audio")
    play.insertAdjacentHTML(
      "beforebegin",
      `<span class="file__glyph">${glyph(18, G.audio)}</span>`,
    );
  play.remove();
}

/**
 * Wire a preview's toggle and time. A file the browser won't play loses its toggle, the kind's
 * glyph stands in its place, and the field says it can't play it; the render view is where its download
 * link stands instead of the player. A `signal` ends the wiring when the preview is redrawn.
 *
 * @param {Element} scope
 * @param {Held} held
 * @param {Kind} kind
 * @param {(sentence: string) => void} say
 * @param {AbortSignal} [signal]
 * @param {string} [name] the file's name, for a list, where "this" could be any row
 */
export function wirePreview(scope, held, kind, say, signal, name) {
  const media = scope.querySelector("[data-file-media]");
  if (!(media instanceof HTMLMediaElement)) return;
  for (const type of ["play", "pause", "timeupdate", "loadedmetadata", "ended"]) {
    media.addEventListener(type, () => showPlayback(scope, held, media), { signal });
  }
  const refuse = () => {
    const play = scope.querySelector("[data-file-play]");
    if (UNPLAYABLE.has(held) || !play || !(kind === "video" || kind === "audio")) return;
    UNPLAYABLE.add(held);
    dropToggle(scope, play, kind);
    say(cantPlay(kind, name));
  };
  media.addEventListener("error", refuse, { signal });
  media.addEventListener(
    "loadedmetadata",
    () => {
      if (refusesToPlay(media)) refuse();
    },
    { signal },
  );
  showPlayback(scope, held, media);
}

/**
 * A play the browser gives up because something else paused or removed the player is not a
 * failure; only a real refusal to play is said.
 *
 * @param {Element} scope
 * @param {(sentence: string) => void} say
 * @param {"video" | "audio"} kind
 * @param {string} [name] the file's name, for a list
 */
export function togglePlayback(scope, say, kind, name) {
  const media = scope.querySelector("[data-file-media]");
  if (!(media instanceof HTMLMediaElement)) return;
  if (!media.paused) return media.pause();
  media.play().catch((error) => {
    const quiet = error instanceof DOMException && error.name === "AbortError";
    if (!quiet && !refusesToPlay(media)) say(cantPlay(kind, name));
  });
}
