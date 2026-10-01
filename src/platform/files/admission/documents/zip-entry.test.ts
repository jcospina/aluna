import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { readerOf, type ZipPart, zipOf } from "./office-samples.test-support.ts";
import { MAX_CENTRAL_DIRECTORY_BYTES, readZipEntry } from "./zip-entry.ts";

const CAP = 1024;
const TYPES = "[Content_Types].xml";
const XML = "<Types/>";

function entryOf(zip: Uint8Array, name = TYPES, cap = CAP) {
  return readZipEntry(readerOf(zip), zip.byteLength, name, cap);
}

const text = (bytes: Uint8Array | undefined) => bytes && new TextDecoder().decode(bytes);

describe("a zip entry", () => {
  test("is read deflated or stored, by its name in any case, past a comment", async () => {
    const parts: ZipPart[] = [
      { name: "word/document.xml", data: "<w/>" },
      { name: TYPES, data: XML },
    ];
    expect(text(await entryOf(zipOf(parts)))).toBe(XML);
    expect(text(await entryOf(zipOf([{ name: TYPES, data: XML, stored: true }])))).toBe(XML);
    expect(text(await entryOf(zipOf(parts), "[content_types].XML"))).toBe(XML);
    expect(text(await entryOf(zipOf(parts, "saved by a word processor")))).toBe(XML);
  });

  test("is not read when missing, named twice, or encrypted", async () => {
    expect(await entryOf(zipOf([{ name: "other.xml", data: XML }]))).toBeUndefined();
    const twice = zipOf([
      { name: TYPES, data: XML },
      { name: "[CONTENT_TYPES].xml", data: XML },
    ]);
    expect(await entryOf(twice)).toBeUndefined();
    expect(
      await entryOf(zipOf([{ name: TYPES, data: XML, listed: { flags: 1 } }])),
    ).toBeUndefined();
  });

  test("is inflated under its cap, whatever its directory claims", async () => {
    const bomb = "a".repeat(1_000_000);
    expect(deflateRawSync(bomb).byteLength).toBeLessThan(CAP);
    expect(await entryOf(zipOf([{ name: TYPES, data: bomb }]))).toBeUndefined();
    const lying = zipOf([{ name: TYPES, data: bomb, listed: { size: 10 } }]);
    expect(await entryOf(lying)).toBeUndefined();
    const fits = "x".repeat(CAP);
    expect(text(await entryOf(zipOf([{ name: TYPES, data: fits }])))).toBe(fits);
  });

  test("reads no more than its cap, however large a stored size its directory claims", async () => {
    const claims = 200_000;
    const zip = zipOf([
      { name: TYPES, data: XML, listed: { compressed: claims } },
      { name: "word/media/image1.png", data: new Uint8Array(claims + 10_000), stored: true },
    ]);
    const lengths: number[] = [];
    const counted = (start: number, length: number) => {
      lengths.push(length);
      return readerOf(zip)(start, length);
    };
    expect(await readZipEntry(counted, zip.byteLength, TYPES, CAP)).toBeUndefined();
    expect(Math.max(...lengths)).toBeLessThan(claims);
  });

  test("is not read where its local header disagrees with the directory", async () => {
    const renamed = zipOf([{ name: TYPES, data: XML, localName: "[Content_Types].xmX" }]);
    expect(await entryOf(renamed)).toBeUndefined();
    const stored = zipOf([{ name: TYPES, data: XML, stored: true }]);
    const deflatedLocally = stored.slice();
    new DataView(deflatedLocally.buffer).setUint16(8, 8, true);
    expect(await entryOf(deflatedLocally)).toBeUndefined();
    const locked = stored.slice();
    new DataView(locked.buffer).setUint16(6, 1, true);
    expect(await entryOf(locked)).toBeUndefined();
  });

  test("is not read beside a name another reader would take for it", async () => {
    for (const twin of [`${TYPES}\u0000`, `/${TYPES}`, `\\${TYPES}`]) {
      const zip = zipOf([
        { name: TYPES, data: XML },
        { name: twin, data: "<Types/>" },
      ]);
      expect(await entryOf(zip), JSON.stringify(twin)).toBeUndefined();
    }
  });

  test("is not read under any name but its own, ASCII case aside", async () => {
    for (const lookalike of [`/${TYPES}`, `\\${TYPES}`]) {
      expect(await entryOf(zipOf([{ name: lookalike, data: XML }])), lookalike).toBeUndefined();
    }
    const rels = zipOf([
      { name: "_rels/.rels", data: XML },
      { name: "_rels\\.rels", data: XML },
    ]);
    expect(await entryOf(rels, "_rels/.rels")).toBeUndefined();
  });

  test("is refused when its bytes don't match its CRC or its sizes", async () => {
    for (const listed of [{ crc: 1 }, { size: XML.length + 1 }, { compressed: 1 }]) {
      expect(await entryOf(zipOf([{ name: TYPES, data: XML, listed }]))).toBeUndefined();
    }
  });

  test("is not read from a zip cut short, with trailing bytes, or spanning disks", async () => {
    const zip = zipOf([{ name: TYPES, data: XML }]);
    expect(await entryOf(zip.subarray(0, zip.byteLength - 1))).toBeUndefined();
    expect(await entryOf(new Uint8Array([...zip, 0]))).toBeUndefined();
    const disk = zip.slice();
    new DataView(disk.buffer).setUint16(disk.byteLength - 18, 1, true);
    expect(await entryOf(disk)).toBeUndefined();
    const zip64 = zip.slice();
    new DataView(zip64.buffer).setUint32(zip64.byteLength - 6, 0xffffffff, true);
    expect(await entryOf(zip64)).toBeUndefined();
    expect(await entryOf(new TextEncoder().encode("not a zip at all"))).toBeUndefined();
  });

  test("is not read where readers would find another directory than this one", async () => {
    const parts: ZipPart[] = [
      { name: TYPES, data: XML },
      { name: "word/document.xml", data: "<w/>" },
    ];
    const fakeEnd = "PK\u0005\u0006".padEnd(22, "\u0000");
    const signedComment = zipOf(parts, `${fakeEnd}x`);
    const countShort = zipOf(parts);
    new DataView(countShort.buffer).setUint16(countShort.byteLength - 14, 1, true);
    new DataView(countShort.buffer).setUint16(countShort.byteLength - 12, 1, true);
    const whole = zipOf(parts);
    const gap = new Uint8Array([
      ...whole.subarray(0, whole.byteLength - 22),
      ...new Uint8Array(10),
      ...whole.subarray(whole.byteLength - 22),
    ]);
    const locator = zipOf([...parts, { name: "x/PK\u0006\u0007abcdefghijklmnop", data: "" }]);
    const lateSignature = zipOf(parts, "xxxxPK\u0005\u0006yyyy");
    const cases = { signedComment, countShort, gap, locator, lateSignature };
    for (const [label, zip] of Object.entries(cases)) {
      expect(await entryOf(zip), label).toBeUndefined();
    }
    expect(text(await entryOf(zipOf(parts, "saved")))).toBe(XML);
  });

  test("is not read from a directory longer than the cap", async () => {
    const zip = zipOf([{ name: TYPES, data: XML }]);
    const huge = zip.slice();
    new DataView(huge.buffer).setUint32(
      huge.byteLength - 10,
      MAX_CENTRAL_DIRECTORY_BYTES + 1,
      true,
    );
    expect(await entryOf(huge)).toBeUndefined();
  });
});
