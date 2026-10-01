import { describe, expect, test } from "bun:test";
import { compoundFileNames, isCompoundFile } from "./compound-file.ts";
import { compoundFileOf, LOCKED_WORD_STREAMS, readerOf } from "./office-samples.test-support.ts";

const namesOf = (bytes: Uint8Array) => compoundFileNames(readerOf(bytes), bytes.byteLength);

describe("a compound file", () => {
  test("is known by its first eight bytes", () => {
    expect(isCompoundFile(compoundFileOf(["WordDocument"]))).toBe(true);
    expect(isCompoundFile(new TextEncoder().encode("PK\u0003\u0004...."))).toBe(false);
    expect(isCompoundFile(compoundFileOf([]).subarray(0, 7))).toBe(false);
  });

  test("names every entry in its directory, across several sectors", async () => {
    const names = ["WordDocument", "1Table", ...LOCKED_WORD_STREAMS, "Data", "ObjectPool"];
    expect(await namesOf(compoundFileOf(names))).toEqual(["Root Entry", ...names]);
  });

  test("is followed through a FAT the DIFAT chain lists", async () => {
    const far = compoundFileOf(LOCKED_WORD_STREAMS, { directoryAt: 128 * 110 });
    expect(new DataView(far.buffer).getUint32(0x48, true)).toBeGreaterThan(0);
    expect(await namesOf(far)).toEqual(["Root Entry", ...LOCKED_WORD_STREAMS]);
  });

  test("reads only the FAT and DIFAT sectors its directory's chain passes through", async () => {
    const far = compoundFileOf(LOCKED_WORD_STREAMS, { directoryAt: 128 * 110 });
    const reads: number[] = [];
    const counted = (start: number, length: number) => {
      reads.push(length);
      return readerOf(far)(start, length);
    };
    expect(await compoundFileNames(counted, far.byteLength)).toHaveLength(4);
    // The header, the DIFAT sector, the one FAT sector the chain needs, and the directory.
    expect(reads).toHaveLength(4);
  });

  test("answers nothing for a directory that loops, runs off the file, or a broken header", async () => {
    expect(await namesOf(compoundFileOf(["a"], { loop: true }))).toBeUndefined();
    const whole = compoundFileOf(LOCKED_WORD_STREAMS);
    expect(await namesOf(whole.subarray(0, whole.byteLength - 512))).toBeUndefined();
    const broken = (offset: number, value: number) => {
      const bytes = whole.slice();
      new DataView(bytes.buffer).setUint16(offset, value, true);
      return bytes;
    };
    const brokenFields = [
      broken(0x1c, 0xfeff),
      broken(0x1e, 10),
      broken(0x2c, 0xffff),
      broken(0x48, 1),
    ];
    for (const bytes of brokenFields) {
      expect(await namesOf(bytes)).toBeUndefined();
    }
    expect(await namesOf(whole.subarray(0, 511))).toBeUndefined();
  });
});
