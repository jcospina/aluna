// The text test (Module 7 PLAN decision 3): a Markdown or plain-text file is read to its end, and
// admitted as UTF-8 with or without a BOM, UTF-16 with a BOM, or 8-bit text with no zero bytes.
// The label it answers is a WHATWG encoding name, which `TextDecoder` reads as it is: Module 9
// starts reading plain text from it. 8-bit text is labelled windows-1252, the WHATWG default for
// Latin-1, which is what Excel writes Spanish text in. A leaf: it imports nothing.

export type TextEncodingLabel = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

type Mode = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "8-bit";

/** The longest byte-order mark: UTF-8's. */
const BOM_BYTES = 3;

function modeOf(head: Uint8Array): { mode: Mode; bom: number } {
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf)
    return { mode: "utf-8-bom", bom: 3 };
  if (head[0] === 0xff && head[1] === 0xfe) return { mode: "utf-16le", bom: 2 };
  if (head[0] === 0xfe && head[1] === 0xff) return { mode: "utf-16be", bom: 2 };
  return { mode: "utf-8", bom: 0 };
}

const LABELS: Readonly<Record<Mode, TextEncodingLabel>> = {
  "utf-8": "utf-8",
  "utf-8-bom": "utf-8",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
  "8-bit": "windows-1252",
};

/**
 * Fed each chunk as it arrives. `feed` answers false the moment the bytes can be no admitted text,
 * so a zero byte aborts the upload there; `finish` answers the encoding, or undefined.
 */
export class TextScan {
  #head = new Uint8Array(BOM_BYTES);
  #headFilled = 0;
  #mode: Mode | undefined;
  #refused = false;
  readonly #utf8 = new TextDecoder("utf-8", { fatal: true });
  #utf16: TextDecoder | undefined;

  feed(chunk: Uint8Array): boolean {
    if (this.#refused) return false;
    if (this.#mode) return this.#take(chunk);
    const taken = chunk.subarray(0, BOM_BYTES - this.#headFilled);
    this.#head.set(taken, this.#headFilled);
    this.#headFilled += taken.byteLength;
    if (this.#headFilled < BOM_BYTES) return true;
    return this.#decide() && this.#take(chunk.subarray(taken.byteLength));
  }

  finish(): TextEncodingLabel | undefined {
    if (!this.#mode) this.#decide();
    if (this.#refused || !this.#ended()) return undefined;
    return this.#mode && LABELS[this.#mode];
  }

  /** Whether the text ends whole: no code unit, surrogate pair or UTF-8 sequence cut short. */
  #ended(): boolean {
    if (this.#utf16) return this.#units(new Uint8Array(0), false);
    return this.#mode === "8-bit" || this.#decoded(new Uint8Array(0), false);
  }

  /** The mode the head's byte-order mark names, then the head read in it. */
  #decide(): boolean {
    const head = this.#head.subarray(0, this.#headFilled);
    const { mode, bom } = modeOf(head);
    this.#mode = mode;
    if (mode === "utf-16le" || mode === "utf-16be") {
      // Bun's types list fewer labels than its TextDecoder reads, UTF-16's byte orders among them.
      const label = mode as ConstructorParameters<typeof TextDecoder>[0];
      this.#utf16 = new TextDecoder(label, { fatal: true, ignoreBOM: true });
    }
    return this.#take(head.subarray(mode === "utf-8-bom" ? 0 : bom));
  }

  #take(bytes: Uint8Array): boolean {
    if (this.#utf16) return this.#units(bytes, true);
    if (bytes.includes(0)) return this.#refuse();
    return this.#mode === "8-bit" || this.#decoded(bytes, true);
  }

  /** UTF-8 read on; a file with no BOM that stops being UTF-8 is 8-bit text from there. */
  #decoded(bytes: Uint8Array, stream: boolean): boolean {
    try {
      this.#utf8.decode(bytes, { stream });
      return true;
    } catch {
      if (this.#mode === "utf-8-bom") return this.#refuse();
      this.#mode = "8-bit";
      return true;
    }
  }

  /** UTF-16 read on, well formed and with no zero code unit, which UTF-16 text never holds. */
  #units(bytes: Uint8Array, stream: boolean): boolean {
    try {
      const text = this.#utf16?.decode(bytes, { stream }) ?? "";
      return text.includes("\u0000") ? this.#refuse() : true;
    } catch {
      return this.#refuse();
    }
  }

  #refuse(): false {
    this.#refused = true;
    return false;
  }
}
