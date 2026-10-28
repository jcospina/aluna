// @ts-check

/**
 * The band Aluna looks under while she answers a question: the build narration's own band (its
 * caps word, its tiny squares and its rule, from `design/styles/components/narration.css`), told
 * steps rather than stages. A question does not know how many steps it will take, so the squares
 * only grow, one per step with the current one in sun, and the rule creeps under her sentence
 * without ever reaching the end until she has finished.
 *
 * When she finishes, the band and the rule fade where they stand and keep their room, so the
 * sentence she ends on lands exactly where her last one was and nothing moves.
 */

/** The band's word while she looks. A question has one stage, so it never changes. */
export const LOOKING_WORD = "Looking";

/** What marks the band, the rule and a step's square, for the sheet and for whoever reads them. */
export const BAND_CLASS = "desk-window__band";
export const RULE_CLASS = "desk-window__rule";
export const SQUARE_CLASS = "narration__dot";
/** Put on the band and the rule once she has stopped looking: they fade and keep their room. */
export const SPENT_CLASS = "is-spent";
/** Put on a rule the line has just pushed down: gone at once, so it is never seen to move. */
export const DROPPED_CLASS = "is-dropped";

/** How much of the rule she may fill while she looks, as a percentage; finishing fills the rest. */
const BEFORE_FINISHING = 92;
/** The share of what is left of that each step creeps through. */
const STEP_SHARE = 0.42;
/** How long one creep takes. A step usually lands before it is done, and creeps on from there. */
const CREEP_MS = 5200;
/** How long the rule takes to run out once she has finished. */
const RUN_OUT_MS = 320;
/** How long a fresh rule waits before its first creep, so the page has drawn it empty first. */
const FIRST_CREEP_MS = 60;

/**
 * @typedef {{ band: HTMLElement, dots: HTMLElement, squares: HTMLElement[], rule: HTMLElement,
 *             fill: number, timer: ReturnType<typeof setTimeout> | undefined }} Looking
 */

/**
 * A band and a rule for one question, neither of them read out: what she is doing is in her
 * sentence, and the band only shows it.
 *
 * @returns {Looking}
 */
export function freshLooking() {
  const band = document.createElement("div");
  band.className = `${BAND_CLASS} narration__row`;
  band.setAttribute("aria-hidden", "true");
  const word = document.createElement("span");
  word.className = "caps narration__stage";
  word.textContent = LOOKING_WORD;
  const dots = document.createElement("span");
  dots.className = "narration__dots";
  band.append(word, dots);
  const rule = document.createElement("div");
  rule.className = `${RULE_CLASS} narration__rule`;
  rule.setAttribute("aria-hidden", "true");
  /** @type {Looking} */
  const looking = { band, dots, squares: [], rule, fill: 0, timer: undefined };
  looking.timer = setTimeout(() => creep(looking), FIRST_CREEP_MS);
  return looking;
}

/**
 * The next question takes the band over: a fresh band and rule where the last ones stood, so no
 * square or fill of the question before is carried into this one.
 *
 * @param {Looking} looking @returns {Looking}
 */
export function lookAgain(looking) {
  const next = freshLooking();
  looking.band.replaceWith(next.band);
  looking.rule.replaceWith(next.rule);
  return next;
}

/** One more step: the squares before it done, a new one in sun, and the rule creeping on. @param {Looking} looking */
export function lookedAtAStep(looking) {
  clearTimeout(looking.timer);
  settleSquares(looking);
  const square = document.createElement("span");
  square.className = SQUARE_CLASS;
  square.dataset.state = "now";
  looking.squares.push(square);
  looking.dots.append(square);
  creep(looking);
}

/**
 * She has stopped looking. A question she saw to its end runs its rule out first; one given up
 * on, stopped short, or a sentence she would not take lets it go where it stands. A rule the
 * line has just pushed down goes at once instead.
 *
 * @param {Looking} looking @param {boolean} finished @param {boolean} [pushed]
 */
export function doneLooking(looking, finished, pushed = false) {
  clearTimeout(looking.timer);
  settleSquares(looking);
  if (pushed) looking.rule.classList.add(DROPPED_CLASS);
  else if (finished) setFill(looking, 100, RUN_OUT_MS);
  looking.band.classList.add(SPENT_CLASS);
  looking.rule.classList.add(SPENT_CLASS);
}

/** @param {Looking} looking */
function settleSquares(looking) {
  for (const square of looking.squares) square.dataset.state = "done";
}

/** Creep a share of the way toward the end it may not reach. @param {Looking} looking */
function creep(looking) {
  setFill(looking, looking.fill + (BEFORE_FINISHING - looking.fill) * STEP_SHARE, CREEP_MS);
}

/** @param {Looking} looking @param {number} fill @param {number} ms */
function setFill(looking, fill, ms) {
  looking.fill = fill;
  looking.rule.style.setProperty("--narration-eta", `${ms}ms`);
  looking.rule.style.setProperty("--narration-fill", `${fill}%`);
}
