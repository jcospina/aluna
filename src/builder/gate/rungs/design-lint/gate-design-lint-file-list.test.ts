// A card may show a `file[]` (PLAN decision 38). Design lint hands the renderer a list of several
// scratch files, each with its own address, and contrasts it with the empty list, which is `[]`
// and never `null`.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: renderer source is string data.

import { describe, expect, test } from "bun:test";
import {
  ALBUM_FIELD,
  CAPTION_FIELD,
  photoSpec,
} from "../../../../registry/fields/file.test-support.ts";
import type { CapabilitySpec, FileFamily } from "../../../../registry/index.ts";
import { ESCAPE_HELPER } from "../../../units/generation/unit-fixtures.test-support.ts";
import { findDesignViolation } from "./gate-design-lint.ts";
import { mixedLists, probeFiles } from "./gate-file-probes.ts";

function showingTheAlbum(accepts: FileFamily[] = ["image"]): CapabilitySpec {
  const spec = photoSpec([CAPTION_FIELD, { ...ALBUM_FIELD, accepts }]);
  return {
    ...spec,
    ui_intent: { ...spec.ui_intent, item: { ...spec.ui_intent.item, shows: ["caption", "album"] } },
  };
}

/** A card whose album is drawn by `drawn`, a statement over `files`, the field's value. */
const renderer = (drawn: string) =>
  [
    "export default function renderItem(record: Record<string, unknown>): string {",
    '  const caption = escapeHtml(record.caption ?? "");',
    "  const files = record.album as { url: string; name: string; kind: string }[];",
    `  const album = ${drawn};`,
    "  return `<span>${caption}</span>${album}`;",
    "}",
    "",
    ESCAPE_HELPER,
  ].join("\n");

const EACH_PICTURE_DRAWN =
  'files.map((file) => `<img src="${escapeHtml(file.url)}" alt="">`).join("")';
const EACH_PICTURE = `files.length === 0 ? "<span>No photos yet</span>" : ${EACH_PICTURE_DRAWN}`;

describe("a probe's file list", () => {
  test("holds several files, each at an address of its own", () => {
    const spec = showingTheAlbum();
    const files = probeFiles(spec, ALBUM_FIELD, "a.jpg") as { url: string }[];
    expect(files.length).toBeGreaterThan(1);
    expect(new Set(files.map((file) => file.url)).size).toBe(files.length);
  });
});

describe("a card that draws a short list and names a long one", () => {
  const BY_KIND =
    'files.map((file) => file.kind === "video" ? `<video src="${escapeHtml(file.url)}" muted playsinline></video>` : `<img src="${escapeHtml(file.url)}" alt="">`).join("")';
  const short = (drawn: string) =>
    `files.length === 0 ? "<span>No photos yet</span>" : files.length <= 3 ? ${drawn} : \`<span>\${files.length} files</span>\``;

  test("passes when its short lists draw every file by its kind", () => {
    const spec = showingTheAlbum(["image", "video"]);
    expect(findDesignViolation(spec, renderer(short(BY_KIND)))).toBeUndefined();
  });

  test("fails when its short lists draw a video as a photo", () => {
    const spec = showingTheAlbum(["image", "video"]);
    expect(findDesignViolation(spec, renderer(short(EACH_PICTURE_DRAWN)))).toBeDefined();
  });

  test("fails when its short lists draw some files and drop the rest", () => {
    const some =
      'files.slice(0, 1).map((file) => `<img src="${escapeHtml(file.url)}" alt="">`).join("")';
    expect(findDesignViolation(showingTheAlbum(), renderer(short(some)))).toBeDefined();
  });
});

describe("a card that draws a list of one file its own way", () => {
  const NAMED =
    'files.map((file) => file.kind === "image" ? `<img src="${escapeHtml(file.url)}" alt="">` : `<span>${escapeHtml(file.name)}</span>`).join("")';
  const lone = (one: string) =>
    `files.length === 0 ? "<span>Nothing yet</span>" : files.length === 1 ? ${one} : ${NAMED}`;

  test("passes when its lone file is drawn by its kind", () => {
    const one =
      'files[0]?.kind === "image" ? `<img src="${escapeHtml(files[0].url)}" alt="">` : `<span>${escapeHtml(files[0]?.name)}</span>`';
    expect(
      findDesignViolation(showingTheAlbum(["image", "audio"]), renderer(lone(one))),
    ).toBeUndefined();
  });

  test("fails when its lone file is drawn as a photo whatever its kind", () => {
    const one = '`<img src="${escapeHtml(files[0]?.url)}" alt="">`';
    expect(
      findDesignViolation(showingTheAlbum(["image", "audio"]), renderer(lone(one))),
    ).toBeDefined();
  });

  test("fails when its lone document is called a PDF whatever its type", () => {
    expect(
      findDesignViolation(showingTheAlbum(["document"]), renderer(lone('"<span>PDF</span>"'))),
    ).toBeDefined();
  });
});

describe("a card that shows a file list", () => {
  test("passes when it draws every file and says so when the list is empty", () => {
    expect(findDesignViolation(showingTheAlbum(), renderer(EACH_PICTURE))).toBeUndefined();
  });

  test("fails when it reads the list as one file", () => {
    const one = '`<img src="${escapeHtml((files as unknown as { url: string }).url)}" alt="">`';
    expect(findDesignViolation(showingTheAlbum(), renderer(one))).toBeDefined();
  });

  test("says so when a card showing only the list draws nothing for an empty one", () => {
    const spec = showingTheAlbum();
    const albumOnly = {
      ...spec,
      ui_intent: { ...spec.ui_intent, item: { ...spec.ui_intent.item, shows: ["album"] } },
    };
    const source = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  const files = record.album as { url: string }[];",
      '  return files.map((file) => `<img src="${escapeHtml(file.url)}" alt="">`).join("");',
      "}",
      "",
      ESCAPE_HELPER,
    ].join("\n");
    expect(findDesignViolation(albumOnly, source)).toBeDefined();
  });

  test("fails a list's video drawn as a picture, file by file", () => {
    const pictures =
      'files.length === 0 ? "<span>None yet</span>" : files.map((file) => `<img src="${escapeHtml(file.url)}" alt="">`).join("")';
    expect(
      findDesignViolation(showingTheAlbum(["image", "video"]), renderer(pictures)),
    ).toBeDefined();
  });

  test("fails a card that names a list's Word file a PDF", () => {
    const pdf =
      'files.length === 0 ? "<span>None yet</span>" : files.map((file) => `<span>${escapeHtml(file.name)}</span><span>PDF</span>`).join("")';
    expect(findDesignViolation(showingTheAlbum(["document"]), renderer(pdf))).toBeDefined();
  });

  test("fails a card that draws every file by the first one's kind, read over a mixed list", () => {
    const byFirst =
      'files.length === 0 ? "<span>None yet</span>" : files.map((file) => files[0]?.kind === "video" ? `<video src="${escapeHtml(file.url)}" muted playsinline></video><span>Video</span>` : `<img src="${escapeHtml(file.url)}" alt="">`).join("")';
    expect(
      findDesignViolation(showingTheAlbum(["image", "video"]), renderer(byFirst)),
    ).toBeDefined();
  });

  test("fails a card that names every document by the first one's type, read over a mixed list", () => {
    const byFirst =
      'files.length === 0 ? "<span>None yet</span>" : files.map((file) => `<span>${escapeHtml(file.name)}</span><span>${(files[0] as unknown as { mime: string }).mime === "application/pdf" ? "PDF" : "Document"}</span>`).join("")';
    expect(findDesignViolation(showingTheAlbum(["document"]), renderer(byFirst))).toBeDefined();
  });

  test("fails a card that tests a list by its truth and calls its Word file a PDF", () => {
    const truthy =
      'record.album ? `<span>${escapeHtml(files[0]?.name ?? "")}</span><span>PDF</span>` : "<span>None yet</span>"';
    expect(findDesignViolation(showingTheAlbum(["document"]), renderer(truthy))).toBeDefined();
  });

  test("fails a card that draws only the first of a list's photos, and passes one that counts them", () => {
    const first =
      'files.length === 0 ? "<span>No photos yet</span>" : `<img src="${escapeHtml(files[0]?.url ?? "")}" alt=""><span>${files.length} photos</span>`';
    expect(findDesignViolation(showingTheAlbum(), renderer(first))).toBeDefined();
    const counted =
      'files.length === 0 ? "<span>No photos yet</span>" : `<span>${files.length} photos</span>`';
    expect(findDesignViolation(showingTheAlbum(), renderer(counted))).toBeUndefined();
  });

  test("fails a card that previews the first few of a list's photos and counts the rest", () => {
    const preview =
      'files.length === 0 ? "<span>No photos yet</span>" : files.slice(0, 3).map((file) => `<img src="${escapeHtml(file.url)}" alt="">`).join("") + `<span>${files.length} photos</span>`';
    expect(findDesignViolation(showingTheAlbum(), renderer(preview))).toBeDefined();
  });

  test("mixes every family a list takes, documents among them", () => {
    const spec = showingTheAlbum(["image", "video", "audio", "document"]);
    const baseline = { album: [] };
    const families = mixedLists(spec, baseline, "a.jpg").map(
      ({ record }) => new Set((record.album as { kind: string }[]).map((file) => file.kind)),
    );
    expect(families.some((kinds) => kinds.size === 4)).toBe(true);
  });

  test("passes a card that draws each file by its own kind and names each document", () => {
    const right =
      'files.length === 0 ? "<span>None yet</span>" : files.map((file) => file.kind === "video" ? `<span class="media-frame media-frame--wide"><video src="${escapeHtml(file.url)}" muted playsinline></video></span><span>Video</span>` : file.kind === "image" ? `<img src="${escapeHtml(file.url)}" alt="">` : `<span>${escapeHtml(file.name)}</span>`).join("")';
    for (const accepts of [
      ["image", "video"],
      ["document"],
      ["image", "video", "audio", "document"],
    ] as FileFamily[][]) {
      expect(findDesignViolation(showingTheAlbum(accepts), renderer(right))).toBeUndefined();
    }
  });
});
