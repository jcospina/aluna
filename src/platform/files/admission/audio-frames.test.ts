import { describe, expect, test } from "bun:test";
import {
  adtsFrame,
  FrameScan,
  ID3_HEADER_BYTES,
  MAX_TAG_BYTES,
  MAX_TAGS,
  mpegAudioFrame,
  RESYNC_BYTES,
  RESYNC_FRAMES,
} from "./audio-frames.ts";
import { adtsHeader, concatBytes, frameRun, id3Tag, mp3File } from "./sample-files.test-support.ts";

const lengthOf = (header: readonly number[]) => mpegAudioFrame(new Uint8Array(header), 0)?.length;

describe("an MPEG audio frame header", () => {
  test("gives each version's and layer's frame length, padding included", () => {
    expect(lengthOf([0xff, 0xfb, 0x90, 0x00])).toBe(417);
    expect(lengthOf([0xff, 0xfb, 0x92, 0x00])).toBe(418);
    expect(lengthOf([0xff, 0xff, 0x10, 0x00])).toBe(32);
    expect(lengthOf([0xff, 0xff, 0x12, 0x00])).toBe(36);
    expect(lengthOf([0xff, 0xfd, 0xa4, 0x00])).toBe(576);
    expect(lengthOf([0xff, 0xf3, 0x80, 0x00])).toBe(208);
    expect(lengthOf([0xff, 0xf7, 0x10, 0x00])).toBe(68);
    expect(lengthOf([0xff, 0xf5, 0x10, 0x00])).toBe(52);
    expect(lengthOf([0xff, 0xe3, 0x10, 0x00])).toBe(52);
  });

  test("with a reserved version, layer or sample rate, a free or bad bitrate, is none", () => {
    for (const header of [
      [0xff, 0xeb, 0x90, 0x00],
      [0xff, 0xf9, 0x90, 0x00],
      [0xff, 0xfb, 0x00, 0x00],
      [0xff, 0xfb, 0xf0, 0x00],
      [0xff, 0xfb, 0x9c, 0x00],
      [0xff, 0xdb, 0x90, 0x00],
      [0xfe, 0xfb, 0x90, 0x00],
    ]) {
      expect(lengthOf(header)).toBeUndefined();
    }
    expect(mpegAudioFrame(new Uint8Array([0xff, 0xfb, 0x90]), 0)).toBeUndefined();
  });
});

describe("an ADTS frame header", () => {
  test("gives the length it states, which must hold the header and its CRC", () => {
    expect(adtsFrame(new Uint8Array(adtsHeader(371)), 0)?.length).toBe(371);
    expect(adtsFrame(new Uint8Array(adtsHeader(6)), 0)).toBeUndefined();
    const crc = adtsHeader(8);
    crc[1] = 0xf0;
    expect(adtsFrame(new Uint8Array([...crc, 0, 0]), 0)).toBeUndefined();
    crc[4] = 0x02;
    expect(adtsFrame(new Uint8Array([...crc, 0, 0]), 0)?.length).toBe(16);
  });

  test("holds a header alone, at the table's last sample rate", () => {
    expect(adtsFrame(new Uint8Array(adtsHeader(7)), 0)?.length).toBe(7);
    const lowest = adtsHeader(371);
    lowest[2] = 0x40 | (12 << 2);
    expect(adtsFrame(new Uint8Array(lowest), 0)?.length).toBe(371);
  });

  test("without its sync byte, or cut short, is none", () => {
    const unsynced = adtsHeader(371);
    unsynced[0] = 0xfe;
    expect(adtsFrame(new Uint8Array(unsynced), 0)).toBeUndefined();
    expect(adtsFrame(new Uint8Array(adtsHeader(371).slice(0, 6)), 0)).toBeUndefined();
  });

  test("with a sample rate the table lacks, or an MPEG layer, is none", () => {
    const rate = adtsHeader(371);
    rate[2] = 0x50 | (13 << 2);
    expect(adtsFrame(new Uint8Array(rate), 0)).toBeUndefined();
    const layered = adtsHeader(371);
    layered[1] = 0xf3;
    expect(adtsFrame(new Uint8Array(layered), 0)).toBeUndefined();
  });
});

describe("a frame scan", () => {
  const scan = (bytes: Uint8Array, windowBytes = 4096, chunkSize = bytes.byteLength) => {
    const frames = new FrameScan([mpegAudioFrame, adtsFrame], windowBytes);
    for (let at = 0; at < bytes.byteLength; at += chunkSize) {
      const found = frames.feed(bytes.subarray(at, at + chunkSize));
      if (found !== undefined) return found;
    }
    return frames.finish();
  };
  const withTag = (tag: Uint8Array, frames = 8) => concatBytes(tag, mp3File(undefined, frames));

  test("names the reader two frames in a row are read by", () => {
    expect(scan(mp3File())).toBe(0);
    expect(scan(frameRun(adtsHeader(300), 300, 4))).toBe(1);
  });

  test("looks where the sound starts, past its tags and padding, or a little on for a longer run", () => {
    expect(scan(concatBytes(id3Tag(512), new Uint8Array(3000), mp3File()))).toBe(0);
    const junk = (bytes: number, frames: number) =>
      concatBytes(new Uint8Array(bytes).fill(0x41), mp3File(undefined, frames));
    expect(scan(junk(3, RESYNC_FRAMES))).toBe(0);
    expect(scan(junk(3, RESYNC_FRAMES - 1))).toBeNull();
    expect(scan(junk(RESYNC_BYTES, 8), 8192)).toBeNull();
    // A Mach-O whose code holds two Layer I headers 36 bytes apart.
    const code = new Uint8Array(4096).fill(0x41);
    code.set([0xcf, 0xfa, 0xed, 0xfe]);
    code.set([0xff, 0xff, 0x17, 0x00], 1000);
    code.set([0xff, 0xff, 0x17, 0x00], 1036);
    expect(scan(code)).toBeNull();
  });

  test("skips every tag in a row, whatever the chunks", () => {
    const tags = concatBytes(id3Tag(100), id3Tag(70_000), mp3File());
    for (const chunkSize of [1, 9, 10, 11, 5000, tags.byteLength]) {
      expect(scan(tags, 4096, chunkSize)).toBe(0);
    }
  });

  test("skips a footer only where an ID3v2.4 tag says it has one", () => {
    const footer = id3Tag(600, 4, 0x10).subarray(0, 10);
    footer.set([0x33, 0x44, 0x49]);
    expect(scan(concatBytes(id3Tag(600, 4, 0x10), footer, mp3File()))).toBe(0);
    expect(scan(withTag(id3Tag(600, 3, 0x10)))).toBe(0);
    expect(scan(withTag(id3Tag(600, 4)))).toBe(0);
  });

  test("reads a malformed tag header as no tag, which the sound starts behind", () => {
    const revised = id3Tag(20);
    revised[4] = 0xff;
    const unsafe = id3Tag(0x94);
    unsafe.set([0, 0, 0, 0x94], 6);
    const edge = id3Tag(0x100);
    edge.set([0, 0, 1, 0x80], 6);
    const misspelt = [0, 1, 2].map((at) => {
      const tag = id3Tag(20);
      tag[at] = 0x58;
      return tag;
    });
    for (const tag of [revised, unsafe, edge, id3Tag(20, 5), id3Tag(20, 1), ...misspelt]) {
      expect(scan(withTag(tag, 3))).toBeNull();
    }
    expect(scan(withTag(id3Tag(20, 2), 3))).toBe(0);
  });

  test("gives up on a body of too many tags, or of tags that claim too much of it", () => {
    const tags = (count: number) =>
      concatBytes(...Array.from({ length: count }, () => id3Tag(0)), mp3File());
    expect(scan(tags(MAX_TAGS + 1))).toBeNull();
    expect(scan(tags(MAX_TAGS))).toBe(0);
    const claims = new FrameScan([mpegAudioFrame], 4096);
    const huge = id3Tag(0);
    huge.set([0x7f, 0x7f, 0x7f, 0x7f], 6);
    expect(claims.feed(huge)).toBeNull();
    expect(scan(withTag(id3Tag(MAX_TAG_BYTES - ID3_HEADER_BYTES)))).toBe(0);
  });

  test("answers null once its window is full without two frames", () => {
    const frames = new FrameScan([mpegAudioFrame], 16);
    expect(frames.feed(new Uint8Array(15))).toBeUndefined();
    expect(frames.feed(new Uint8Array(1))).toBeNull();
  });

  test("reads no frame whose next header falls past its window", () => {
    expect(scan(mp3File(), 417 + 4)).toBe(0);
    expect(scan(mp3File(), 417 + 3)).toBeNull();
  });
});
