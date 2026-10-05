// How an id leaves the prose (7.5/04, ADR-0010): every spelling a model could hide one in, and the
// rest of the answer left exactly as she wrote it.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { idDigits, idsInCell, wholeCellId, withoutRecordIds } from "./answer-record-ids.ts";

const ONE = randomUUID();
const OTHER = randomUUID();
const IDS = new Set([ONE, OTHER].map(idDigits));

/** What a reader could still make an id out of: every hex digit left, folded the way NFKC does. */
const digitsLeft = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");

function expectNoId(text: string): void {
  for (const id of [ONE, OTHER]) expect(digitsLeft(text)).not.toContain(idDigits(id));
}

/** The id with `between` written after every one of its characters but the last. */
const spread = (id: string, between: string) => [...id].join(between);

/** Each ASCII character as its fullwidth form, which sits 0xFEE0 above it. */
const fullwidth = (text: string) =>
  [...text]
    .map((character) => String.fromCodePoint((character.codePointAt(0) ?? 0) + 0xfee0))
    .join("");

describe("an id in the prose is taken out", () => {
  const spellings: readonly (readonly [string, string])[] = [
    ["as written", ONE],
    ["in capitals", ONE.toUpperCase()],
    ["without its hyphens", idDigits(ONE)],
    ["a space between each digit", spread(idDigits(ONE), " ")],
    ["four spaces inside it", `${ONE.slice(0, 18)}    ${ONE.slice(18)}`],
    ["word joiners between its digits", spread(ONE, "⁠⁠⁠⁠")],
    ["variation selectors between its digits", spread(ONE, "️️️️")],
    ["soft hyphens between its digits", spread(ONE, "­­­­")],
    ["in fullwidth digits and letters", fullwidth(ONE)],
    ["with another id inside it", `${ONE.slice(0, 18)}${OTHER}${ONE.slice(18)}`],
    ["with another id in brackets inside it", `${ONE.slice(0, 18)}(${OTHER})${ONE.slice(18)}`],
  ];

  for (const [how, spelled] of spellings) {
    test(how, () => {
      const said = withoutRecordIds(`Milk run is ${spelled} and ${OTHER}, I think.`, IDS);

      expectNoId(said);
      expect(said.startsWith("Milk run is")).toBe(true);
      expect(said.endsWith("I think.")).toBe(true);
    });
  }
});

describe("an id drawn in lookalike characters is taken out", () => {
  /** A fixed id, so every lookalike below has a digit of its own to stand in for. */
  const DRAWN = "ffeacabe-0c1e-4d3e-8a1b-0123456789ab";
  const DRAWN_IDS = new Set([idDigits(DRAWN)]);
  const lookalikes: readonly (readonly [string, string])[] = [
    [
      "a Cyrillic a, c and e",
      DRAWN.replace("a", "\u0430").replace("c", "\u0441").replace("e", "\u0435"),
    ],
    ["the ff ligature", DRAWN.replace("ff", "\uFB00")],
    ["the estimated sign for an e", DRAWN.replace("e", "\u212E")],
    ["Hangul fillers between its digits", spread(DRAWN, "\u3164")],
    ["a letter o for each zero", DRAWN.replaceAll("0", "o")],
  ];

  for (const [how, spelled] of lookalikes) {
    test(how, () => {
      const said = withoutRecordIds(`Milk run is ${spelled}, I think.`, DRAWN_IDS);

      expect(said).toBe("Milk run is, I think.");
    });
  }
});

describe("the place an id stood is left reading as a sentence", () => {
  const tidied: readonly (readonly [string, string])[] = [
    [`Milk run: ${ONE}`, "Milk run"],
    [`Milk run (${ONE}`, "Milk run"],
    [`Milk run ((${ONE}) and (${OTHER})).`, "Milk run (and)."],
    [`Milk-${ONE}-run`, "Milk-run"],
    [`Milk run, id: ${ONE}, and more.`, "Milk run, id, and more."],
    [`[Milk run](/capability/notes/${ONE}).`, "Milk run."],
    [`Your [Milk run](/capability/notes/${ONE}) is due.`, "Your Milk run is due."],
    [`Your Milk run (notes/${ONE}) is due.`, "Your Milk run is due."],
    [`Milk run, ${ONE}.`, "Milk run."],
    [`Milk run (${ONE}.`, "Milk run."],
    [`She said "${ONE}".`, "She said."],
    [`"Milk run" ${ONE} now.`, '"Milk run" now.'],
    [`"Milk run" ${ONE}.`, '"Milk run".'],
    [
      `Milk run ${ONE}/${OTHER} is here, and Weekly shop too.`,
      "Milk run is here, and Weekly shop too.",
    ],
    [`Milk run notes/${ONE}/${OTHER} is here.`, "Milk run notes is here."],
    [`Milk run/${ONE} is yours.`, "Milk run is yours."],
    [`See notes/${ONE} for Milk run.`, "See notes for Milk run."],
    [`x/${ONE} ${OTHER} Milk run is here.`, "x Milk run is here."],
    [`Milk run \u2014 notes/${ONE} \u2014 is yours.`, "Milk run \u2014 notes \u2014 is yours."],
    [`Milk run\u2014/capability/notes/${ONE} is yours.`, "Milk run\u2014 is yours."],
    [`Your Milk run/notes/${ONE} is here.`, "Your Milk run is here."],
    [`Your note Milk run:/capability/notes/${ONE}.`, "Your note Milk run."],
    [`Your caf\u00E9/notes/${ONE} note.`, "Your caf\u00E9 note."],
    [`\u9F99\u4E95\u8336/notes/${ONE}\u5F88\u597D\u3002`, "\u9F99\u4E95\u8336\u5F88\u597D\u3002"],
    [`Your Milk run\u2019s/notes/${ONE} note.`, "Your Milk run\u2019s note."],
    [`Your Milk run's/notes/${ONE} note.`, "Your Milk run's note."],
    [`See https://aluna.test/capability/notes/${ONE} now.`, "See now."],
    [`Milk run(${ONE})and Weekly shop.`, "Milk run and Weekly shop."],
    [`Milk run\u201C${ONE}\u201DWeekly shop.`, "Milk run Weekly shop."],
    [`Milk run**${ONE}**Weekly shop.`, "Milk run Weekly shop."],
    [`\u9F99\u4E95\u8336\uFF08${ONE}\uFF09\u5F88\u597D`, "\u9F99\u4E95\u8336\u5F88\u597D"],
    [`Milk run ${ONE}\u0301 is yours.`, "Milk run is yours."],
    [`"Milk run" ${ONE} "Weekly shop" ${OTHER}.`, '"Milk run" "Weekly shop".'],
    [`- ${ONE}: Milk run\n- ${OTHER}: Weekly shop`, "- Milk run\n- Weekly shop"],
    [`1. ${ONE} \u2014 Milk run`, "1. Milk run"],
    [`${ONE} \u2014 Milk run`, "Milk run"],
    [`Milk run (${ONE}, added Monday).`, "Milk run (added Monday)."],
    [`Milk run/${ONE}`, "Milk run"],
    [`Tea and/or Weekly shop/${OTHER}.`, "Tea and/or Weekly shop."],
    [`Milk run (\`${ONE}\`).`, "Milk run."],
    [`Milk run **${ONE}**.`, "Milk run."],
    [`Milk run <${ONE}>.`, "Milk run."],
    [`Milk run ('${ONE}').`, "Milk run."],
    [`Milk run \u00AB${ONE}\u00BB.`, "Milk run."],
    [`\u9F99\u4E95\u8336\uFF08${ONE}\uFF09`, "\u9F99\u4E95\u8336"],
    [`\u9F99\u4E95\u8336\u300C${ONE}\u300D`, "\u9F99\u4E95\u8336"],
    [`\u9F99\u4E95\u8336\uFF1A${ONE}\u3002`, "\u9F99\u4E95\u8336\u3002"],
    [`\u9F99\u4E95\u8336\uFF0C${ONE}\uFF0C\u5F88\u597D`, "\u9F99\u4E95\u8336\uFF0C\u5F88\u597D"],
    [`"Milk run (${ONE})" today`, '"Milk run" today'],
    [`"${ONE} is Milk run,"`, '"is Milk run,"'],
    [`Milk run ${ONE}'s note`, "Milk run's note"],
  ];

  for (const [said, left] of tidied) {
    test(JSON.stringify(said.replace(ONE, "<id>").replace(OTHER, "<id>")), () => {
      expect(withoutRecordIds(said, IDS)).toBe(left);
    });
  }
});

describe("the rest of the answer stays as she wrote it", () => {
  test("text holding no id comes back unchanged, room and all", () => {
    const said = "- [ ] Milk run (€)  costs 5 ?\n  - nested";

    expect(withoutRecordIds(said, IDS)).toBe(said);
  });

  test("only the place an id stood is tidied", () => {
    const kept = "- [ ] Milk run (€)  costs 5 ?\n  - nested";

    expect(withoutRecordIds(`${kept}\nAlso ${ONE}.`, IDS)).toBe(`${kept}\nAlso.`);
  });

  test("a bracket the id emptied goes with it, and so does the space before it", () => {
    expect(withoutRecordIds(`Milk run (${ONE}) is yours.`, IDS)).toBe("Milk run is yours.");
    expect(withoutRecordIds(`Milk run [ ${ONE} ], then rent.`, IDS)).toBe("Milk run, then rent.");
  });

  test("words either side keep one space between them", () => {
    expect(withoutRecordIds(`Milk run ${ONE} and rent.`, IDS)).toBe("Milk run and rent.");
  });

  test("an id that is not in the set is left alone", () => {
    const stranger = randomUUID();

    expect(withoutRecordIds(`Your key is ${stranger}.`, IDS)).toBe(`Your key is ${stranger}.`);
  });
});

describe("the ids a cell holds", () => {
  test("hyphenated or bare, in either case, inside other words or alone", () => {
    expect(idsInCell(`${ONE.toUpperCase()},${idDigits(OTHER)}`)).toEqual([ONE, OTHER]);
    expect(idsInCell(42)).toEqual([]);
  });

  test("a cell is one id only when it holds nothing else", () => {
    expect(wholeCellId(` ${idDigits(ONE)} `)).toBe(ONE);
    expect(wholeCellId(`${ONE},${OTHER}`)).toBeUndefined();
    expect(wholeCellId(`id ${ONE}`)).toBeUndefined();
  });
});
