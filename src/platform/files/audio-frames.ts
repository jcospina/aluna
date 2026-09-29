// The frame test admission reads an MP3 or an ADTS AAC by (Module 7 PLAN decision 3). Such a
// file is a run of frames with no container, often behind ID3v2 tags, whose lengths are in their
// ten-byte headers and which cover art makes larger than any head admission holds. So the scan
// skips each tag without holding it, then any zero padding, and there must find a frame whose next
// frame follows where its length says, as the WHATWG MIME sniffing standard does for MP3. Machine
// code and fonts hold such pairs further on, so a rip cut mid-frame is found a little further on
// only by a longer run. The tags may claim {@link MAX_TAG_BYTES} between them, all of which
// arrives before the window after them can refuse the file. A leaf: it imports nothing.

/** A frame's length and its form, which the frame after it must share. */
interface Frame {
  readonly length: number;
  readonly form: number;
}

/** Reads the frame header at `at`, or undefined where none starts. */
export type FrameReader = (bytes: Uint8Array, at: number) => Frame | undefined;

export const ID3_HEADER_BYTES = 10;

/** The most tags, and the most of a body they may claim, before the sound must start. */
export const MAX_TAGS = 4;
export const MAX_TAG_BYTES = 16 * 1024 * 1024;

/** How far past the tags a sound cut mid-frame may start, and how many frames must then run. */
export const RESYNC_BYTES = 2048;
export const RESYNC_FRAMES = 4;

/** Where the ID3v2 tag `head` opens with ends, or undefined when it opens with none. */
function id3v2End(head: Uint8Array): number | undefined {
  if (head.byteLength < ID3_HEADER_BYTES) return undefined;
  const [i, d, three, major = 0, revision, flags = 0, ...size] = head;
  if (i !== 0x49 || d !== 0x44 || three !== 0x33) return undefined;
  if (major < 2 || major > 4 || revision === 0xff || size.some((byte) => byte >= 0x80)) {
    return undefined;
  }
  const length = size.reduce((total, byte) => total * 128 + byte, 0);
  const footer = major === 4 && (flags & 0x10) !== 0 ? ID3_HEADER_BYTES : 0;
  return ID3_HEADER_BYTES + length + footer;
}

const MPEG1_BITRATES = [
  [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
];
const MPEG2_BITRATES = [
  [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
];
const MPEG1_RATES = [44_100, 48_000, 32_000];

/**
 * An MPEG audio frame header: eleven sync bits, then no reserved version, layer, bitrate or sample
 * rate. A free-format frame gives no length, so it is not one.
 */
export const mpegAudioFrame: FrameReader = (bytes, at) => {
  const [sync, b1 = 0, b2 = 0] = bytes.subarray(at, at + 3);
  if (sync !== 0xff || (b1 & 0xe0) !== 0xe0 || at + 4 > bytes.byteLength) return undefined;
  const version = (b1 >> 3) & 3;
  const layer = 4 - ((b1 >> 1) & 3);
  const bitrateIndex = b2 >> 4;
  const rateIndex = (b2 >> 2) & 3;
  const reserved = [version === 1, layer === 4, rateIndex === 3];
  if (reserved.includes(true) || bitrateIndex === 0 || bitrateIndex === 15) return undefined;
  const length = mpegFrameLength(version, layer, bitrateIndex, rateIndex, (b2 >> 1) & 1);
  return { length, form: ((b1 >> 1) << 2) | rateIndex };
};

function mpegFrameLength(
  version: number,
  layer: number,
  bitrateIndex: number,
  rateIndex: number,
  padding: number,
): number {
  const mpeg1 = version === 3;
  const table = (mpeg1 ? MPEG1_BITRATES : MPEG2_BITRATES)[layer - 1] ?? [];
  const kbps = table[bitrateIndex - 1] ?? 0;
  const rate = (MPEG1_RATES[rateIndex] ?? 0) / (mpeg1 ? 1 : version === 2 ? 2 : 4);
  if (layer === 1) return (Math.floor((12_000 * kbps) / rate) + padding) * 4;
  return Math.floor(((layer === 3 && !mpeg1 ? 72_000 : 144_000) * kbps) / rate) + padding;
}

/**
 * An ADTS frame header: twelve sync bits and a layer of zero, a sample rate the table has, and a
 * frame length that holds at least the header.
 */
export const adtsFrame: FrameReader = (bytes, at) => {
  const [sync, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0] = bytes.subarray(at, at + 6);
  if (sync !== 0xff || (b1 & 0xf6) !== 0xf0 || at + 7 > bytes.byteLength) return undefined;
  if (((b2 >> 2) & 0xf) > 12) return undefined;
  const length = ((b3 & 3) << 11) | (b4 << 3) | (b5 >> 5);
  if (length < ((b1 & 1) === 0 ? 9 : 7)) return undefined;
  return { length, form: ((b1 & 0x08) << 8) | (b2 & 0xfc) };
};

/**
 * Feeds a body through, skipping the ID3v2 tags it opens with, and holds at most `windowBytes` of
 * what follows them. Answers the index of the reader two frames in a row are read by where the
 * sound starts, `null` once the window is full without them, and undefined while it can't say.
 */
export class FrameScan {
  readonly #readers: readonly FrameReader[];
  readonly #window: Uint8Array;
  #start = 0;
  #seen = 0;
  #filled = 0;
  #tags = 0;
  #spent = false;

  constructor(readers: readonly FrameReader[], windowBytes: number) {
    this.#readers = readers;
    this.#window = new Uint8Array(windowBytes);
  }

  feed(chunk: Uint8Array): number | null | undefined {
    const at = this.#seen;
    this.#seen += chunk.byteLength;
    this.#take(chunk, at);
    if (this.#spent) return null;
    return this.#filled === this.#window.byteLength ? this.#search() : undefined;
  }

  /** At the end of the body: a reader's index, or `null` when no two frames were found. */
  finish(): number | null {
    return this.#spent ? null : this.#search();
  }

  /** What the window holds past the tags and their padding, or undefined when none were skipped. */
  afterTags(): Uint8Array | undefined {
    return this.#spent || this.#tags === 0 ? undefined : this.#sound();
  }

  /** Keep the part of `bytes`, which start at offset `at`, that falls in the window. */
  #take(bytes: Uint8Array, at: number): void {
    while (!this.#spent) {
      const from = this.#start + this.#filled - at;
      if (from >= bytes.byteLength || this.#filled === this.#window.byteLength) return;
      const kept = bytes.subarray(from, from + this.#window.byteLength - this.#filled);
      this.#window.set(kept, this.#filled);
      this.#filled += kept.byteLength;
      this.#skipTags();
    }
  }

  #skipTags(): void {
    for (let end = this.#tagEnd(); end !== undefined; end = this.#tagEnd()) {
      this.#tags += 1;
      this.#start += end;
      if (this.#tags > MAX_TAGS || this.#start > MAX_TAG_BYTES) {
        this.#spent = true;
        return;
      }
      const kept = Math.max(0, this.#filled - end);
      this.#window.copyWithin(0, this.#filled - kept, this.#filled);
      this.#filled = kept;
    }
  }

  #tagEnd(): number | undefined {
    return id3v2End(this.#window.subarray(0, Math.min(this.#filled, ID3_HEADER_BYTES)));
  }

  #sound(): Uint8Array {
    const bytes = this.#window.subarray(0, this.#filled);
    let at = 0;
    while (bytes[at] === 0) at += 1;
    return bytes.subarray(at);
  }

  #search(): number | null {
    const bytes = this.#sound();
    const found = (at: number, frames: number) =>
      this.#readers.findIndex((read) => runs(read, bytes, at, frames));
    const first = found(0, 2);
    if (first >= 0) return first;
    for (let at = 1; at < Math.min(RESYNC_BYTES, bytes.byteLength); at += 1) {
      if (bytes[at] !== 0xff) continue;
      const index = found(at, RESYNC_FRAMES);
      if (index >= 0) return index;
    }
    return null;
  }
}

/** Whether `frames` frames of one form run from `at`, each where the one before says. */
function runs(read: FrameReader, bytes: Uint8Array, at: number, frames: number): boolean {
  const first = read(bytes, at);
  if (!first) return false;
  let next = at + first.length;
  for (let count = 1; count < frames; count += 1) {
    const frame = read(bytes, next);
    if (frame?.form !== first.form) return false;
    next += frame.length;
  }
  return true;
}
