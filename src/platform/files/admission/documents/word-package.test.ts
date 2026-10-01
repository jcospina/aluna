import { describe, expect, test } from "bun:test";
import {
  compoundFileOf,
  contentTypes,
  LOCKED_WORD_STREAMS,
  MAIN_PART,
  MAIN_PART_TYPES,
  officePackage,
  PRESUPUESTO_DOCX,
  packageOf,
  readerOf,
  relationships,
  SAVED_DOC,
  SAVED_DOCX,
  zipOf,
} from "./office-samples.test-support.ts";
import { MAX_CONTENT_TYPES_BYTES, TYPES_NAMESPACE, wordPackageOf } from "./word-package.ts";

const packageKind = (bytes: Uint8Array) => wordPackageOf(readerOf(bytes), bytes.byteLength);

/** `text` as UTF-16LE with its byte-order mark. */
function utf16(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  const data = new DataView(bytes.buffer);
  data.setUint16(0, 0xfeff, true);
  for (let at = 0; at < text.length; at++) data.setUint16(2 + at * 2, text.charCodeAt(at), true);
  return bytes;
}

const WORD = MAIN_PART_TYPES.docx;

describe("a file named .docx", () => {
  test("holds a Word document when its main part is declared the main document", async () => {
    for (const bytes of [SAVED_DOCX, PRESUPUESTO_DOCX, officePackage("docx")]) {
      expect(await packageKind(bytes)).toBe("word");
    }
  });

  test("is read as OPC allows: UTF-16, single quotes, references, any case, or by default", async () => {
    const byDefault = contentTypes("application/xml").replace(
      'ContentType="application/xml"/>',
      `ContentType="${WORD}"/>`,
    );
    const variants = [
      packageOf(utf16(contentTypes(WORD).replace('encoding="UTF-8"', 'encoding="UTF-16"'))),
      packageOf(utf16(contentTypes(WORD).replace('encoding="UTF-8" ', ""))),
      packageOf(contentTypes(WORD).replaceAll('"', "'")),
      packageOf(contentTypes(WORD.replace("+", "&#43;"))),
      packageOf(contentTypes(WORD.toUpperCase())),
      packageOf(contentTypes(WORD), relationships(`/${MAIN_PART}`)),
      packageOf(byDefault.replace(/<Override[^>]*\/>/, "")),
    ];
    for (const [index, bytes] of variants.entries()) {
      expect(await packageKind(bytes), `variant ${index}`).toBe("word");
    }
  });

  test("holds something else when it is a macro document, a template or a spreadsheet", async () => {
    for (const format of ["docm", "dotx", "xlsx"] as const) {
      expect(await packageKind(officePackage(format)), format).toBe("other");
    }
  });

  test("holds something else when the Word type is declared for a part that is not the main one", async () => {
    const decoys = [
      contentTypes(
        MAIN_PART_TYPES.xlsx,
        `<Override PartName="/nowhere.xml" ContentType="${WORD}"/>`,
      ),
      contentTypes(
        MAIN_PART_TYPES.docm,
        `<!-- <Override PartName="/${MAIN_PART}" ContentType="${WORD}"/> -->`,
      ),
      contentTypes(MAIN_PART_TYPES.docm).replace(
        "<Override ",
        `<Override Foo=" ContentType='${WORD}'" `,
      ),
      `<Types><Override PartName="/${WORD}" ContentType="application/xml"/></Types>`,
    ];
    for (const [index, types] of decoys.entries()) {
      expect(await packageKind(packageOf(types)), `decoy ${index}`).toBe("other");
    }
  });

  test("holds something else when its relationships name no single main part", async () => {
    const second = relationships(MAIN_PART).match(/<Relationship [^>]*\/>/)?.[0] ?? "";
    const external = relationships().replace("/>", ' TargetMode="External"/>');
    for (const rels of [
      relationships(MAIN_PART, second.replace("rId1", "rId2")),
      external,
      "<x/>",
    ]) {
      expect(await packageKind(packageOf(contentTypes(WORD), rels))).toBe("other");
    }
    const noRels = zipOf([{ name: "[Content_Types].xml", data: contentTypes(WORD) }]);
    expect(await packageKind(noRels)).toBe("other");
  });

  test("is locked when it is the compound file Office wraps an encrypted one in", async () => {
    expect(await packageKind(compoundFileOf(LOCKED_WORD_STREAMS))).toBe("locked");
    expect(await packageKind(compoundFileOf(["WordDocument", "1Table"]))).toBe("other");
    expect(await packageKind(SAVED_DOC)).toBe("other");
  });

  test("holds something else when its content types are missing or too long to read", async () => {
    expect(await packageKind(zipOf([{ name: MAIN_PART, data: "<w/>" }]))).toBe("other");
    const padded = `${contentTypes(WORD)}${" ".repeat(MAX_CONTENT_TYPES_BYTES)}`;
    expect(await packageKind(packageOf(padded))).toBe("other");
    expect(await packageKind(new TextEncoder().encode("PK\u0003\u0004 and nothing else"))).toBe(
      "other",
    );
  });
});

describe("a .docx read as a strict XML reader reads it", () => {
  test("holds something else when its main part is named in a form readers resolve differently", async () => {
    const sheet = "xl/workbook.xml";
    const types = contentTypes(MAIN_PART_TYPES.xlsx)
      .replace(`/${MAIN_PART}`, `/${sheet}`)
      .replace(
        'Extension="xml" ContentType="application/xml"',
        `Extension="xml" ContentType="${WORD}"`,
      );
    for (const target of [
      "xl/../xl/workbook.xml",
      "./xl/./workbook.xml",
      "xl/%77orkbook.xml",
      "xl\\workbook.xml",
      "/xl//workbook.xml",
      "http://example.com/xl/workbook.xml",
      "../xl/workbook.xml",
    ]) {
      expect(await packageKind(packageOf(types, relationships(target))), target).toBe("other");
    }
    const leading = relationships(`./${MAIN_PART}`);
    expect(await packageKind(packageOf(contentTypes(WORD), leading))).toBe("word");
  });

  test("holds something else when its XML holds anything an XML reader might read otherwise", async () => {
    const docm = contentTypes(MAIN_PART_TYPES.docm);
    const decoys = [
      docm.replace("<Override ", '<Override xmlns:é="urn:x" '),
      docm.replace("<Override ", `<?junk <!-- ?><Override `),
      contentTypes(
        MAIN_PART_TYPES.xlsx,
        `<![CDATA[<Override PartName="/${MAIN_PART}" ContentType="${WORD}"/>]]>`,
      ),
      contentTypes(MAIN_PART_TYPES.xlsx).replace(
        "<Override ",
        `<e:Override xmlns:e="urn:evil" PartName="/${MAIN_PART}" ContentType="${WORD}"/><Override `,
      ),
      contentTypes(
        WORD,
        `<Override PartName="/${MAIN_PART}" ContentType="${MAIN_PART_TYPES.docm}"/>`,
      ),
      contentTypes(WORD).replace("<Types ", "<!DOCTYPE Types><Types "),
      contentTypes(WORD).replace("</Types>", "text</Types>"),
      contentTypes(WORD).replace("</Types>", ""),
      contentTypes(WORD).replace(TYPES_NAMESPACE, "urn:elsewhere"),
    ];
    for (const [index, types] of decoys.entries()) {
      expect(await packageKind(packageOf(types)), `decoy ${index}`).toBe("other");
    }
  });

  test("reads an unclosed comment in a megabyte of content types in one pass", async () => {
    const started = performance.now();
    const comments = "<!--".repeat(MAX_CONTENT_TYPES_BYTES / 4 - 1);
    for (const [types, rels] of [
      [comments, relationships()],
      [contentTypes(WORD), comments],
    ] as const) {
      expect(await packageKind(packageOf(types, rels))).toBe("other");
    }
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("a .docx whose names, declaration and relationships are read strictly", () => {
  test("holds something else when a child declares a namespace, or a declaration an encoding", async () => {
    const docm = contentTypes(MAIN_PART_TYPES.docm).replace(
      `<Override PartName="/${MAIN_PART}" ContentType="${MAIN_PART_TYPES.docm}"/>`,
      "",
    );
    const asDocm = docm.replace(
      'Extension="xml" ContentType="application/xml"',
      `Extension="xml" ContentType="${MAIN_PART_TYPES.docm}"`,
    );
    for (const namespace of ['xmlns="urn:x"', 'xmlns=""']) {
      const types = asDocm.replace(
        "</Types>",
        `<Override ${namespace} PartName="/${MAIN_PART}" ContentType="${WORD}"/></Types>`,
      );
      expect(await packageKind(packageOf(types)), namespace).toBe("other");
    }
    for (const declaration of ['encoding="UTF-7"', 'encoding="UTF-16"', 'encoding="ISO-8859-1"']) {
      const types = contentTypes(WORD).replace('encoding="UTF-8"', declaration);
      expect(await packageKind(packageOf(types)), declaration).toBe("other");
    }
    const unterminated = contentTypes(WORD).replace('standalone="yes"?>', 'standalone="yes">');
    const stylesheet = contentTypes(WORD).replace("?>", '?><?xml-stylesheet href="a"?>');
    for (const types of [unterminated, stylesheet]) {
      expect(await packageKind(packageOf(types))).toBe("other");
    }
  });

  test("holds something else when a name holds what OPC leaves out", async () => {
    const kelvin = "word/\u212Aey.xml";
    const ascii = contentTypes(WORD).replace(`/${MAIN_PART}`, "/word/key.xml");
    const relationshipsFor = (target: string) => relationships(target);
    const cases = [
      [ascii, relationshipsFor(kelvin)],
      [contentTypes(WORD).replace(`/${MAIN_PART}`, `/${kelvin}`), relationshipsFor("word/key.xml")],
      [
        contentTypes(WORD).replace(`/${MAIN_PART}`, `/ ${MAIN_PART}`),
        relationshipsFor(` ${MAIN_PART}`),
      ],
      [contentTypes(WORD), relationshipsFor(`${MAIN_PART}/.`)],
      [contentTypes(WORD), relationshipsFor(`${MAIN_PART}/x/..`)],
      [contentTypes(WORD), relationshipsFor("word/document.")],
    ] as const;
    for (const [types, rels] of cases) {
      expect(await packageKind(packageOf(types, rels))).toBe("other");
    }
  });

  test("holds something else for whitespace or a reference XML would not read", async () => {
    const values = ["&foo;", "a & b", "&#X61;", "&#1;", "\u0001"];
    for (const value of values) {
      const types = contentTypes(WORD).replace(
        'Extension="rels"',
        `Extension="rels" Note="${value}"`,
      );
      expect(await packageKind(packageOf(types)), value).toBe("other");
    }
    const nbsp = contentTypes(WORD).replace("<Override PartName", "<Override\u00A0PartName");
    expect(await packageKind(packageOf(nbsp))).toBe("other");
  });

  test("reads relationships by their exact type, each named once, inside the package", async () => {
    const evil = relationships().replace(
      "http://schemas.openxmlformats.org/officeDocument/2006",
      "urn:evil",
    );
    const twice = relationships(MAIN_PART, '<Relationship Id="rId1" Type="urn:x" Target="a.xml"/>');
    const unnamed = relationships().replace('Id="rId1" ', "");
    for (const rels of [evil, twice, unnamed]) {
      expect(await packageKind(packageOf(contentTypes(WORD), rels))).toBe("other");
    }
    const internal = relationships().replace("/>", ' TargetMode="Internal"/>');
    expect(await packageKind(packageOf(contentTypes(WORD), internal))).toBe("word");
  });
});

describe("a .docx whose elements are told apart by name, as an XML reader tells them", () => {
  const docmByDefault = (extra: string) =>
    contentTypes(MAIN_PART_TYPES.docm)
      .replace(/<Override [^>]*\/>/, "")
      .replace(
        'Extension="xml" ContentType="application/xml"',
        `Extension="xml" ContentType="${MAIN_PART_TYPES.docm}"`,
      )
      .replace("</Types>", `${extra}</Types>`);

  test("holds something else when an element carries another element's attributes", async () => {
    for (const extra of [
      `<Default Extension="bin" PartName="/${MAIN_PART}" ContentType="${WORD}"/>`,
      `<Override Extension="xml" ContentType="${WORD}"/>`,
      `<Override PartName="/other.xml" Extension="xml" ContentType="${WORD}"/>`,
    ]) {
      expect(await packageKind(packageOf(docmByDefault(extra))), extra).toBe("other");
    }
  });

  test("takes a default from the part's last segment, and none for a segment with no dot", async () => {
    const cases = [
      ["word.xml/document", `<Default Extension="xml/document" ContentType="${WORD}"/>`],
      ["word/document", `<Default Extension="/word/document" ContentType="${WORD}"/>`],
      ["word/document", `<Default Extension="document" ContentType="${WORD}"/>`],
    ] as const;
    for (const [target, extra] of cases) {
      const types = docmByDefault(extra);
      expect(await packageKind(packageOf(types, relationships(target))), target).toBe("other");
    }
  });

  test("holds something else for a target with a colon, bytes that aren't whole, or a declaration out of order", async () => {
    const colon = contentTypes(WORD).replace(`/${MAIN_PART}`, "/word:x/document.xml");
    expect(await packageKind(packageOf(colon, relationships("word:x/document.xml")))).toBe("other");
    const invalidUtf8 = new Uint8Array([
      ...new TextEncoder().encode(contentTypes(WORD).slice(0, -8)),
      0xff,
      ...new TextEncoder().encode("</Types>"),
    ]);
    const doubleBom = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode(contentTypes(WORD)),
    ]);
    const oddUtf16 = new Uint8Array([
      ...utf16(contentTypes(WORD).replace('encoding="UTF-8" ', "")),
      0x20,
    ]);
    const surrogates = contentTypes(WORD).replace(
      'Extension="rels"',
      'Extension="rels" Note="&#xD83D;&#xDE00;"',
    );
    const noVersion = contentTypes(WORD).replace('version="1.0" ', "");
    const unknown = contentTypes(WORD).replace('standalone="yes"', 'foo="bar"');
    const reordered = contentTypes(WORD).replace(
      'encoding="UTF-8" standalone="yes"',
      'standalone="yes" encoding="UTF-8"',
    );
    for (const types of [
      invalidUtf8,
      doubleBom,
      oddUtf16,
      surrogates,
      noVersion,
      unknown,
      reordered,
    ]) {
      expect(await packageKind(packageOf(types))).toBe("other");
    }
    const spacedId = relationships().replace('Id="rId1"', 'Id="r Id1"');
    expect(await packageKind(packageOf(contentTypes(WORD), spacedId))).toBe("other");
  });

  test("holds something else for a default whose extension holds what OPC leaves out", async () => {
    const kelvin = docmByDefault(
      `<Default Extension="\u212Aml" ContentType="${MAIN_PART_TYPES.docm}"/><Default Extension="kml" ContentType="${WORD}"/>`,
    );
    expect(await packageKind(packageOf(kelvin, relationships("word/document.kml")))).toBe("other");
  });

  test("reads a package whose other parts escape a non-ASCII name", async () => {
    const escaped = contentTypes(
      WORD,
      '<Override PartName="/word/media/imag%C3%A9.xml" ContentType="application/xml"/>',
    );
    expect(await packageKind(packageOf(escaped))).toBe("word");
  });
});
