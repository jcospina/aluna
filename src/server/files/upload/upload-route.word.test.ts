import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  compoundFileOf,
  LOCKED_WORD_STREAMS,
  officePackage,
  PRESUPUESTO_DOCX,
} from "../../../platform/files/admission/documents/office-samples.test-support.ts";
import { WORD_DOCUMENT_TYPE } from "../../../platform/files/admission/documents/word-package.ts";
import {
  DOCUMENTS_NAMED_AS,
  LOCKED_SENTENCE,
  misnamedSentence,
} from "../../../platform/files/admission/refusal-copy.ts";
import { contentDisposition } from "../../../platform/files/file-name.ts";
import * as registryStore from "../../../registry/store/store.ts";
import { answeredReference, useFileRoutes } from "../file-routes.test-support.ts";
import { DOWNLOAD_POLICY } from "../serve/serve-route.ts";

const files = useFileRoutes();

/** What Chrome sends for a link with `download`; Firefox, and a plain link, send `document`. */
const DOWNLOADED = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "empty" };

const NOT_THE_WORD_DOCUMENT = misnamedSentence(DOCUMENTS_NAMED_AS.get("docx") ?? "");

let takesDocuments: { mockRestore(): void } | undefined;

beforeEach(() => {
  const real = registryStore.getCapability;
  takesDocuments = spyOn(registryStore, "getCapability").mockImplementation((id, database) => {
    const row = real(id, database);
    if (!row) return row;
    const fields = row.schema.fields.map((field) =>
      field.name === "photo" ? { ...field, accepts: ["document" as const] } : field,
    );
    return { ...row, schema: { ...row.schema, fields } } as typeof row;
  });
});

afterEach(() => takesDocuments?.mockRestore());

function expectNothingLeft(): void {
  expect(files.staged()).toEqual([]);
  expect(files.stored()).toEqual([]);
  expect(files.ledgerRows()).toEqual([]);
}

describe("a Word document that travels in", () => {
  test("with no declared type is admitted and downloads under its own accented name", async () => {
    const name = "Presupuesto año.docx";
    const response = await files.upload(PRESUPUESTO_DOCX, { name, type: "" });
    expect(response.status).toBe(201);
    const reference = await answeredReference(response);
    expect(reference).toMatchObject({ kind: "document", mime: WORD_DOCUMENT_TYPE, name });

    const app = files.app();
    const served = await app.request(reference.url, { headers: DOWNLOADED });
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PRESUPUESTO_DOCX);
    const disposition = served.headers.get("content-disposition");
    expect(disposition).toBe(contentDisposition("attachment", name));
    expect(disposition).toContain(`filename*=UTF-8''Presupuesto%20a%C3%B1o.docx`);
    // Read after every middleware has run: one policy, the download's, and none added behind it.
    expect(served.headers.get("content-security-policy")).toBe(DOWNLOAD_POLICY);
    expect(served.headers.get("content-type")).toBe(WORD_DOCUMENT_TYPE);
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    const [row] = files.ledgerRows();
    expect(row).toMatchObject({ mime: WORD_DOCUMENT_TYPE, encoding: null });
  });

  test("is refused to a page's own script and to a load that would run it", async () => {
    const response = await files.upload(PRESUPUESTO_DOCX, { name: "presupuesto.docx" });
    const { url } = await answeredReference(response);
    const app = files.app();
    const status = async (mode: string, dest: string) =>
      (await app.request(url, { headers: { "sec-fetch-mode": mode, "sec-fetch-dest": dest } }))
        .status;
    expect(await status("cors", "empty")).toBe(404);
    expect(await status("no-cors", "script")).toBe(404);
    expect(await status("navigate", "document")).toBe(200);
    expect(await status("navigate", "empty")).toBe(200);
    expect(await status("", "")).toBe(200);
  });

  test("that is a spreadsheet, a macro document or a template is refused after the write", async () => {
    for (const format of ["xlsx", "docm", "dotx"] as const) {
      const response = await files.upload(officePackage(format), {
        name: "cuentas.docx",
        type: WORD_DOCUMENT_TYPE,
      });
      expect(response.status, format).toBe(415);
      expect(await response.json()).toEqual({
        refusal: "signature",
        message: NOT_THE_WORD_DOCUMENT,
      });
    }
    expectNothingLeft();
  });

  test("locked with a password is refused with a sentence that says so", async () => {
    const response = await files.upload(compoundFileOf(LOCKED_WORD_STREAMS), {
      name: "acta de la junta.docx",
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ refusal: "locked", message: LOCKED_SENTENCE });
    expectNothingLeft();
  });

  test("in the older format is admitted as OLE2 and downloads", async () => {
    const response = await files.upload(compoundFileOf(["WordDocument", "1Table"]), {
      name: "informe.doc",
      type: "application/msword",
    });
    expect(response.status).toBe(201);
    const { url } = await answeredReference(response);
    const served = await files.app().request(url, { headers: DOWNLOADED });
    expect(served.headers.get("content-disposition")).toBe(
      contentDisposition("attachment", "informe.doc"),
    );
  });
});

describe("a Markdown or text file that travels in", () => {
  test("is admitted with no declared type, its encoding recorded, and downloads", async () => {
    const markdown = new TextEncoder().encode("# Presupuesto\n\nCafé y té.\n");
    const response = await files.upload(markdown, { name: "notas.md" });
    expect(response.status).toBe(201);
    const { url } = await answeredReference(response);
    expect(files.ledgerRows()[0]).toMatchObject({ mime: "text/markdown", encoding: "utf-8" });
    const served = await files.app().request(url, { headers: DOWNLOADED });
    expect(served.headers.get("content-disposition")).toBe(
      contentDisposition("attachment", "notas.md"),
    );
    expect(served.headers.get("content-security-policy")).toBe(DOWNLOAD_POLICY);
  });

  test("in Windows-1252 or UTF-16 is admitted with that encoding", async () => {
    const latin1 = new Uint8Array([...new TextEncoder().encode("A"), 0xf1, 0x6f]);
    const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0, 0xf1, 0]);
    for (const [bytes, encoding] of [
      [latin1, "windows-1252"],
      [utf16, "utf-16le"],
    ] as const) {
      const response = await files.upload(bytes, { name: `cuentas-${encoding}.txt` });
      expect(response.status, encoding).toBe(201);
      const { key } = await answeredReference(response);
      const row = files.ledgerRows().find((candidate) => candidate.key === key);
      expect(row?.encoding).toBe(encoding);
    }
  });

  test("holding a zero byte and no UTF-16 BOM is refused, and nothing is kept", async () => {
    const response = await files.upload(new Uint8Array([0x41, 0, 0x42, 0]), { name: "notas.txt" });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      refusal: "signature",
      message: misnamedSentence(DOCUMENTS_NAMED_AS.get("txt") ?? ""),
    });
    expectNothingLeft();
  });
});
