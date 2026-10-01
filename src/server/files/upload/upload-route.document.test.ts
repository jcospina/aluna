import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { SIGNATURE_WINDOW_BYTES } from "../../../platform/files/admission/admission.ts";
import {
  DOCUMENTS_NAMED_AS,
  misnamedSentence,
  NOT_ADMITTED_SENTENCES,
} from "../../../platform/files/admission/refusal-copy.ts";
import { sampleFile } from "../../../platform/files/admission/sample-files.test-support.ts";
import { contentDisposition } from "../../../platform/files/file-name.ts";
import type { FileFamily } from "../../../registry/fields/file.ts";
import * as registryStore from "../../../registry/store/store.ts";
import { probeBody } from "../../http/writing-route-guard.test-support.ts";
import {
  answeredReference,
  PHOTO_UPLOAD_PATH,
  uploadInit,
  useFileRoutes,
} from "../file-routes.test-support.ts";
import { PDF_POLICY } from "../serve/serve-route.ts";

const files = useFileRoutes();

const NOT_A_DOCUMENT = NOT_ADMITTED_SENTENCES.document;
const NOT_THE_PDF = misnamedSentence(DOCUMENTS_NAMED_AS.get("pdf") ?? "");

/** What a browser sends when a link opens the file in a tab of its own. */
const OPENED_IN_A_TAB = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

let accepts: readonly FileFamily[] = ["document"];
let takesDocuments: { mockRestore(): void } | undefined;

beforeEach(() => {
  accepts = ["document"];
  const real = registryStore.getCapability;
  takesDocuments = spyOn(registryStore, "getCapability").mockImplementation((id, database) => {
    const row = real(id, database);
    if (!row) return row;
    const fields = row.schema.fields.map((field) =>
      field.name === "photo" ? { ...field, accepts: [...accepts] } : field,
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

describe("a PDF that travels in", () => {
  test("is admitted by its signature and opens inline under its own policy", async () => {
    const bytes = sampleFile("pdf", 300_000);
    const name = "Kettle manual.pdf";
    const response = await files.upload(bytes, { name, type: "application/pdf" });
    expect(response.status).toBe(201);
    const reference = await answeredReference(response);
    expect(reference).toMatchObject({ kind: "document", mime: "application/pdf" });

    const app = files.app();
    const served = await app.request(reference.url, { headers: OPENED_IN_A_TAB });
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
    // Read after every middleware has run: one policy, the PDF's, and none added behind it.
    expect(served.headers.get("content-security-policy")).toBe(PDF_POLICY);
    expect(served.headers.get("content-type")).toBe("application/pdf");
    expect(served.headers.get("content-disposition")).toBe(contentDisposition("inline", name));
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    const page = await app.request("/");
    for (const header of ["x-frame-options", "referrer-policy"]) {
      expect(served.headers.get(header), header).toBe(page.headers.get(header));
    }
  });

  test("is refused to a page's own script, to a player, and to a load that would run it", async () => {
    const response = await files.upload(sampleFile("pdf"), { name: "manual.pdf" });
    const { url } = await answeredReference(response);
    const app = files.app();
    const status = async (mode: string, dest: string) =>
      (await app.request(url, { headers: { "sec-fetch-mode": mode, "sec-fetch-dest": dest } }))
        .status;
    expect(await status("cors", "empty")).toBe(404);
    expect(await status("cors", "video")).toBe(404);
    for (const dest of ["script", "style", "worker", "serviceworker", "json"]) {
      expect(await status("no-cors", dest), dest).toBe(404);
    }
    // Chrome's viewer saves the file by asking for it again, as a navigation to nowhere.
    expect(await status("navigate", "empty")).toBe(200);
  });

  test("is admitted under an alias or no claim, and refused under another type", async () => {
    for (const type of ["application/x-pdf", "application/octet-stream", ""]) {
      const response = await files.upload(sampleFile("pdf"), { name: "manual.PDF", type });
      expect(response.status, type).toBe(201);
    }
    const lying = await files.upload(sampleFile("pdf"), { name: "manual.pdf", type: "text/html" });
    expect(lying.status).toBe(415);
    expect(await lying.json()).toEqual({ refusal: "declared_type", message: NOT_A_DOCUMENT });
  });

  test("is refused by a field that takes no documents", async () => {
    accepts = ["image"];
    const response = await files.upload(sampleFile("pdf"), { name: "manual.pdf" });
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ refusal: "not_accepted" });
    expectNothingLeft();
  });
});

describe("a file renamed .pdf", () => {
  test("is refused by its bytes", async () => {
    for (const format of ["jpeg", "text", "svg"] as const) {
      const response = await files.upload(sampleFile(format), { name: "manual.pdf" });
      expect(response.status, format).toBe(415);
      expect(await response.json()).toEqual({ refusal: "signature", message: NOT_THE_PDF });
    }
    expectNothingLeft();
  });

  test("is refused mid-stream, the rest of the body never read", async () => {
    const body = probeBody(50 * 1024 * 1024, "<html><script>alert(1)</script>");
    const response = await files
      .app()
      .request(PHOTO_UPLOAD_PATH, uploadInit(body.stream, { name: "manual.pdf" }));
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ refusal: "signature", message: NOT_THE_PDF });
    expect(body.pulledBytes()).toBeLessThanOrEqual(SIGNATURE_WINDOW_BYTES);
    expect(body.cancelled()).toBe(true);
    expectNothingLeft();
  });
});
