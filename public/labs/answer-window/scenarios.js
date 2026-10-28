// @ts-check
/**
 * The questions the answer-window lab plays. Step sentences, the opening and every ending but the
 * answer are copied from the platform, with the curly apostrophe product copy takes; the answers
 * are what a model might say.
 */

/** @typedef {"naming"|"counting"|"totalling"|"listing"|"dates"|"other"} StepLabel */
/** @typedef {{ text: string } | { name: string }} Run */
/**
 * @typedef {{ kind: "answer" | "nothing" | "nohome" | "unfinished", runs: Run[],
 *             figure?: string }} Ending
 * @typedef {{ label: StepLabel, ms: number }} Step
 * @typedef {{ id: string, label: string, question: string, steps: Step[], ending: Ending }} Scenario
 */

export const OPENING = "Let me look at what you’ve saved.";

/** @type {Record<StepLabel, string>} */
export const STEP_SENTENCE = {
  naming: "I’m seeing how you named things.",
  counting: "I’m counting how many you have.",
  totalling: "I’m adding everything up.",
  listing: "I’m looking for the ones you asked about.",
  dates: "I’m checking when things happened.",
  other: "I’m having a look at what you’ve saved.",
};

/**
 * The same steps told afterwards, for the options that keep a record of how she looked. New words.
 * @type {Record<StepLabel, string>}
 */
export const STEP_DONE = {
  naming: "Saw how you named things",
  counting: "Counted how many you have",
  totalling: "Added everything up",
  listing: "Looked for the ones you asked about",
  dates: "Checked when things happened",
  other: "Had a look at what you’ve saved",
};

/** @param {string} text @returns {Run} */
const t = (text) => ({ text });
/** @param {string} name @returns {Run} */
const n = (name) => ({ name });

/** @type {Scenario[]} */
export const SCENARIOS = [
  {
    id: "count",
    label: "A count",
    question: "How many books did I finish in March?",
    steps: [
      { label: "naming", ms: 1800 },
      { label: "dates", ms: 2600 },
      { label: "counting", ms: 2200 },
    ],
    ending: {
      kind: "answer",
      figure: "4",
      runs: [
        t("You finished 4 books in March: "),
        n("Piranesi"),
        t(", "),
        n("The Overstory"),
        t(", "),
        n("Klara and the Sun"),
        t(" and "),
        n("Middlemarch"),
        t("."),
      ],
    },
  },
  {
    id: "total",
    label: "A total",
    question: "How much did I spend on groceries last month?",
    steps: [
      { label: "naming", ms: 1600 },
      { label: "dates", ms: 2400 },
      { label: "totalling", ms: 2600 },
    ],
    ending: {
      kind: "answer",
      figure: "$412.80",
      runs: [
        t("You spent $412.80 on groceries in September, over 9 shops. The biggest was "),
        n("Saturday market"),
        t(" on the 14th, at $86.15."),
      ],
    },
  },
  {
    id: "list",
    label: "A short list",
    question: "Which authors have more than three books on my shelf?",
    steps: [
      { label: "naming", ms: 1700 },
      { label: "counting", ms: 2500 },
      { label: "listing", ms: 2100 },
    ],
    ending: {
      kind: "answer",
      runs: [
        t("Three of them do: "),
        n("Ursula K. Le Guin"),
        t(" with 7, "),
        n("Terry Pratchett"),
        t(" with 5 and "),
        n("Toni Morrison"),
        t(" with 4."),
      ],
    },
  },
  {
    id: "long",
    label: "A long list",
    question: "What have I lent out this year, and to whom?",
    steps: [
      { label: "naming", ms: 1500 },
      { label: "dates", ms: 2200 },
      { label: "listing", ms: 2400 },
      { label: "other", ms: 1800 },
    ],
    ending: {
      kind: "answer",
      runs: [
        t("You’ve lent out 7 things this year, and 3 haven’t come back yet:\n"),
        n("Piranesi"),
        t(" to Marta, in January\n"),
        n("The camping stove"),
        t(" to Diego, in March\n"),
        n("The Overstory"),
        t(" to Marta, in April\n"),
        n("The long ladder"),
        t(" to your neighbour, in May — still out\n"),
        n("Middlemarch"),
        t(" to Lucía, in June — still out\n"),
        n("The tent"),
        t(" to Diego, in August\n"),
        n("The bread machine"),
        t(" to Ana, in September — still out"),
      ],
    },
  },
  {
    id: "quick",
    label: "One quick step",
    question: "How many authors do I have?",
    steps: [{ label: "counting", ms: 1100 }],
    ending: {
      kind: "answer",
      figure: "23",
      runs: [t("You have 23 authors.")],
    },
  },
  {
    id: "nothing",
    label: "Nothing matched",
    question: "Did I lend anything to Julián?",
    steps: [
      { label: "naming", ms: 1600 },
      { label: "listing", ms: 2300 },
    ],
    ending: {
      kind: "nothing",
      runs: [t("Looking at your Loans, I couldn’t find anything matching that.")],
    },
  },
  {
    id: "nohome",
    label: "Nowhere to look",
    question: "What did I eat on Tuesday?",
    steps: [{ label: "naming", ms: 1900 }],
    ending: {
      kind: "nohome",
      runs: [t("You don’t have anywhere for meals yet — you can ask me to make one.")],
    },
  },
  {
    id: "unfinished",
    label: "Couldn’t finish",
    question: "Which month did I read the most?",
    steps: [
      { label: "naming", ms: 1700 },
      { label: "dates", ms: 2600 },
      { label: "counting", ms: 3000 },
    ],
    ending: {
      kind: "unfinished",
      runs: [t("I couldn’t finish looking at that one. Mind asking me again?")],
    },
  },
];
