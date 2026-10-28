// @ts-check
/**
 * What a build says while it runs: one odd little verb per stage, and plain lines under it.
 *
 * The build sends facts and this file owns every word the window says about them. A hole in
 * braces is filled from what the build has decided: `{thing}` and `{things}` are the stored record
 * nouns, `{label}` the name, `{fields}` the field labels as written, `{field}` and `{target}` a
 * connected field and the records it picks from, `{piece}` the part being mended, `{time}` the
 * wait. No hole is pluralised, given "a"/"an" or made the subject of a verb, and nothing before
 * `room` names the thing, because nothing has named it yet.
 */

/** @typedef {"listen"|"plan"|"room"|"rules"|"make"|"connect"|"check"|"mend"|"finish"} Stage */
/** @typedef {"card"|"add"|"open"|"change"|"remove"|"search"} Part */
/** @typedef {"fit"|"try"|"look"|"rules"} Check */

/** @type {Record<Stage, { title: string, lines: readonly string[] }>} */
export const STAGES = {
  // Said on the prompt bar while the request is worked out, before the window opens.
  listen: { title: "Mulling", lines: [] },
  plan: {
    title: "Scheming",
    lines: [
      "Doodling in the margins.",
      "Noodling on what each one should hold.",
      "Trying names on for size.",
    ],
  },
  room: {
    title: "Shelving",
    lines: ["Clearing a shelf for {things}.", "Labelling the jars: {fields}."],
  },
  rules: {
    title: "Rule-writing",
    lines: [
      "Before I make anything, I’m writing the house rules.",
      "Rule one: nothing you type gets lost.",
      "Rule two: a change touches only what you changed.",
      "Rule three: when you remove one, only that one goes.",
      "Pinning the rules up where every part can see them.",
    ],
  },
  make: { title: "Tinkering", lines: ["Rolling up my sleeves."] },
  connect: {
    title: "Matchmaking",
    lines: ["Introducing every {thing}’s {field} to your {target}."],
  },
  check: { title: "Prodding", lines: ["Now for the poking and prodding."] },
  mend: {
    title: "Mending",
    lines: ["Oops. Something squeaks in {piece}.", "Darning that bit.", "Squinting at it again."],
  },
  finish: {
    title: "Polishing",
    lines: ["Buffing it to a shine.", "Tucking {label} onto your desk."],
  },
};

/** @type {Record<Part, { name: string, lines: readonly string[] }>} */
export const PARTS = {
  card: {
    name: "the card",
    lines: [
      "Whittling a card for each {thing}.",
      "Fussing over what goes on top.",
      "Giving it a bit of flair.",
    ],
  },
  add: {
    name: "the adding bit",
    lines: [
      "Kneading the part that adds {things}.",
      "Plugging the cracks so nothing you type falls through.",
    ],
  },
  open: {
    name: "the opening bit",
    lines: ["Unfolding the part that opens each {thing}.", "Smoothing out the creases."],
  },
  change: {
    name: "the changing bit",
    lines: ["Fettling the part that changes things.", "Leaving your untouched bits untouched."],
  },
  remove: {
    name: "the removing bit",
    lines: ["Sharpening the part that removes things.", "Aiming carefully. One at a time."],
  },
  search: {
    name: "the search",
    lines: [
      "Rummaging up a search.",
      "Teaching it that garcia and García are old friends.",
      "Peeking in every pocket.",
    ],
  },
};

/** @type {Record<Check, readonly string[]>} */
export const CHECKS = {
  fit: ["Squinting at the seams."],
  try: ["Taking it for a spin with a pretend {thing}.", "Kicking the tyres."],
  look: ["Admiring it from across the room."],
  rules: ["Checking that every part follows the house rules.", "Double-checking the fiddly bits."],
};

/** Said once the window has landed, never before: a run can still fail while it polishes. */
export const READY_TITLE = "Ta-da";
export const READY = "Cooked up in {time}.";

/** The product-voice line a build that failed ends on, which the server sends as its ending. */
export const FAILED_BUILD_ENDING = "Well, that fizzled. Mind asking me again?";

/** What a hole says when the build has not named it yet, so no line shows a brace. */
const UNNAMED = { thing: "one", things: "them", label: "it", fields: "every field" };

/**
 * A line with its holes filled, and its first letter raised, since a hole may open it.
 *
 * @param {string} template
 * @param {Record<string, string | undefined>} values
 */
export function say(template, values) {
  /** @type {Record<string, string | undefined>} */
  const known = { ...UNNAMED, ...values };
  const text = template.replace(/\{(\w+)\}/g, (hole, key) => known[key] ?? hole);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Field labels as a sentence lists them: "Recipe, Serves and Course". Past `most` the rest are
 * counted rather than named, "Recipe, Serves and 4 more", which never leaves "1 more".
 *
 * @param {readonly string[]} labels
 * @param {number} [most] how many a sentence names at the most
 */
export function listed(labels, most = Number.POSITIVE_INFINITY) {
  if (labels.length > most) {
    const named = labels.slice(0, Math.max(1, most - 1));
    return `${named.join(", ")} and ${labels.length - named.length} more`;
  }
  if (labels.length < 2) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * A wait, the way a clock shows it: "1:58".
 *
 * @param {number} ms
 */
export function clock(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
