// The Diff matrix: tick what changed about a capability and watch the work plan unioned. The
// note under it gives the reason for a single fact, or what a combination of facts adds.

import { label, list, UNITS } from "./text.js";

/*
 * `units` and `tests` stay separate because the engine keeps them separate: a length
 * limit moves the two writing suites without touching a Handler, and an item design
 * direction regenerates the renderer without selecting any suite at all.
 */
/** @type {Record<string, { platform: string[], units: string[], tests: string[], fullSuite?: boolean, gateNote?: string, why: string }>} */
const FACTS = {
  newField: {
    platform: ["A nullable column added", "The field added to the form and the record view"],
    units: ["create", "update"],
    tests: ["create", "update"],
    why: "Create and update see every field and are written again with their suites. Search is copied: a date is not a field it reads as text.",
  },
  hideField: {
    platform: [
      "The field taken off the form and the record view",
      "Its multi-line and hint settings removed",
    ],
    units: ["create", "update", "search"],
    tests: ["create", "update", "search"],
    gateNote:
      "The read and delete suites too, written again, when one of their cases names the hidden field",
    why: "Create and update lose the field. Search loses it too, because search reads strings as text.",
  },
  behavior: {
    platform: [],
    units: ["create", "read", "update", "delete", "search"],
    tests: ["create", "read", "update", "delete", "search"],
    fullSuite: true,
    why: "Behavior prose cannot be tied to one Action, and every handler's prompt holds it, so a change to it sends all five back and every suite runs.",
  },
  errors: {
    platform: ["The router accepts the new error as one of update's declared errors"],
    units: ["update"],
    tests: ["update"],
    why: `A handler's prompt holds only the errors its Action declares, so this change by itself sends update and its suite back to the model. Pick "The behavior prose changed" as well to see a request that also rewords the prose: that sends all five back.`,
  },
  item: {
    platform: [],
    units: ["item"],
    tests: [],
    why: "Only the item renderer is written again: it alone draws the card.",
  },
  cardFields: {
    platform: [],
    units: ["item"],
    tests: [],
    fullSuite: true,
    why: "The item renderer is written again, and every suite runs, because any carried suite may check which fields a card shows.",
  },
  noun: {
    platform: ["The empty-state line and the record count reworded"],
    units: [],
    tests: [],
    why: "No unit is written again. The platform rewords the empty state and the record count.",
  },
  maxLength: {
    platform: [
      "A scan of stored titles against the lower limit; the change is refused if one is already longer",
      "The save-time check that refuses a title over the limit",
      "The form's length limit and its character counter",
    ],
    units: [],
    tests: ["create", "update"],
    why: "No handler changes: the platform enforces a length limit when a record is saved. The limit is an input to the create and update suites, which are written again.",
  },
};

/** @param {string | undefined} text */
const sentence = (text = "") => text.charAt(0).toUpperCase() + text.slice(1);

/** @param {Iterable<string>} actions */
const suitesPhrase = (actions) => {
  const named = new Set(actions);
  const ordered = UNITS.filter((unit) => unit !== "item" && named.has(unit));
  if (ordered.length === 5) return "all five suites";
  return `the ${list(ordered)} suite${ordered.length > 1 ? "s" : ""}`;
};

/**
 * What the model writes again: the units first, then any test suites written alongside them.
 * @param {readonly string[]} regenerated @param {Set<string>} tests
 */
const writtenLine = (regenerated, tests) => {
  const suites = suitesPhrase(tests);
  const verb = tests.size > 1 ? "are" : "is";
  if (regenerated.length > 0) {
    const units = `${sentence(list(regenerated.map(label)))}: ${regenerated.length} of 6`;
    return tests.size > 0
      ? `${units}, plus ${suites} when the behavioral rung is on.`
      : `${units}.`;
  }
  return tests.size > 0
    ? `No unit. Every unit is copied, and ${suites} ${verb} written again when the behavioral rung is on.`
    : "No unit. Every unit is copied, and the model writes no code.";
};

const matrix = document.querySelector("[data-matrix-facts]");
if (matrix) {
  const buttons = [...matrix.querySelectorAll("[data-fact]")];
  const effects = document.querySelector("[data-matrix-effects]");
  const note = document.querySelector("[data-matrix-note]");
  /** @param {string} name */
  const slot = (name) => effects?.querySelector(`[data-slot="${name}"]`);
  /** @param {string} name */
  const card = (name) => effects?.querySelector(`[data-effect="${name}"]`);
  const chosen = new Set();

  /* One item is a sentence; several are a list, because several clauses joined by
     "and" stopped being readable the moment a clause carried its own comma. */
  /** @param {string} name @param {string | readonly string[]} value @param {boolean} hot */
  const paint = (name, value, hot) => {
    const target = slot(name);
    const box = card(name);
    if (target && Array.isArray(value)) {
      const items = document.createElement("ul");
      for (const entry of value) {
        const item = document.createElement("li");
        item.textContent = entry;
        items.append(item);
      }
      target.replaceChildren(value.length > 1 ? items : document.createTextNode(value[0] ?? ""));
    } else if (target && typeof value === "string") {
      target.textContent = value;
    }
    box?.classList.toggle("is-hot", Boolean(hot));
    box?.classList.toggle("is-cold", !hot);
  };

  const renderNoop = () => {
    paint("platform", "None.", false);
    paint("units", "None.", false);
    paint(
      "copied",
      "None: no new version is published, so all six units stay where they are.",
      false,
    );
    paint("gate", "Nothing runs.", false);
    if (note) {
      note.textContent = "No change picked.";
    }
  };

  const union = () => {
    const facts = [...chosen].map((key) => FACTS[key]).filter((fact) => fact !== undefined);
    const platform = new Set(facts.flatMap((fact) => fact.platform));
    const units = new Set(facts.flatMap((fact) => fact.units));
    const tests = new Set(facts.flatMap((fact) => fact.tests));
    const handlers = [...units].filter((unit) => unit !== "item");
    const fullSuite =
      facts.some((fact) => fact.fullSuite === true) || (units.has("item") && handlers.length > 0);
    const suites = new Set([...tests, ...handlers]);
    const gateNotes = facts.flatMap((fact) => (fact.gateNote ? [fact.gateNote] : []));
    return { platform, units, tests, suites, fullSuite, gateNotes };
  };

  /* A suite runs when it was written again or its handler was; a renderer change beside any
     handler runs them all, as the behavioral execution plan does. */
  /** @param {{ suites: Set<string>, fullSuite: boolean, gateNotes: string[] }} plan */
  const gateLines = ({ suites, fullSuite, gateNotes }) => {
    const lines = ["Structural, smoke and design lint, as on every build that changes something"];
    if (fullSuite) return [...lines, "All five behavioral suites, when the behavioral rung is on"];
    if (suites.size === 0)
      return [
        ...lines,
        "No behavioral suite, unless a Gate repair rewrites a unit: then a repaired handler's suite runs, or all five when the renderer was written again or repaired",
      ];
    return [
      ...lines,
      `${sentence(suitesPhrase(suites))}, when the behavioral rung is on`,
      ...gateNotes,
    ];
  };

  /* One fact gives its own reason; a combination says what the union adds, or points at the panel. */
  /** @param {{ units: Set<string> }} plan */
  const noteText = ({ units }) => {
    if (chosen.size === 1) return FACTS[[...chosen][0]]?.why ?? "";
    if (units.has("item") && [...units].some((unit) => unit !== "item")) {
      return "Together they send the item renderer and at least one handler back to the model, so every suite runs.";
    }
    return `${chosen.size} changes picked. The panel shows their combined work.`;
  };

  const render = () => {
    if (chosen.size === 0) {
      renderNoop();
      return;
    }
    const plan = union();
    const { platform, units, tests } = plan;
    const regenerated = UNITS.filter((unit) => units.has(unit));
    const copied = UNITS.filter((unit) => !units.has(unit));

    paint("platform", platform.size === 0 ? "None." : [...platform], platform.size > 0);
    paint("units", writtenLine(regenerated, tests), regenerated.length > 0);
    paint(
      "copied",
      copied.length === 0
        ? "None. Every unit was selected."
        : `${sentence(list(copied.map(label)))}, byte for byte into the new version, unless a Gate repair rewrites ${copied.length === 1 ? "it" : "one"} later.`,
      false,
    );
    paint("gate", gateLines(plan), true);

    if (note) note.textContent = noteText(plan);
  };

  for (const button of buttons) {
    if (!(button instanceof HTMLElement)) continue;
    button.addEventListener("click", () => {
      const key = button.dataset.fact ?? "";
      if (chosen.has(key)) chosen.delete(key);
      else chosen.add(key);
      button.setAttribute("aria-pressed", chosen.has(key) ? "true" : "false");
      render();
    });
  }
  document.querySelector("[data-matrix-clear]")?.addEventListener("click", () => {
    chosen.clear();
    for (const button of buttons) button.setAttribute("aria-pressed", "false");
    render();
  });
  render();
}
