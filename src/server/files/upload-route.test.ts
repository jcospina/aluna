import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SIGNATURE_WINDOW_BYTES } from "../../platform/files/admission.ts";
import { inlineContentDisposition } from "../../platform/files/file-name.ts";
import { fileUrl } from "../../platform/files/file-url.ts";
import { NOT_ADMITTED_SENTENCES } from "../../platform/files/refusal-copy.ts";
import { sampleFile } from "../../platform/files/sample-files.test-support.ts";
import { fileUploadPath } from "../../platform/files/upload-path.ts";
import { SECOND_INCARNATION_ID } from "../../registry/incarnations.test-support.ts";
import * as registryStore from "../../registry/store/store.ts";
import { createBody } from "../../runtime/router/dispatch/router.file.test-support.ts";
import { probeBody } from "../http/writing-route-guard.test-support.ts";
import {
  answeredReference,
  PHOTO_UPLOAD_PATH,
  PHOTOS,
  uploadInit,
  useFileRoutes,
} from "./file-routes.test-support.ts";

const files = useFileRoutes();

const NOT_A_PHOTO = NOT_ADMITTED_SENTENCES.image;

/** Nothing staged, nothing in place, no row: what every refused upload must leave. */
function expectNothingLeft(): void {
  expect(files.staged()).toEqual([]);
  expect(files.stored()).toEqual([]);
  expect(files.ledgerRows()).toEqual([]);
}

describe("a photo that travels in", () => {
  test("streams in, is recorded pending, and comes back from the address it was given", async () => {
    const bytes = sampleFile("jpeg", 200_000);
    const response = await files.upload(bytes, { name: "harbour at dawn.jpg", type: "image/jpeg" });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const reference = await answeredReference(response);
    const { key } = reference;
    expect(reference).toEqual({
      key,
      url: fileUrl(key),
      name: "harbour at dawn.jpg",
      kind: "image",
      mime: "image/jpeg",
      size: bytes.byteLength,
    });
    expect(files.ledgerRows()).toEqual([
      expect.objectContaining({
        key,
        capability_id: PHOTOS.capabilityId,
        incarnation_id: PHOTOS.incarnationId,
        field: "photo",
        record_id: null,
        state: "pending",
        kind: "image",
        mime: "image/jpeg",
        size: bytes.byteLength,
        name: "harbour at dawn.jpg",
      }),
    ]);
    expect(files.staged()).toEqual([]);
    expect(files.stored()).toEqual([key]);
    expect(new Uint8Array(readFileSync(join(files.root(), key)))).toEqual(bytes);

    const served = await files.app().request(reference.url);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
  });

  test("is recorded under the type its bytes proved, not the one its name suggests", async () => {
    const response = await files.upload(sampleFile("png"), { name: "scan.jpg" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ kind: "image", mime: "image/png" });
    expect(files.ledgerRows()[0]).toMatchObject({ mime: "image/png" });
  });

  test("hands back the key a save then claims", async () => {
    const { key } = await answeredReference(
      await files.upload(sampleFile("webp"), { name: "tide.webp" }),
    );
    const saved = await files.app().request("/capability/photos/create", createBody("Tide", key));
    expect(saved.status).toBe(200);
    expect(files.ledgerRows()).toEqual([expect.objectContaining({ key, state: "owned" })]);
  });
});

describe("the upload's address", () => {
  test("names the incarnation and the field, and any other is refused before a byte is read", async () => {
    const paths = [
      fileUploadPath(PHOTOS.capabilityId, SECOND_INCARNATION_ID, "photo"),
      fileUploadPath("nobody", PHOTOS.incarnationId, "photo"),
      fileUploadPath(PHOTOS.capabilityId, PHOTOS.incarnationId, "missing"),
      fileUploadPath(PHOTOS.capabilityId, PHOTOS.incarnationId, "caption"),
    ];
    for (const path of paths) {
      const body = probeBody(64 * 1024);
      const response = await files.app().request(path, uploadInit(body.stream));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body.pulledBytes()).toBe(0);
    }
    expectNothingLeft();
  });

  test("refuses another site before a byte is read", async () => {
    const body = probeBody(64 * 1024);
    const response = await files
      .app()
      .request(PHOTO_UPLOAD_PATH, uploadInit(body.stream, { site: "cross-site" }));
    expect(response.status).toBe(403);
    expect(body.pulledBytes()).toBe(0);
    expectNothingLeft();
  });

  test("counts a streamed body against the file cap, and a body at the cap passes", async () => {
    const cap = 8 * 1024;
    const over = await files.upload(sampleFile("jpeg", cap + 1), {}, { maxFileBytes: cap });
    const chunked = new Response(sampleFile("jpeg", cap + 1)).body;
    const counted = await files
      .app({ maxFileBytes: cap })
      .request(PHOTO_UPLOAD_PATH, uploadInit(chunked ?? new Uint8Array()));
    for (const refused of [over, counted]) expect(refused.status).toBe(413);
    expectNothingLeft();

    const atCap = await files.upload(sampleFile("jpeg", cap), {}, { maxFileBytes: cap });
    expect(atCap.status).toBe(201);
  });
});

describe("a filename", () => {
  test("`日本.jpg` round-trips into the disposition its file is served with", async () => {
    const response = await files.upload(sampleFile("jpeg"), { name: "日本.jpg" });
    const reference = await answeredReference(response);
    expect(reference.name).toBe("日本.jpg");
    expect(files.ledgerRows()[0]?.name).toBe("日本.jpg");
    const served = await files.app().request(reference.url);
    expect(served.headers.get("content-disposition")).toBe(inlineContentDisposition("日本.jpg"));
  });

  test("is kept NFC, without control or bidirectional characters, and within 255 bytes", async () => {
    const override = String.fromCodePoint(0x202e);
    const decomposed = `cafe${String.fromCodePoint(0x301)}`;
    const name = `${decomposed}${override}${"\n"}${"x".repeat(300)}.jpg`;
    const reference = await answeredReference(await files.upload(sampleFile("jpeg"), { name }));
    const stored = files.ledgerRows()[0]?.name ?? "";
    expect(stored).toBe(reference.name);
    expect(stored.startsWith(`caf${String.fromCodePoint(0xe9)}xxx`)).toBe(true);
    expect(stored.endsWith(".jpg")).toBe(true);
    expect(new TextEncoder().encode(stored).byteLength).toBe(255);
  });

  test("that is not percent-encoded UTF-8 is refused before a byte is read", async () => {
    const body = probeBody(64 * 1024);
    const response = await files
      .app()
      .request(PHOTO_UPLOAD_PATH, uploadInit(body.stream, { rawName: "100%.jpg" }));
    expect(response.status).toBe(400);
    expect(body.pulledBytes()).toBe(0);
    expectNothingLeft();
  });
});

describe("admission", () => {
  test("refuses a wrong extension or a contradicting type before a byte is read", async () => {
    const cases = [
      [{ name: "notes.txt" }, "extension"],
      [{ name: "vector.svg", type: "image/svg+xml" }, "extension"],
      [{ name: "scan.tiff", type: "image/tiff" }, "extension"],
      [{ name: "phone.heic", type: "image/heic" }, "extension"],
      [{ name: "photo.jpg", type: "image/png" }, "declared_type"],
      [{ name: "photo.png", type: "image/svg+xml" }, "declared_type"],
    ] as const;
    for (const [options, refusal] of cases) {
      const body = probeBody(64 * 1024);
      const response = await files
        .app()
        .request(PHOTO_UPLOAD_PATH, uploadInit(body.stream, options));
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ refusal, message: NOT_A_PHOTO });
      expect(body.pulledBytes()).toBe(0);
    }
    expectNothingLeft();
  });

  test("refuses bytes that match no image row: HEIC under .jpg, TIFF, SVG, text, nothing", async () => {
    const cases = [
      [sampleFile("heic"), "phone.jpg"],
      [sampleFile("mif1"), "phone.avif"],
      [sampleFile("tiffLittle"), "scan.jpg"],
      [sampleFile("svg"), "vector.png"],
      [sampleFile("text"), "notes.gif"],
      [new Uint8Array(0), "empty.jpg"],
    ] as const;
    for (const [bytes, name] of cases) {
      const response = await files.upload(bytes, { name });
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ refusal: "signature", message: NOT_A_PHOTO });
    }
    expectNothingLeft();
  });

  test("aborts a mismatch within the first 64 KB instead of reading the whole body", async () => {
    const body = probeBody(50 * 1024 * 1024);
    const response = await files
      .app()
      .request(PHOTO_UPLOAD_PATH, uploadInit(body.stream, { name: "notes.jpg" }));
    expect(response.status).toBe(415);
    expect(body.pulledBytes()).toBeLessThanOrEqual(SIGNATURE_WINDOW_BYTES);
    expect(body.cancelled()).toBe(true);
    expectNothingLeft();
  });
});

describe("a filename that tries something", () => {
  test("sent as raw bytes rather than escapes is refused before a byte is read", async () => {
    const body = probeBody(64 * 1024);
    const latin1 = [0xe6, 0x97, 0xa5].map((code) => String.fromCharCode(code)).join("");
    const response = await files
      .app()
      .request(PHOTO_UPLOAD_PATH, uploadInit(body.stream, { rawName: `${latin1}.jpg` }));
    expect(response.status).toBe(400);
    expect(body.pulledBytes()).toBe(0);
    expectNothingLeft();
  });

  test("whose cap would leave an image extension behind is judged by the one it had", async () => {
    const name = `${"y".repeat(251)}.jpg${"Z".repeat(40)}`;
    const response = await files.upload(sampleFile("jpeg"), { name });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ refusal: "extension", message: NOT_A_PHOTO });
    expectNothingLeft();
  });

  test("joined across a stripped NUL is admitted by its bytes alone", async () => {
    const text = await files.upload(sampleFile("text"), { rawName: "notes.txt%00.jpg" });
    expect(await text.json()).toEqual({ refusal: "signature", message: NOT_A_PHOTO });
    expectNothingLeft();
    const photo = await files.upload(sampleFile("jpeg"), { rawName: "notes.txt%00.jpg" });
    expect(await answeredReference(photo)).toMatchObject({
      name: "notes.txt.jpg",
      mime: "image/jpeg",
    });
  });
});

describe("a field", () => {
  test("refuses a family it does not take before a byte is read", async () => {
    const real = registryStore.getCapability;
    const takesVideo = spyOn(registryStore, "getCapability").mockImplementation((id, database) => {
      const row = real(id, database);
      if (!row) return row;
      const fields = row.schema.fields.map((field) =>
        field.name === "photo" ? { ...field, accepts: ["video"] } : field,
      );
      return { ...row, schema: { ...row.schema, fields } } as typeof row;
    });
    try {
      const body = probeBody(64 * 1024);
      const response = await files.app().request(PHOTO_UPLOAD_PATH, uploadInit(body.stream));
      expect(response.status).toBe(415);
      expect(await response.json()).toMatchObject({ refusal: "not_accepted" });
      expect(body.pulledBytes()).toBe(0);
      expectNothingLeft();
    } finally {
      takesVideo.mockRestore();
    }
  });
});
