import { describe, expect, test } from "bun:test";
import {
  type AdmissionRefusalReason,
  admitClaims,
  FileAdmissionRefusal,
  isAdmittedType,
  SIGNATURE_WINDOW_BYTES,
  SignatureCheck,
} from "./admission.ts";
import { type SampleFormat, sampleFile } from "./sample-files.test-support.ts";

const IMAGES = ["image"] as const;

function refusalOf(run: () => unknown): AdmissionRefusalReason | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof FileAdmissionRefusal) return error.reason;
    throw error;
  }
  return undefined;
}

/** Feed `bytes` to a fresh image check in `chunkSize` pieces and settle it. */
function checkBytes(bytes: Uint8Array, chunkSize = bytes.byteLength) {
  const check = new SignatureCheck("image");
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    check.inspect(bytes.subarray(offset, offset + chunkSize));
  }
  return check.finish();
}

describe("the extension", () => {
  // The allowlist is a security boundary: each extension on it is named here on purpose.
  test("names the image family for every allowlisted extension, compared case-insensitively", () => {
    for (const name of [
      "photo.jpg",
      "photo.jpeg",
      "photo.jfif",
      "photo.pjpeg",
      "photo.pjp",
      "photo.png",
      "photo.gif",
      "photo.webp",
      "photo.avif",
    ]) {
      expect(admitClaims(name, "", IMAGES)).toBe("image");
      expect(admitClaims(name.toUpperCase(), undefined, IMAGES)).toBe("image");
    }
  });

  test("off the list, or missing, refuses the file before a byte is read", () => {
    for (const name of [
      "vector.svg",
      "phone.heic",
      "phone.heif",
      "scan.tiff",
      "scan.tif",
      "notes.txt",
      "page.html",
      "photo",
      "photo.jpg.exe",
      "",
    ]) {
      expect(refusalOf(() => admitClaims(name, "", IMAGES))).toBe("extension");
    }
  });

  test("names a family the field does not take, and the field refuses it", () => {
    expect(refusalOf(() => admitClaims("photo.jpg", "", []))).toBe("not_accepted");
  });
});

describe("a declared type", () => {
  test("is no claim when blank or octet-stream, and agrees through its aliases and parameters", () => {
    for (const declared of [
      undefined,
      "",
      "  ",
      "application/octet-stream",
      "image/jpeg",
      "IMAGE/JPEG",
      "image/jpg",
      "image/pjpeg",
      "image/jpeg; charset=binary",
    ]) {
      expect(admitClaims("photo.jpg", declared, IMAGES)).toBe("image");
    }
    expect(admitClaims("photo.png", "image/x-png", IMAGES)).toBe("image");
  });

  test("that contradicts the extension refuses the file", () => {
    for (const [name, declared] of [
      ["photo.jpg", "image/png"],
      ["photo.jpg", "image/heic"],
      ["photo.png", "image/svg+xml"],
      ["photo.gif", "text/html"],
      ["photo.avif", "image/avif-sequence"],
    ] as const) {
      expect(refusalOf(() => admitClaims(name, declared, IMAGES))).toBe("declared_type");
    }
  });
});

describe("the bytes", () => {
  test("pick the row the file is recorded under, however they arrive", () => {
    const expected: [SampleFormat, string][] = [
      ["jpeg", "image/jpeg"],
      ["png", "image/png"],
      ["gif87", "image/gif"],
      ["gif89", "image/gif"],
      ["webp", "image/webp"],
      ["avif", "image/avif"],
      ["avis", "image/avif"],
    ];
    for (const [format, mime] of expected) {
      for (const chunkSize of [1, 5, 4096]) {
        expect(checkBytes(sampleFile(format), chunkSize)).toEqual({ kind: "image", mime });
      }
    }
  });

  test("of HEIC, HEIF, TIFF, SVG or text are refused within the first chunk that settles it", () => {
    const refused: SampleFormat[] = [
      "heic",
      "heix",
      "mif1",
      "msf1",
      "mif1Avif",
      "tiffLittle",
      "tiffBig",
      "svg",
      "text",
    ];
    for (const format of refused) {
      const check = new SignatureCheck("image");
      expect(refusalOf(() => check.inspect(sampleFile(format, 16)))).toBe("signature");
    }
  });

  test("abort inside the 64 KB window, not after the whole body", () => {
    const check = new SignatureCheck("image");
    const window = sampleFile("text", SIGNATURE_WINDOW_BYTES);
    expect(refusalOf(() => check.inspect(window))).toBe("signature");
  });

  test("too short to hold a signature, or absent, are refused when the body ends", () => {
    const empty = new SignatureCheck("image");
    expect(refusalOf(() => empty.finish())).toBe("signature");
    const short = new SignatureCheck("image");
    short.inspect(new Uint8Array([0xff, 0xd8]));
    expect(refusalOf(() => short.finish())).toBe("signature");
  });

  test("once admitted, are not read again, and later bytes do not change the answer", () => {
    const check = new SignatureCheck("image");
    check.inspect(sampleFile("jpeg", 64));
    check.inspect(sampleFile("text", SIGNATURE_WINDOW_BYTES * 2));
    expect(check.finish()).toEqual({ kind: "image", mime: "image/jpeg" });
    expect(check.finish()).toEqual({ kind: "image", mime: "image/jpeg" });
  });
});

describe("an admitted type", () => {
  test("is a kind and a type some row records, and nothing else", () => {
    for (const mime of ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]) {
      expect(isAdmittedType("image", mime)).toBe(true);
    }
    for (const [kind, mime] of [
      ["image", "image/svg+xml"],
      ["image", "text/html"],
      ["image", "image/heic"],
      ["image", "image/jpeg\r\nx-injected: 1"],
      ["video", "image/jpeg"],
      ["audio", "audio/mp4"],
    ]) {
      expect(isAdmittedType(kind ?? "", mime ?? "")).toBe(false);
    }
  });
});

const VIDEOS = ["video"] as const;

/** Feed `bytes` to a fresh video check in `chunkSize` pieces and settle it. */
function checkVideo(bytes: Uint8Array, chunkSize = bytes.byteLength) {
  const check = new SignatureCheck("video");
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    check.inspect(bytes.subarray(offset, offset + chunkSize));
  }
  return check.finish();
}

describe("a video's extension", () => {
  // The allowlist is a security boundary: each extension on it is named here on purpose.
  test("names the video family for every allowlisted extension", () => {
    for (const name of ["a.mp4", "a.m4v", "a.mov", "a.webm", "a.ogv", "a.ogg"]) {
      expect(admitClaims(name, "", VIDEOS)).toBe("video");
      expect(admitClaims(name.toUpperCase(), undefined, ["image", "video"])).toBe("video");
    }
  });

  test("off the list refuses the file, and a family the field doesn't take is refused", () => {
    for (const name of ["a.mkv", "a.avi", "a.wmv", "a.flv", "a.3gp", "a.m4a", "a.mp3", "a.qt"]) {
      expect(refusalOf(() => admitClaims(name, "", VIDEOS))).toBe("extension");
    }
    expect(refusalOf(() => admitClaims("a.mp4", "", IMAGES))).toBe("not_accepted");
    expect(refusalOf(() => admitClaims("a.jpg", "", VIDEOS))).toBe("not_accepted");
  });

  test("agrees with a declared type through its aliases, and is refused by one it contradicts", () => {
    for (const [name, declared] of [
      ["a.mp4", "video/mp4"],
      ["a.m4v", "video/x-m4v"],
      ["a.m4v", "video/mp4"],
      ["a.mov", "video/quicktime"],
      ["a.mov", "video/x-quicktime"],
      ["a.webm", "video/webm"],
      ["a.ogv", "video/ogg"],
      ["a.ogg", "video/ogg"],
    ] as const) {
      expect(admitClaims(name, declared, VIDEOS)).toBe("video");
    }
    for (const [name, declared] of [
      ["a.mp4", "video/quicktime"],
      ["a.mov", "video/mp4"],
      ["a.mp4", "image/heic"],
      ["a.mp4", "text/html"],
      ["a.ogv", "audio/ogg"],
      ["a.mp4", "audio/mp4"],
    ] as const) {
      expect(refusalOf(() => admitClaims(name, declared, VIDEOS))).toBe("declared_type");
    }
  });

  test("of a WebM or an Ogg, a declared family decides, and a bare Ogg type names none", () => {
    for (const name of ["a.ogg", "a.ogv", "A.OGG"]) {
      for (const declared of ["application/ogg", "application/x-ogg"]) {
        expect(admitClaims(name, declared, VIDEOS)).toBe("video");
      }
    }
    // Only a sound's or a picture's type names a family; `.ogv` is a video by its name alone.
    for (const [name, declared] of [
      ["a.webm", "image/webm"],
      ["a.ogv", "audio/ogg"],
    ] as const) {
      expect(refusalOf(() => admitClaims(name, declared, VIDEOS))).toBe("declared_type");
    }
    for (const [name, declared] of [
      ["a.webm", "audio/webm"],
      ["a.ogg", "audio/ogg"],
      ["a.ogg", "audio/ogg; codecs=opus"],
    ] as const) {
      expect(refusalOf(() => admitClaims(name, declared, VIDEOS))).toBe("not_accepted");
    }
    expect(refusalOf(() => admitClaims("a.webm", "video/webm", IMAGES))).toBe("not_accepted");
  });
});

describe("a video's bytes", () => {
  test("pick the container the file is recorded under, however they arrive", () => {
    const expected: [SampleFormat, string][] = [
      ["isom", "video/mp4"],
      ["mp42", "video/mp4"],
      ["m4v", "video/mp4"],
      ["m4a", "video/mp4"],
      ["quickTime", "video/quicktime"],
      ["moovFirst", "video/quicktime"],
      ["wideFirst", "video/quicktime"],
      ["mdatFirst", "video/quicktime"],
      ["webm", "video/webm"],
      ["ogg", "video/ogg"],
    ];
    for (const [format, mime] of expected) {
      for (const chunkSize of [1, 5, 4096]) {
        expect(checkVideo(sampleFile(format), chunkSize)).toEqual({ kind: "video", mime });
      }
    }
  });

  test("of an .m4a renamed .mp4 are judged by the extension's family", () => {
    expect(admitClaims("song.mp4", "", VIDEOS)).toBe("video");
    expect(checkVideo(sampleFile("m4a"))).toEqual({ kind: "video", mime: "video/mp4" });
  });

  test("of a HEIC, HEIF or AVIF brand, a Matroska, a picture or text are refused", () => {
    const refused: SampleFormat[] = [
      "heic",
      "heicMovie",
      "avio",
      "jpegInHeif",
      "vvcInHeif",
      "canonRaw",
      "heix",
      "mif1",
      "msf1",
      "mif1Avif",
      "avif",
      "avis",
      "matroska",
      "jpeg",
      "png",
      "gif89",
      "webp",
      "svg",
      "text",
    ];
    for (const format of refused) {
      expect(refusalOf(() => checkVideo(sampleFile(format)))).toBe("signature");
    }
  });
});

describe("a video's container", () => {
  test("of a QuickTime atom are read only where the atom could be one, and fits the file", () => {
    const atom = (size: number[], type: string, then = "mvhd") => [
      ...size,
      ...[...type, ...then].map((char) => char.charCodeAt(0)),
      ...Array.from({ length: 64 }, () => 0),
    ];
    const admitted = (bytes: number[]) => checkVideo(new Uint8Array(bytes)).mime;
    expect(admitted(atom([0, 0, 0, 0x40], "moov"))).toBe("video/quicktime");
    expect(admitted(atom([0, 0, 0, 0], "mdat"))).toBe("video/quicktime");
    expect(admitted(atom([0, 0, 0, 8], "wide", "\u0000\u0000\u0000\u0000mdat"))).toBe(
      "video/quicktime",
    );
    for (const bytes of [
      atom([0, 0, 0, 4], "moov"),
      atom([0, 0, 0, 0], "moov"),
      atom([0, 0, 0, 0x10], "wide", "mdat"),
      atom([0, 0, 0, 8], "wide", "\u0000\u0000\u0000\u0000html"),
      atom([0, 0, 0, 0x60], "pnot"),
      atom([0, 0, 0x10, 0], "moov"),
      atom([0, 0, 0, 1], "mdat", "\u0000\u0000\u0000\u0001"),
      [...new TextEncoder().encode("<!--free--><html><script>alert(1)</script>")],
    ]) {
      expect(refusalOf(() => checkVideo(new Uint8Array(bytes)))).toBe("signature");
    }
  });

  test("of an EBML header are walked element by element to their DocType", () => {
    const segment = [0x18, 0x53, 0x80, 0x67, ...Array.from({ length: 64 }, () => 0)];
    const ebml = (elements: number[]) =>
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80 | elements.length, ...elements, ...segment]);
    const docType = (width: number[], name: string) => [
      0x42,
      0x82,
      ...width,
      ...[...name].map((char) => char.charCodeAt(0)),
    ];
    const version = [0x42, 0x86, 0x81, 0x01];
    const decoy = [0xec, 0x87, ...docType([0x84], "webm").slice(0, 7)];
    expect(checkVideo(ebml([...version, ...docType([0x40, 0x04], "webm")])).mime).toBe(
      "video/webm",
    );
    expect(checkVideo(ebml([...version, ...docType([0x86], "webm\u0000\u0000")])).mime).toBe(
      "video/webm",
    );
    for (const bytes of [
      ebml([...decoy, ...docType([0x88], "matroska")]),
      ebml([...version, ...docType([0x85], "webmx")]),
      ebml([...version]),
      new Uint8Array([
        0x1a,
        0x45,
        0xdf,
        0xa3,
        0x00,
        0x42,
        0x82,
        0x84,
        0x77,
        0x65,
        0x62,
        0x6d,
        ...segment,
      ]),
    ]) {
      expect(refusalOf(() => checkVideo(bytes))).toBe("signature");
    }
  });
});

describe("a video's bytes, beside an image's", () => {
  test("of an image are never read as a video's, nor a video's as an image's", () => {
    for (const format of ["isom", "quickTime", "moovFirst", "webm", "ogg"] as const) {
      expect(refusalOf(() => checkBytes(sampleFile(format)))).toBe("signature");
    }
  });

  test("decide inside the 64 KB window", () => {
    const check = new SignatureCheck("video");
    expect(refusalOf(() => check.inspect(sampleFile("text", SIGNATURE_WINDOW_BYTES)))).toBe(
      "signature",
    );
  });
});

describe("an admitted video type", () => {
  test("is a container a video row records, and nothing else", () => {
    for (const mime of ["video/mp4", "video/quicktime", "video/webm", "video/ogg"]) {
      expect(isAdmittedType("video", mime)).toBe(true);
      expect(isAdmittedType("image", mime)).toBe(false);
    }
    for (const mime of ["video/x-matroska", "video/x-m4v", "audio/mp4", "image/jpeg"]) {
      expect(isAdmittedType("video", mime)).toBe(false);
    }
  });
});
