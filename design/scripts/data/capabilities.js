// @ts-check
/**
 * Stand-in capabilities for the desk.
 *
 * In the product these are grown by Aluna and their content comes from the
 * filesystem. Here they are fixtures with just enough shape to exercise the
 * presentation patterns: a collection with records, and a record with fields.
 *
 * `logo` is the one part of a capability the shell does not draw. Aluna emits a
 * subject and two colours, a hosted service returns the square, and it is
 * stored and never regenerated — `logo.html` is the contract, and this file
 * carries the four real generations that page stands on. The desk and the
 * contract therefore cannot disagree about what a logo looks like: they are the
 * same four files, under the same tile and label rules.
 */

/**
 * One row in a capability's collection.
 * @typedef {{ title: string, detail: string, state: string }} CapabilityRecord
 */

/**
 * One field on a record form. `span: 1` asks to be paired two-up with its
 * neighbour; anything else takes the full width.
 * @typedef {{ label: string, value: string, span?: number, type?: string,
 *             guidance?: string }} CapabilityField
 */

/**
 * A capability, as the desk sees one. `logo` is the stored artwork, and it is
 * empty for exactly as long as `pending` is true: the artwork is requested last,
 * once the build has cleared its gate, so a capability exists on the desk for a
 * moment before it has a face. `unnamed` is the shorter window before that: a
 * capability admitted but not yet specified has no name to write under its tile,
 * so the ground stays blank rather than carrying a stand-in. `seed` is a fixture
 * here — the hand a window is drawn in is rolled when the window opens and is
 * never stored.
 * @typedef {{ id: string, label: string, noun: string, logo: string,
 *             seed: number, records: CapabilityRecord[],
 *             fields: CapabilityField[], pending?: boolean,
 *             unnamed?: boolean }} Capability
 */

/** @type {Capability[]} */
export const CAPABILITIES = [
  {
    id: "reading-journal",
    label: "Reading journal",
    noun: "book",
    logo: "./assets/logos/reading-journal.svg",
    seed: 4211,
    records: [
      { title: "The Overstory", detail: "Richard Powers · 502 pp", state: "Finished" },
      { title: "Piranesi", detail: "Susanna Clarke · 245 pp", state: "Finished" },
      { title: "The Dawn of Everything", detail: "Graeber & Wengrow · 692 pp", state: "Reading" },
      { title: "Ariel", detail: "Sylvia Plath · 86 pp", state: "Finished" },
      { title: "Tenth of December", detail: "George Saunders · 251 pp", state: "Queued" },
      { title: "Solenoid", detail: "Mircea Cărtărescu · 627 pp", state: "Queued" },
    ],
    fields: [
      { label: "Title", value: "The Overstory", span: 1 },
      { label: "Author", value: "Richard Powers", span: 1 },
      {
        label: "Shelf",
        value: "Read in 2026",
        type: "select",
        guidance: "Linked from Shelves. Changing this moves the book.",
      },
      { label: "Finished", value: "9 May 2026", span: 1 },
      { label: "Rating", value: "4 of 5", span: 1 },
    ],
  },
  {
    id: "coffee-tasting-log",
    label: "Coffee tasting log",
    noun: "tasting",
    logo: "./assets/logos/coffee-tasting-log.svg",
    seed: 8123,
    records: [
      { title: "Kieni AA", detail: "Nyeri, Kenya · washed", state: "Keeper" },
      { title: "Finca La Soledad", detail: "Huila, Colombia · honey", state: "Keeper" },
      { title: "Hambela Alaka", detail: "Guji, Ethiopia · natural", state: "Sample" },
      { title: "Kilenso Mokonisa", detail: "Sidama, Ethiopia · washed", state: "Sample" },
    ],
    fields: [
      { label: "Coffee", value: "Kieni AA", span: 1 },
      { label: "Roaster", value: "Rosetta", span: 1 },
      {
        label: "Brew method",
        value: "V60, 1:16",
        type: "select",
        guidance: "Linked from Methods. Changing this rewrites the ratio.",
      },
      { label: "Dose", value: "18 g", span: 1 },
      { label: "Score", value: "87.5", span: 1 },
      { label: "Notes", value: "Blackcurrant, cane sugar, long finish" },
    ],
  },
  {
    id: "telescope-observations",
    label: "Telescope observations",
    noun: "observation",
    logo: "./assets/logos/telescope-observations.svg",
    seed: 1907,
    records: [
      { title: "M51 · Whirlpool", detail: "21 June · seeing 3 of 5", state: "Logged" },
      { title: "Saturn", detail: "4 July · seeing 4 of 5", state: "Logged" },
      { title: "NGC 7000 · North America", detail: "18 July · clouded out", state: "Clouded" },
    ],
    fields: [
      { label: "Object", value: "M51", span: 1 },
      { label: "Night", value: "21 June 2026", span: 1 },
      { label: "Instrument", value: "8-inch Dobsonian", type: "select" },
    ],
  },
  {
    id: "recipes",
    label: "Recipes",
    noun: "recipe",
    logo: "./assets/logos/recipes.svg",
    seed: 6602,
    records: [
      { title: "Ajiaco", detail: "Three potatoes · 90 min", state: "Cooked" },
      { title: "Country sourdough", detail: "72 h · 78% hydration", state: "Cooked" },
      { title: "Miso aubergine", detail: "Four ingredients · 35 min", state: "Untried" },
    ],
    fields: [
      { label: "Recipe", value: "Ajiaco", span: 1 },
      { label: "Serves", value: "6", span: 1 },
      { label: "Course", value: "Soup", type: "select" },
    ],
  },
];

/**
 * The records of one capability linking to the record on show, drawn in a
 * section between its fields and its actions. In the product each card is
 * the linking capability's own; here every one wears the fixture card.
 * @typedef {{ label: string, records: CapabilityRecord[] }} LinkingSection
 */

/**
 * The records the record-form specimens open, each with the sections of
 * records linking to it. None is on the desk, so none needs a logo.
 * @type {Record<"clarke" | "leGuin" | "leftHand", { capability: Capability, linking: LinkingSection[] }>}
 */
export const LINKED_RECORDS = {
  clarke: {
    capability: author("Susanna Clarke", "1959", "United Kingdom"),
    linking: [
      {
        label: "Books",
        records: [
          { title: "Piranesi", detail: "2020 · 245 pp", state: "Finished" },
          { title: "The Ladies of Grace Adieu", detail: "2006 · 235 pp", state: "Queued" },
          { title: "Jonathan Strange & Mr Norrell", detail: "2004 · 782 pp", state: "Reading" },
        ],
      },
    ],
  },
  leGuin: {
    capability: author("Ursula K. Le Guin", "1929", "United States"),
    linking: [
      {
        label: "Books",
        records: [
          { title: "Tehanu", detail: "1990 · 252 pp", state: "Queued" },
          { title: "Always Coming Home", detail: "1985 · 523 pp", state: "Queued" },
          { title: "The Dispossessed", detail: "1974 · 387 pp", state: "Finished" },
          { title: "The Farthest Shore", detail: "1972 · 223 pp", state: "Finished" },
          { title: "The Lathe of Heaven", detail: "1971 · 184 pp", state: "Reading" },
          { title: "The Left Hand of Darkness", detail: "1969 · 304 pp", state: "Finished" },
          { title: "A Wizard of Earthsea", detail: "1968 · 183 pp", state: "Finished" },
        ],
      },
    ],
  },
  leftHand: {
    capability: {
      id: "books",
      label: "Books",
      noun: "book",
      logo: "",
      seed: 3301,
      records: [],
      fields: [
        { label: "Title", value: "The Left Hand of Darkness" },
        { label: "Author", value: "Ursula K. Le Guin", span: 1 },
        { label: "Published", value: "1969", span: 1 },
      ],
    },
    linking: [
      {
        label: "Reading log",
        records: [
          { title: "Chapters 16 to 20", detail: "14 May · 70 min", state: "Logged" },
          { title: "Chapters 9 to 15", detail: "11 May · 55 min", state: "Logged" },
        ],
      },
      {
        label: "Quotes",
        records: [
          { title: "Light is the left hand of darkness", detail: "Chapter 16", state: "Keeper" },
          { title: "To oppose something is to maintain it", detail: "Chapter 10", state: "Keeper" },
          {
            title: "The only thing that makes life possible",
            detail: "Chapter 5",
            state: "Keeper",
          },
        ],
      },
    ],
  },
};

/**
 * One author's record, as the Authors capability draws it.
 * @param {string} name @param {string} born @param {string} country
 * @returns {Capability}
 */
function author(name, born, country) {
  return {
    id: "authors",
    label: "Authors",
    noun: "author",
    logo: "",
    seed: 5507,
    records: [],
    fields: [
      { label: "Name", value: name },
      { label: "Born", value: born, span: 1 },
      { label: "Country", value: country, span: 1 },
    ],
  };
}

/**
 * Tones a state pill may take. Signal red is never one of them.
 * @type {Record<string, string>}
 */
export const STATE_TONE = {
  Finished: "ok",
  Keeper: "ok",
  Logged: "ok",
  Cooked: "ok",
  Reading: "wait",
  Queued: "wait",
  Sample: "wait",
  Clouded: "wait",
  Untried: "wait",
};
