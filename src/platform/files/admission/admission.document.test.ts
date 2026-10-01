import { describe, expect, test } from "bun:test";
import {
  type AdmissionRefusalReason,
  admitClaims,
  FileAdmissionRefusal,
  isAdmittedType,
  offeredTypes,
  SignatureCheck,
} from "./admission.ts";
import { concatBytes, sampleFile } from "./sample-files.test-support.ts";

const DOCUMENTS = ["document"] as const;

function refusalOf(run: () => unknown): AdmissionRefusalReason | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof FileAdmissionRefusal) return error.reason;
    throw error;
  }
  return undefined;
}

/** Feed `bytes` to a fresh document check in `chunkSize` pieces and settle it. */
function checkDocument(bytes: Uint8Array, chunkSize = bytes.byteLength) {
  const check = new SignatureCheck("manual.pdf", "document", DOCUMENTS);
  for (let at = 0; at < bytes.byteLength; at += chunkSize) {
    check.inspect(bytes.subarray(at, at + chunkSize));
  }
  return check.finish();
}

describe("a PDF", () => {
  test("is admitted by its header, however the body is cut", () => {
    for (const chunkSize of [1, 3, 4096]) {
      expect(checkDocument(sampleFile("pdf"), chunkSize)).toEqual({
        kind: "document",
        mime: "application/pdf",
      });
    }
  });

  test("is refused the moment its first five bytes are not a PDF header", () => {
    const check = new SignatureCheck("manual.pdf", "document", DOCUMENTS);
    check.inspect(new TextEncoder().encode("%PDF"));
    expect(refusalOf(() => check.inspect(new TextEncoder().encode("!")))).toBe("signature");
  });

  test("is refused with its header anywhere but first, or cut short of it", () => {
    const behind = (lead: string) =>
      concatBytes(new TextEncoder().encode(lead), sampleFile("pdf", 1024));
    const cut = sampleFile("pdf").subarray(0, 4);
    for (const bytes of [behind(" "), behind("\uFEFF"), behind("<html>"), cut]) {
      expect(refusalOf(() => checkDocument(bytes))).toBe("signature");
    }
    expect(refusalOf(() => checkDocument(new Uint8Array(0)))).toBe("signature");
  });

  test("is claimed by its extension, in any case, and only by a field that takes documents", () => {
    expect(admitClaims("Manual.PDF", "application/pdf", DOCUMENTS)).toBe("document");
    expect(admitClaims("manual.pdf", "text/pdf", DOCUMENTS)).toBe("document");
    expect(refusalOf(() => admitClaims("manual.pdf", "", ["image"]))).toBe("not_accepted");
    expect(refusalOf(() => admitClaims("manual.pdf", "image/png", DOCUMENTS))).toBe(
      "declared_type",
    );
    expect(refusalOf(() => admitClaims("manual.html", "", DOCUMENTS))).toBe("extension");
  });

  test("is what a document picker offers, and every offer is admitted", () => {
    const offered = offeredTypes(DOCUMENTS);
    expect(offered).toContain(".pdf");
    for (const type of offered.filter((offer) => !offer.startsWith("."))) {
      expect(isAdmittedType("document", type)).toBe(true);
    }
    for (const extension of offered.filter((offer) => offer.startsWith("."))) {
      expect(admitClaims(`a${extension}`, "", DOCUMENTS)).toBe("document");
    }
  });
});
