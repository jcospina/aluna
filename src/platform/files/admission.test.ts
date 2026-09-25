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
    ]) {
      expect(isAdmittedType(kind ?? "", mime ?? "")).toBe(false);
    }
  });
});
