import { describe, expect, test } from "bun:test";
import type { FileFamily } from "../../../registry/fields/file.ts";
import {
  type AdmissionRefusalReason,
  admitClaims,
  FileAdmissionRefusal,
  familiesTheBytesMayName,
  isAdmittedType,
  offeredTypes,
  SIGNATURE_WINDOW_BYTES,
  SignatureCheck,
} from "./admission.ts";
import {
  adtsHeader,
  concatBytes,
  frameRun,
  id3Tag,
  MP3_FRAME_BYTES,
  MP3_FRAME_HEADER,
  mp3File,
  oggWith,
  sampleFile,
  webmWithTracks,
} from "./sample-files.test-support.ts";

const AUDIO = ["audio"] as const;
const MEDIA = ["video", "audio"] as const;

function refusalOf(run: () => unknown): AdmissionRefusalReason | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof FileAdmissionRefusal) return error.reason;
    throw error;
  }
  return undefined;
}

/** Feed `bytes` to a fresh audio check in `chunkSize` pieces and settle it. */
function checkAudio(bytes: Uint8Array, chunkSize = bytes.byteLength) {
  const check = new SignatureCheck("sound.mp3", "audio");
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    check.inspect(bytes.subarray(offset, offset + chunkSize));
  }
  return check.finish();
}

const text = (size: number) => sampleFile("text", size).map((byte) => byte & 0x7f);

describe("an audio file's extension", () => {
  // The allowlist is a security boundary: each extension on it is named here on purpose.
  test("names the audio family for every allowlisted extension", () => {
    for (const name of ["a.mp3", "a.m4a", "a.aac", "a.wav", "a.ogg", "a.oga", "a.opus", "a.flac"]) {
      expect(admitClaims(name, "", AUDIO)).toBe("audio");
      expect(admitClaims(name.toUpperCase(), undefined, ["image", "audio"])).toBe("audio");
    }
    expect(admitClaims("a.webm", "", AUDIO)).toBe("audio");
  });

  test("off the list refuses the file, and a family the field doesn't take is refused", () => {
    for (const name of ["a.wma", "a.aiff", "a.aif", "a.amr", "a.mid", "a.caf", "a.ape", "a.m4b"]) {
      expect(refusalOf(() => admitClaims(name, "", AUDIO))).toBe("extension");
    }
    for (const name of ["a.mp4", "a.mov", "a.ogv", "a.jpg"]) {
      expect(refusalOf(() => admitClaims(name, "", AUDIO))).toBe("not_accepted");
    }
    for (const name of ["a.mp3", "a.m4a", "a.wav"]) {
      expect(refusalOf(() => admitClaims(name, "", ["image", "video"]))).toBe("not_accepted");
    }
  });

  test("agrees with a declared type through its aliases, and is refused by one it contradicts", () => {
    for (const [name, declared] of [
      ["a.mp3", "audio/mpeg"],
      ["a.mp3", "audio/mp3"],
      ["a.mp3", "audio/x-mp3"],
      ["a.mp3", "audio/mpeg3"],
      ["a.m4a", "audio/mp4"],
      ["a.m4a", "audio/x-m4a"],
      ["a.m4a", "audio/m4a"],
      ["a.aac", "audio/aac"],
      ["a.aac", "audio/x-aac"],
      ["a.wav", "audio/wav"],
      ["a.wav", "audio/x-wav"],
      ["a.wav", "audio/wave"],
      ["a.wav", "audio/vnd.wave"],
      ["a.flac", "audio/flac"],
      ["a.flac", "audio/x-flac"],
      ["a.opus", "audio/ogg"],
      ["a.oga", "audio/ogg; codecs=opus"],
      ["a.webm", "audio/webm;codecs=opus"],
      ["a.m4a", "AUDIO/X-M4A"],
      ["a.mp3", "audio/x-mpeg"],
      ["a.m4a", "audio/mp4a-latm"],
      ["a.aac", "audio/vnd.dlna.adts"],
      ["a.aac", "audio/x-hx-aac-adts"],
      ["a.opus", "audio/opus"],
      ["a.ogg", "audio/x-vorbis+ogg"],
    ] as const) {
      expect(admitClaims(name, declared, AUDIO)).toBe("audio");
    }
    for (const [name, declared] of [
      ["a.mp3", "audio/mp4"],
      ["a.m4a", "video/mp4"],
      ["a.m4a", "audio/mpeg"],
      ["a.wav", "text/html"],
      ["a.flac", "audio/ogg"],
      ["a.aac", "audio/mp4"],
      ["a.opus", "video/ogg"],
    ] as const) {
      expect(refusalOf(() => admitClaims(name, declared, AUDIO))).toBe("declared_type");
    }
  });

  test("of a WebM or an Ogg is named by the field, then by its declared type, then as usual", () => {
    expect(admitClaims("a.webm", "video/webm", AUDIO)).toBe("audio");
    expect(admitClaims("a.ogg", "video/ogg", AUDIO)).toBe("audio");
    expect(admitClaims("a.webm", "", ["image", "audio"])).toBe("audio");
    expect(admitClaims("a.ogg", "application/ogg", AUDIO)).toBe("audio");
    expect(admitClaims("a.ogg", "", ["image", "video"])).toBe("video");
    expect(admitClaims("a.webm", "audio/webm", MEDIA)).toBe("audio");
    expect(admitClaims("a.ogg", "video/ogg", MEDIA)).toBe("video");
    expect(admitClaims("a.webm", "", MEDIA)).toBe("video");
    expect(admitClaims("a.ogg", "", MEDIA)).toBe("audio");
    expect(refusalOf(() => admitClaims("a.webm", "audio/ogg", AUDIO))).toBe("declared_type");
    expect(refusalOf(() => admitClaims("a.webm", "", ["image"]))).toBe("not_accepted");
  });
});

describe("a WebM's or an Ogg's bytes", () => {
  const OPUS = oggWith("OpusHead");
  const THEORA_PACKET = [0x80, ...new TextEncoder().encode("theora")];
  const THEORA = oggWith(THEORA_PACKET);

  /** What a check presuming `kind`, for a field that takes `accepts`, records `bytes` as. */
  const settle = (bytes: Uint8Array, kind: "video" | "audio", accepts: readonly FileFamily[]) => {
    const check = new SignatureCheck("clip.webm", kind, accepts);
    for (let at = 0; at < bytes.byteLength; at += 700) check.inspect(bytes.subarray(at, at + 700));
    return check.finish();
  };

  test("record the family their tracks or first codec hold, when the field takes it", () => {
    for (const presumed of ["video", "audio"] as const) {
      expect(settle(webmWithTracks([2]), presumed, MEDIA).mime).toBe("audio/webm");
      expect(settle(webmWithTracks([2, 1], 4000), presumed, MEDIA).mime).toBe("video/webm");
      expect(settle(OPUS, presumed, MEDIA).mime).toBe("audio/ogg");
      expect(settle(THEORA, presumed, MEDIA).mime).toBe("video/ogg");
    }
  });

  test("of the family a field doesn't take are refused, whatever the name said", () => {
    expect(refusalOf(() => settle(webmWithTracks([1]), "audio", AUDIO))).toBe("not_accepted");
    expect(refusalOf(() => settle(THEORA, "audio", AUDIO))).toBe("not_accepted");
    expect(refusalOf(() => settle(webmWithTracks([2]), "video", ["video"]))).toBe("not_accepted");
    expect(refusalOf(() => settle(OPUS, "video", ["video", "image"]))).toBe("not_accepted");
  });

  test("say a picture however its type is written, and past a muxer's reserved space", () => {
    expect(settle(webmWithTracks([2, [0, 1]]), "audio", MEDIA).mime).toBe("video/webm");
    expect(refusalOf(() => settle(webmWithTracks([[0, 0, 1]]), "audio", AUDIO))).toBe(
      "not_accepted",
    );
    expect(settle(webmWithTracks([2], 20_000), "video", MEDIA).mime).toBe("audio/webm");
    const vorbisFirst = oggWith([1, ...new TextEncoder().encode("vorbis")], THEORA_PACKET);
    expect(settle(vorbisFirst, "audio", MEDIA).mime).toBe("video/ogg");
  });

  test("of another name are never read as the other family", () => {
    const named = (name: string) => familiesTheBytesMayName(name, "audio", MEDIA);
    expect(named("memo.webm")).toEqual(MEDIA);
    expect(named("memo.ogg")).toEqual(MEDIA);
    expect(named("memo.mp3")).toEqual(["audio"]);
    const tagged = concatBytes(id3Tag(40), webmWithTracks([1]));
    expect(refusalOf(() => settle(tagged, "audio", named("song.mp3")))).toBe("signature");
    expect(refusalOf(() => settle(THEORA, "audio", named("take.opus")))).toBe("not_accepted");
  });

  test("that don't say, or say before their tracks end, keep the family presumed", () => {
    for (const bytes of [sampleFile("webm"), oggWith("fishead\0"), webmWithTracks([])]) {
      expect(settle(bytes, "audio", MEDIA).kind).toBe("audio");
      expect(settle(bytes, "video", MEDIA).kind).toBe("video");
    }
  });
});

describe("an audio file's container", () => {
  test("picks the row the file is recorded under, however it arrives", () => {
    for (const [format, mime] of [
      ["m4a", "audio/mp4"],
      ["isom", "audio/mp4"],
      ["mp42", "audio/mp4"],
      ["wav", "audio/wav"],
      ["flac", "audio/flac"],
      ["ogg", "audio/ogg"],
      ["opus", "audio/ogg"],
      ["webm", "audio/webm"],
    ] as const) {
      for (const chunkSize of [1, 3, 4096]) {
        expect(checkAudio(sampleFile(format), chunkSize)).toEqual({ kind: "audio", mime });
      }
    }
  });

  test("of a HEIC or QuickTime brand, a Matroska, a WebP, a picture or text is refused", () => {
    for (const format of [
      "heic",
      "mif1",
      "quickTime",
      "matroska",
      "webp",
      "jpeg",
      "text",
    ] as const) {
      expect(refusalOf(() => checkAudio(sampleFile(format)))).toBe("signature");
    }
  });
});

describe("an MP3's frames", () => {
  test("are found with no tag, behind a small tag, and behind cover art larger than 64 KB", () => {
    const big = SIGNATURE_WINDOW_BYTES * 3 + 17;
    for (const bytes of [mp3File(), mp3File(0), mp3File(1024), mp3File(big)]) {
      for (const chunkSize of [1, 7, 4096, 65_536]) {
        expect(checkAudio(bytes, chunkSize)).toEqual({ kind: "audio", mime: "audio/mpeg" });
      }
    }
  });

  test("are found past padding after the tag, and past an ID3v2.4 footer", () => {
    const padded = concatBytes(id3Tag(512), new Uint8Array(3000), mp3File(undefined, 4));
    expect(checkAudio(padded, 1000).mime).toBe("audio/mpeg");
    const footer = id3Tag(0, 4).subarray(0, 10);
    footer.set([0x33, 0x44, 0x49, 4, 0, 0x10, 0, 0, 4, 0x58]);
    const footed = concatBytes(id3Tag(600, 4, 0x10), footer, mp3File());
    expect(checkAudio(footed, 333).mime).toBe("audio/mpeg");
  });

  test("absent after the tag refuse the file, however large the tag", () => {
    for (const tagBytes of [100, SIGNATURE_WINDOW_BYTES * 2]) {
      const bytes = concatBytes(id3Tag(tagBytes), text(SIGNATURE_WINDOW_BYTES + 4096));
      expect(refusalOf(() => checkAudio(bytes, 4096))).toBe("signature");
    }
  });

  test("are refused inside the 64 KB after the tag, not after the whole body", () => {
    const check = new SignatureCheck("sound.mp3", "audio");
    check.inspect(id3Tag(SIGNATURE_WINDOW_BYTES * 2));
    expect(refusalOf(() => check.inspect(text(SIGNATURE_WINDOW_BYTES - 1)))).toBeUndefined();
    expect(refusalOf(() => check.inspect(text(1)))).toBe("signature");
  });

  test("past the window after the tag are not looked for", () => {
    const late = concatBytes(id3Tag(64), text(SIGNATURE_WINDOW_BYTES), mp3File());
    expect(refusalOf(() => checkAudio(late, 8192))).toBe("signature");
  });

  test("must be two in a row, each where the one before says, of one form", () => {
    const one = concatBytes(new Uint8Array(MP3_FRAME_HEADER), text(4096));
    expect(refusalOf(() => checkAudio(one))).toBe("signature");
    const misplaced = concatBytes(
      frameRun(MP3_FRAME_HEADER, MP3_FRAME_BYTES + 1, 1),
      new Uint8Array(MP3_FRAME_HEADER),
      text(1024),
    );
    expect(refusalOf(() => checkAudio(misplaced))).toBe("signature");
    const reshaped = concatBytes(
      frameRun(MP3_FRAME_HEADER, MP3_FRAME_BYTES, 1),
      new Uint8Array([0xff, 0xfb, 0x94, 0x00]),
      text(1024),
    );
    expect(refusalOf(() => checkAudio(reshaped))).toBe("signature");
  });

  test("of a picture or a tag that promises more than arrived are refused when the body ends", () => {
    expect(refusalOf(() => checkAudio(sampleFile("jpeg", 20_000)))).toBe("signature");
    expect(refusalOf(() => checkAudio(id3Tag(900).subarray(0, 400)))).toBe("signature");
    expect(refusalOf(() => checkAudio(new Uint8Array(0)))).toBe("signature");
    expect(refusalOf(() => checkAudio(new Uint8Array([0x49, 0x44, 0x33])))).toBe("signature");
  });

  test("of machine code that holds two headers in a row are not the sound's", () => {
    const code = new Uint8Array(40_000).fill(0x41);
    code.set([0xcf, 0xfa, 0xed, 0xfe]);
    code.set([0xff, 0xff, 0x17, 0x00], 1000);
    code.set([0xff, 0xff, 0x17, 0x00], 1036);
    expect(refusalOf(() => checkAudio(code))).toBe("signature");
  });

  test("behind which a FLAC, a WAV or an Ogg starts, padded or not, are that container's", () => {
    for (const [format, mime] of [
      ["flac", "audio/flac"],
      ["wav", "audio/wav"],
      ["ogg", "audio/ogg"],
    ] as const) {
      for (const tagBytes of [2000, SIGNATURE_WINDOW_BYTES * 2]) {
        const tagged = concatBytes(id3Tag(tagBytes), sampleFile(format, 90_000));
        expect(checkAudio(tagged, 4096)).toEqual({ kind: "audio", mime });
        const padded = concatBytes(id3Tag(tagBytes), new Uint8Array(16), sampleFile(format));
        expect(checkAudio(padded, 4096)).toEqual({ kind: "audio", mime });
      }
    }
  });

  test("behind which only a sound a tagger tags is found, and never another family", () => {
    const mixed = new SignatureCheck("sound.mp3", "audio", MEDIA);
    const tagged = concatBytes(id3Tag(40), webmWithTracks([2, 1]), sampleFile("text", 70_000));
    const settle = () => {
      mixed.inspect(tagged);
      return mixed.finish();
    };
    expect(refusalOf(settle)).toBe("signature");
    for (const format of ["m4a", "webm"] as const) {
      const behind = concatBytes(id3Tag(40), sampleFile(format, 70_000));
      expect(refusalOf(() => checkAudio(behind))).toBe("signature");
    }
  });

  test("of a container padded at its start, with no tag, are not found", () => {
    for (const format of ["ogg", "flac", "wav"] as const) {
      const padded = concatBytes(new Uint8Array(100), sampleFile(format, 70_000));
      expect(refusalOf(() => checkAudio(padded))).toBe("signature");
    }
  });

  test("of an ADTS AAC are found as an MP3's are, behind a tag or none", () => {
    const run = frameRun(adtsHeader(371), 371, 6);
    for (const bytes of [run, concatBytes(id3Tag(SIGNATURE_WINDOW_BYTES + 5), run)]) {
      expect(checkAudio(bytes, 500)).toEqual({ kind: "audio", mime: "audio/aac" });
    }
  });

  test("are never read for a video or an image", () => {
    for (const kind of ["video", "image"] as const) {
      const check = new SignatureCheck(kind === "video" ? "clip.mp4" : "photo.jpg", kind);
      const settle = () => {
        check.inspect(mp3File(64));
        return check.finish();
      };
      expect(refusalOf(settle)).toBe("signature");
    }
  });
});

describe("an admitted audio type", () => {
  // The recorded types are what the serve route trusts: each is named here on purpose.
  test("is a container or frame run an audio row records, and nothing else", () => {
    for (const mime of [
      "audio/mpeg",
      "audio/mp4",
      "audio/aac",
      "audio/wav",
      "audio/ogg",
      "audio/webm",
      "audio/flac",
    ]) {
      expect(isAdmittedType("audio", mime)).toBe(true);
      expect(isAdmittedType("video", mime)).toBe(false);
    }
    for (const mime of ["audio/x-m4a", "audio/x-wav", "audio/mp3", "video/mp4", "text/html"]) {
      expect(isAdmittedType("audio", mime)).toBe(false);
    }
  });

  test("is what an audio field's picker offers, beside every extension admission takes as one", () => {
    const offered = offeredTypes(AUDIO);
    for (const type of offered.filter((offer) => !offer.startsWith("."))) {
      expect(isAdmittedType("audio", type)).toBe(true);
    }
    for (const extension of offered.filter((offer) => offer.startsWith("."))) {
      expect(admitClaims(`a${extension}`, "", AUDIO)).toBe("audio");
    }
  });
});
