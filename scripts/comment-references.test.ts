// The reference checker's own teeth. Every rule is forced against a comment written to break it
// as well as one written to pass, because a check nothing can fail is a check that gets deleted.

import { describe, expect, test } from "bun:test";

import { ABSENT_MARKER, auditRepository, staleReferences } from "./comment-references.ts";

const HERE = "scripts/comment-references.test.ts";
const REAL = "scripts/comment-budget.ts";
const GONE = "scripts/comment-ledger.ts";

const comment = (text: string) => `// ${text}\nconst a = 1;\n`;
const cited = (file: string, source: string) =>
  staleReferences(file, source).map((one) => one.cited);

describe("a path cited in comment text", () => {
  test("passes when the file is there and fails when it moved", () => {
    expect(cited(HERE, comment(`see \`${REAL}\``))).toEqual([]);
    expect(cited(HERE, comment(`see \`${GONE}\``))).toEqual([GONE]);
  });

  test("is read src-relative as well as repo-rooted", () => {
    expect(cited(HERE, comment("`server/app.ts` and `registry/spec/spec.ts`"))).toEqual([]);
    expect(cited(HERE, comment("`server/app-shell.ts`"))).toEqual(["server/app-shell.ts"]);
  });

  test("is prose when its first segment names no directory the repo has", () => {
    expect(cited(HERE, comment("`tests/behavioral.json` in the artifact"))).toEqual([]);
  });

  test("is prose under a gitignored root, whether or not the tree has been built", () => {
    for (const root of ["dist", ".types", "data", "capabilities", "node_modules"]) {
      expect(cited(HERE, comment(`\`${root}/nothing.ts\``))).toEqual([]);
    }
  });

  test("is read root-absolute, and spelled with any case of extension", () => {
    expect(cited(HERE, comment("`/design/styles/index.css`"))).toEqual([]);
    expect(cited(HERE, comment("`/scripts/comment-ledger.ts`"))).toEqual([
      "/scripts/comment-ledger.ts",
    ]);
    expect(cited(HERE, comment("`scripts/Comment-Ledger.TS`"))).toEqual([
      "scripts/Comment-Ledger.TS",
    ]);
  });

  test("is read behind an extension the source tree does not use", () => {
    expect(cited(HERE, comment("`scripts/nothing.yml` and `scripts/nothing.sh`"))).toEqual([
      "scripts/nothing.yml",
      "scripts/nothing.sh",
    ]);
  });

  test("is read from a comment trailing code, but not from a string or a URL", () => {
    expect(cited(HERE, `const a = 1; // see \`${GONE}\`\n`)).toEqual([GONE]);
    expect(cited(HERE, `const s = "// ${GONE}";\n`)).toEqual([]);
    expect(cited(HERE, `const u = "https://example.test/a/${GONE}";\n`)).toEqual([]);
  });

  test("is prose when it is a URL, a package specifier, or spelled relative", () => {
    expect(cited(HERE, comment("https://example.test/a/b/nothing.ts"))).toEqual([]);
    expect(cited(HERE, comment("`#design/desk-geometry.js`"))).toEqual([]);
    expect(cited(HERE, comment("`./comment-ledger.ts`"))).toEqual([]);
  });

  test("goes unread outside a comment", () => {
    expect(cited(HERE, `const path = "${GONE}";\n`)).toEqual([]);
  });
});

describe("a relative markdown link in a comment", () => {
  test("passes when it resolves from the citing file and fails when it does not", () => {
    expect(cited(HERE, comment("[the budget](./comment-budget.ts)"))).toEqual([]);
    expect(cited(HERE, comment("[the ledger](./comment-ledger.ts)"))).toEqual([
      "./comment-ledger.ts",
    ]);
  });

  test("climbs out of the citing directory the way the file system does", () => {
    expect(cited(HERE, comment("[the readme](../README.md)"))).toEqual([]);
  });
});

describe("a file that is meant to be missing", () => {
  test("passes once the marker stands on the same comment line", () => {
    expect(cited(HERE, comment(`\`${GONE}\` ${ABSENT_MARKER} was deleted on purpose`))).toEqual([]);
    expect(cited(HERE, comment(`\`${GONE}\` was deleted on purpose`))).toEqual([GONE]);
  });

  test("is not covered by a marker on some other line", () => {
    const source = `// ${ABSENT_MARKER}\n// \`${GONE}\`\nconst a = 1;\n`;
    expect(cited(HERE, source)).toEqual([GONE]);
  });

  test("excuses the one citation it follows, not everything beside it", () => {
    const line = `\`${REAL}\` ${ABSENT_MARKER} unlike \`${GONE}\``;
    expect(cited(HERE, comment(line))).toEqual([GONE]);
  });

  test("is a marker only where a citation precedes it, not wherever the word appears", () => {
    const line = `the row is ${ABSENT_MARKER} when the tier is off; see \`${GONE}\``;
    expect(cited(HERE, comment(line))).toEqual([GONE]);
  });
});

describe("the repository", () => {
  test("cites nothing that has moved away", () => {
    expect(auditRepository().map((one) => `${one.file}:${one.line} ${one.cited}`)).toEqual([]);
  });
});
