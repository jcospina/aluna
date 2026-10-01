import { describe, expect, test } from "bun:test";
import {
  type AdmissionRefusalReason,
  type AdmittedType,
  admitClaims,
  admittedTypes,
  admitWritten,
  FileAdmissionRefusal,
  offeredTypes,
  SignatureCheck,
} from "../admission.ts";
import { sampleFile } from "../sample-files.test-support.ts";
import {
  compoundFileOf,
  LOCKED_WORD_STREAMS,
  officePackage,
  PRESUPUESTO_DOCX,
  readerOf,
  SAVED_DOC,
  SAVED_DOCX,
} from "./office-samples.test-support.ts";
import { WORD_DOCUMENT_TYPE } from "./word-package.ts";

const DOCUMENTS = ["document"] as const;

async function refusalOf(run: () => unknown): Promise<AdmissionRefusalReason | undefined> {
  try {
    await run();
  } catch (error) {
    if (error instanceof FileAdmissionRefusal) return error.reason;
    throw error;
  }
  return undefined;
}

/** Admit `bytes` named `name` as the upload route does: claims, chunks, then the written file. */
async function admit(name: string, bytes: Uint8Array, chunkSize = 4096): Promise<AdmittedType> {
  const kind = admitClaims(name, "", DOCUMENTS);
  const check = new SignatureCheck(name, kind, DOCUMENTS);
  for (let at = 0; at < bytes.byteLength; at += chunkSize) {
    check.inspect(bytes.subarray(at, at + chunkSize));
  }
  const admitted = check.finish();
  await admitWritten(admitted, readerOf(bytes), bytes.byteLength);
  return admitted;
}

const encode = (text: string) => new TextEncoder().encode(text);

describe("a Word document", () => {
  test("named .docx is admitted once its content types declare the main document", async () => {
    for (const bytes of [SAVED_DOCX, PRESUPUESTO_DOCX, officePackage("docx")]) {
      expect(await admit("Presupuesto año.docx", bytes)).toEqual({
        kind: "document",
        mime: WORD_DOCUMENT_TYPE,
      });
    }
  });

  test("named .docx is refused after the write when it is a macro document, a template or a spreadsheet", async () => {
    for (const format of ["docm", "dotx", "xlsx"] as const) {
      expect(await refusalOf(() => admit("cuentas.docx", officePackage(format))), format).toBe(
        "signature",
      );
    }
  });

  test("named .docx and locked with a password is refused as locked", async () => {
    const locked = compoundFileOf(LOCKED_WORD_STREAMS);
    expect(await refusalOf(() => admit("acta de la junta.docx", locked))).toBe("locked");
    const renamedDoc = compoundFileOf(["WordDocument", "1Table"]);
    expect(await refusalOf(() => admit("acta.docx", renamedDoc))).toBe("signature");
  });

  test("named .doc is admitted as the OLE2 container DOC, XLS, PPT and MSG share", async () => {
    expect(await admit("informe.doc", SAVED_DOC)).toEqual({
      kind: "document",
      mime: "application/msword",
    });
    expect(await admit("cuentas.doc", compoundFileOf(["Workbook"]))).toMatchObject({
      mime: "application/msword",
    });
    expect(await refusalOf(() => admit("informe.doc", officePackage("docx")))).toBe("signature");
  });

  test("is refused mid-stream by its first eight bytes when they open no zip or OLE2 file", async () => {
    const check = new SignatureCheck("cuentas.docx", "document", DOCUMENTS);
    check.inspect(encode("%PDF-1."));
    expect(await refusalOf(() => check.inspect(encode("7")))).toBe("signature");
  });
});

describe("a Markdown or text file", () => {
  test("is admitted by reading it to the end, with its encoding", async () => {
    expect(await admit("notas.md", encode("# Presupuesto del año\n"), 3)).toEqual({
      kind: "document",
      mime: "text/markdown",
      encoding: "utf-8",
    });
    const latin1 = new Uint8Array([...encode("Presupuesto a"), 0xf1, ...encode("o")]);
    expect(await admit("cuentas.txt", latin1)).toEqual({
      kind: "document",
      mime: "text/plain",
      encoding: "windows-1252",
    });
  });

  test("is refused the moment a zero byte arrives", async () => {
    const check = new SignatureCheck("notas.md", "document", DOCUMENTS);
    check.inspect(encode("# Notes\n"));
    expect(await refusalOf(() => check.inspect(new Uint8Array([0x41, 0])))).toBe("signature");
    expect(await refusalOf(() => admit("notas.txt", sampleFile("png")))).toBe("signature");
  });

  test("is recorded as its name says, whatever signature its bytes open with", async () => {
    expect(await admit("notas.md", encode("%PDF-1.7 is how a PDF opens"))).toMatchObject({
      mime: "text/markdown",
    });
    expect(await refusalOf(() => admit("manual.pdf", encode("# Not a PDF")))).toBe("signature");
  });
});

describe("a document's claims", () => {
  test("are no claim when blank or octet-stream, as systems send for .md and for .docx", () => {
    for (const name of ["notas.md", "notas.txt", "Presupuesto año.docx", "informe.doc"]) {
      for (const declared of ["", "application/octet-stream", undefined]) {
        expect(admitClaims(name, declared, DOCUMENTS)).toBe("document");
      }
    }
  });

  test("agree through aliases and container types, and are refused by a type they contradict", async () => {
    const agree = [
      ["notas.md", "text/markdown"],
      ["notas.md", "text/x-markdown"],
      ["notas.md", "text/plain; charset=utf-8"],
      ["notas.txt", "text/plain"],
      ["informe.doc", "application/msword"],
      ["informe.doc", "application/x-msword"],
      ["Presupuesto año.docx", WORD_DOCUMENT_TYPE],
      ["Presupuesto año.docx", "application/zip"],
    ] as const;
    for (const [name, declared] of agree) {
      expect(admitClaims(name, declared, DOCUMENTS), `${name} as ${declared}`).toBe("document");
    }
    const contradict = [
      ["notas.txt", "text/markdown"],
      ["notas.md", "text/html"],
      ["cuentas.docx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["informe.doc", WORD_DOCUMENT_TYPE],
    ] as const;
    for (const [name, declared] of contradict) {
      expect(await refusalOf(() => admitClaims(name, declared, DOCUMENTS))).toBe("declared_type");
    }
  });

  test("are offered to a picker by extension alone, PDF first, and each is admitted", () => {
    const offered = offeredTypes(DOCUMENTS);
    expect(admittedTypes("document")[0]).toBe("application/pdf");
    expect(offered[0]).toBe(".pdf");
    expect(offered.every((offer) => offer.startsWith("."))).toBe(true);
    for (const extension of offered) {
      expect(admitClaims(`a${extension}`, "", DOCUMENTS)).toBe("document");
    }
  });
});

describe("the check after the write", () => {
  test("reads nothing for a file whose container the stream settled", async () => {
    const read = () => Promise.reject(new Error("read"));
    for (const admitted of [
      { kind: "document", mime: "application/pdf" },
      { kind: "document", mime: "text/plain", encoding: "utf-8" },
      { kind: "image", mime: "image/png" },
    ] as const) {
      expect(await refusalOf(() => admitWritten(admitted, read, 10))).toBeUndefined();
    }
  });
});
