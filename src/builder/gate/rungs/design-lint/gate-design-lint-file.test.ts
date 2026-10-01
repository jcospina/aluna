// A card may show a file field (PLAN decision 29). Design lint hands the renderer a scratch file
// named with markup and an emoji, and contrasts it with no file at all, the case a template most
// often forgets (PLAN decision 38).
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: renderer source is string data.

import { describe, expect, spyOn, test } from "bun:test";
import * as admission from "../../../../platform/files/admission/admission.ts";
import { WORD_DOCUMENT_TYPE } from "../../../../platform/files/admission/documents/word-package.ts";
import { enforceItemMarkup } from "../../../../presentation/index.ts";
import { PHOTO_FIELD, photoSpec } from "../../../../registry/fields/file.test-support.ts";
import type { CapabilitySpec } from "../../../../registry/index.ts";
import { validSpec } from "../../../../registry/spec/spec.test-support.ts";
import { FEW_SHOT_DESIGN_EXAMPLES } from "../../../units/generation/few-shot/few-shot-gallery.ts";
import { ESCAPE_HELPER } from "../../../units/generation/unit-fixtures.test-support.ts";
import { loadItemRenderer } from "../../gate-internal.ts";
import { scratchFileType, tokenFileName } from "../../gate-scratch-names.ts";
import { findDesignViolation } from "./gate-design-lint.ts";
import { mislabelledDocument } from "./gate-file-kinds.ts";

function showingThePhoto() {
  const spec = photoSpec();
  return {
    ...spec,
    ui_intent: { ...spec.ui_intent, item: { ...spec.ui_intent.item, shows: ["caption", "photo"] } },
  };
}

const renderer = (photo: string) =>
  [
    "export default function renderItem(record: Record<string, unknown>): string {",
    '  const caption = escapeHtml(record.caption ?? "");',
    "  const file = record.photo as { url: string; name: string } | null;",
    `  const photo = ${photo};`,
    "  return `<span>${caption}</span>${photo}`;",
    "}",
    "",
    ESCAPE_HELPER,
  ].join("\n");

const DRAWS_BOTH =
  'file ? `<img src="${escapeHtml(file.url)}" alt="">` : "<span>No photo yet</span>"';

describe("a card that shows a file field", () => {
  test("passes when it draws the picture from its url and an empty state for none", () => {
    expect(findDesignViolation(showingThePhoto(), renderer(DRAWS_BOTH))).toBeUndefined();
  });

  test("fails when it forgets the empty field", () => {
    const forgets = '`<img src="${escapeHtml(file!.url)}" alt="">`';
    expect(findDesignViolation(showingThePhoto(), renderer(forgets))).toContain(
      "the renderer threw",
    );
  });

  test("fails when it never draws the photo it declares", () => {
    expect(findDesignViolation(showingThePhoto(), renderer('""'))).toContain(
      'declared item field "photo"',
    );
  });

  test("says so when a card that shows only the photo draws nothing without one", () => {
    const photoOnly = {
      ...showingThePhoto(),
      ui_intent: {
        ...showingThePhoto().ui_intent,
        item: { ...showingThePhoto().ui_intent.item, shows: ["photo"] },
      },
    };
    const source = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  const file = record.photo as { url: string } | null;",
      '  return file ? `<img src="${escapeHtml(file.url)}" alt="">` : "";',
      "}",
      "",
      ESCAPE_HELPER,
    ].join("\n");
    expect(findDesignViolation(photoOnly, source)).toContain(
      'drew nothing for a record whose file field "photo" holds no file',
    );
  });

  test("fails when it writes the file's name unescaped", () => {
    const raw = 'file ? `<span>${file.name}</span>` : "<span>No photo yet</span>"';
    expect(findDesignViolation(showingThePhoto(), renderer(raw))).toContain(
      "the platform enforcer had to neutralize the output",
    );
  });

  test("still fails when a shown text field is discarded", () => {
    const discards = renderer(DRAWS_BOTH).replace(
      'escapeHtml(record.caption ?? "")',
      '"A caption"',
    );
    expect(findDesignViolation(showingThePhoto(), discards)).toContain(
      'declared item field "caption"',
    );
  });
});

describe("a card whose file field takes photos and videos", () => {
  const either = () => {
    const spec = showingThePhoto();
    const fields = spec.schema.fields.map((field) =>
      field.name === "photo" ? { ...field, accepts: ["image" as const, "video" as const] } : field,
    );
    return { ...spec, schema: { fields } };
  };
  const byKind = (video: string) =>
    renderer(
      `!file ? "<span>Nothing yet</span>" : (file as { kind?: string }).kind === "video" ? ${video} : \`<img src="\${escapeHtml(file.url)}" alt="">\``,
    );

  test("passes when every family it takes is drawn inside the contract", () => {
    const video =
      '`<video src="${escapeHtml(file.url)}" muted playsinline></video><span>Video</span>`';
    expect(findDesignViolation(either(), byKind(video))).toBeUndefined();
  });

  test("fails when it draws a video as a picture, or a photo as a video", () => {
    const asPicture = '`<img src="${escapeHtml(file.url)}" alt=""><span>Video</span>`';
    expect(findDesignViolation(either(), byKind(asPicture))).toContain(
      "it draws a video with <img>, as if it were a photo",
    );
    const videosOnly = () => {
      const spec = either();
      const fields = spec.schema.fields.map((field) =>
        field.name === "photo" ? { ...field, accepts: ["video" as const] } : field,
      );
      return { ...spec, schema: { fields } };
    };
    expect(findDesignViolation(videosOnly(), renderer(DRAWS_BOTH))).toContain(
      "it draws a video with <img>",
    );
    const photoAsVideo = renderer(
      'file ? `<video src="${escapeHtml(file.url)}" muted playsinline></video>` : "<span>None</span>"',
    );
    expect(findDesignViolation(showingThePhoto(), photoAsVideo)).toContain(
      "it draws a photo with <video>, as if it were a video",
    );
  });

  test("is reviewed down its video branch, not only the photo's", () => {
    const controls = '`<video src="${escapeHtml(file.url)}" controls></video>`';
    expect(findDesignViolation(either(), byKind(controls))).toContain(
      "for a synthetic video record the platform enforcer had to neutralize the output",
    );
    const throws = '(() => { throw new Error("no video branch"); })()';
    expect(findDesignViolation(either(), byKind(throws))).toContain("no video branch");
  });
});

describe("a card whose file field takes sounds", () => {
  const takes = (...accepts: ("image" | "audio")[]) => {
    const spec = showingThePhoto();
    const fields = spec.schema.fields.map((field) =>
      field.name === "photo" ? { ...field, accepts } : field,
    );
    return { ...spec, schema: { fields } };
  };
  const inWords = 'file ? "<span>Audio</span>" : "<span>No recording yet</span>"';
  const drawing = (drawn: string) => renderer(`file ? ${drawn} : "<span>None</span>"`);

  test("passes when it says in words that the record holds a sound", () => {
    expect(findDesignViolation(takes("audio"), renderer(inWords))).toBeUndefined();
  });

  test("fails when it draws the sound in a player, a source or a picture", () => {
    for (const drawn of [
      '`<audio src="${escapeHtml(file.url)}"></audio>`',
      '`<audio><source src="${escapeHtml(file.url)}"></audio>`',
      '`<img src="${escapeHtml(file.url)}" alt="">`',
      '`<video src="${escapeHtml(file.url)}" muted playsinline></video>`',
      '`<audio src="${escapeHtml(file.url).replaceAll("/", "&#47;")}"></audio>`',
      '`<audio src="${escapeHtml(file.url).replace("5", "%35").toUpperCase()}"></audio>`',
      '`<audio src="${escapeHtml(file.url).replace("5", "%35")}?x=%"></audio>`',
      '`<audio src="${escapeHtml(file.url).replace("5", "5&#9;")}"></audio>`',
      '`<audio src="${escapeHtml(file.url).replaceAll("/", "\\\\")}"></audio>`',
      '`<audio src="${escapeHtml(file.url).replace("/files/", "/files/./")}"></audio>`',
      '`<img srcset="/x.png 1x, ${escapeHtml(file.url)} 2x" alt="">`',
      'file.name.endsWith(".mp3") ? `<audio src="${escapeHtml(file.url)}"></audio>` : "<span>Audio</span>"',
    ]) {
      expect(findDesignViolation(takes("audio"), drawing(drawn))).toBeDefined();
    }
  });

  test("fails when it frames a sound, which has no picture", () => {
    const framed = '`<span class="media-frame media-frame--wide"><span>Audio</span></span>`';
    expect(findDesignViolation(takes("audio"), drawing(framed))).toBeDefined();
    const byKind = renderer(
      `!file ? "<span>None</span>" : (file as { kind?: string }).kind === "audio" ? ${framed} : \`<img src="\${escapeHtml(file.url)}" alt="">\``,
    );
    expect(findDesignViolation(takes("image", "audio"), byKind)).toContain(
      "A sound has no picture",
    );
    const photoFramed = renderer(
      `!file ? "<span>None</span>" : (file as { kind?: string }).kind === "audio" ? "<span>Audio</span>" : \`<span class="media-frame"><img src="\${escapeHtml(file.url)}" alt=""></span>\``,
    );
    expect(findDesignViolation(takes("image", "audio"), photoFramed)).toBeUndefined();
  });

  test("fails when it draws the sound, beside a file field of another family it doesn't show", () => {
    const spec = takes("audio");
    const cover = { ...PHOTO_FIELD, name: "cover", label: "Cover", accepts: ["image" as const] };
    const both = { ...spec, schema: { fields: [cover, ...spec.schema.fields] } };
    expect(findDesignViolation(both, renderer(inWords))).toBeUndefined();
    const player = '`<audio src="${escapeHtml(file.url)}"></audio>`';
    expect(findDesignViolation(both, drawing(player))).toBeDefined();
  });

  test("is reviewed down its sound branch, not only the photo's", () => {
    const photoOrSound = renderer(
      `!file ? "<span>None</span>" : \`<img src="\${escapeHtml(file.url)}" alt="">\``,
    );
    expect(findDesignViolation(takes("image", "audio"), photoOrSound)).toContain(
      "for a synthetic audio record",
    );
  });
});

const takes = (...accepts: ("image" | "document")[]) => {
  const spec = showingThePhoto();
  const fields = spec.schema.fields.map((field) =>
    field.name === "photo" ? { ...field, accepts } : field,
  );
  return { ...spec, schema: { fields } };
};

/** A document said in words: "PDF" for a PDF, "Document" for any other type. */
const inWords =
  'file ? `<span>${(file as { mime?: string }).mime === "application/pdf" ? "PDF" : "Document"}</span>` : "<span>No manual yet</span>"';

describe("a card whose file field takes documents", () => {
  const drawing = (drawn: string) => renderer(`file ? ${drawn} : "<span>None</span>"`);

  test("passes when it says in words that the record holds a document", () => {
    expect(findDesignViolation(takes("document"), renderer(inWords))).toBeUndefined();
  });

  test("fails when it draws the document as a picture or in a player", () => {
    for (const drawn of [
      '`<img src="${escapeHtml(file.url)}" alt="">`',
      '`<video src="${escapeHtml(file.url)}" muted playsinline></video>`',
      '`<img srcset="/x.png 1x, ${escapeHtml(file.url)} 2x" alt="">`',
    ]) {
      expect(findDesignViolation(takes("document"), drawing(drawn))).toContain("a document");
    }
  });

  test("fails when it frames a document, which has no picture", () => {
    const framed = '`<span class="media-frame"><span>Document</span></span>`';
    expect(findDesignViolation(takes("document"), drawing(framed))).toContain("media-frame");
    const byKind = renderer(
      `!file ? "<span>None</span>" : (file as { kind?: string }).kind === "document" ? ${framed} : \`<img src="\${escapeHtml(file.url)}" alt="">\``,
    );
    expect(findDesignViolation(takes("image", "document"), byKind)).toContain(
      "A document has no picture",
    );
  });

  test("fails a frame round a document's words beside a photo field it also shows", () => {
    const spec = takes("document");
    const cover = { ...PHOTO_FIELD, name: "cover", label: "Cover", accepts: ["image" as const] };
    const shows = [...spec.ui_intent.item.shows, "cover"];
    const both = {
      ...spec,
      schema: { fields: [cover, ...spec.schema.fields] },
      ui_intent: { ...spec.ui_intent, item: { ...spec.ui_intent.item, shows } },
    };
    const withCover = (manual: string) =>
      renderer(manual).replace(
        "return `",
        'const art = record.cover ? `<span class="media-frame"><img src="${escapeHtml((record.cover as { url: string }).url)}" alt=""></span>` : `<span class="media-frame"><span>No cover</span></span>`;\n  return `${art}',
      );
    expect(findDesignViolation(both, withCover(inWords))).toBeUndefined();
    const framed = '`<span class="media-frame"><span>Document</span></span>`';
    expect(
      findDesignViolation(both, withCover(`file ? ${framed} : "<span>None</span>"`)),
    ).toContain("A document has no picture");
  });

  test("is reviewed down every type a document may be recorded as, not only a PDF's", () => {
    const real = admission.admittedTypes;
    const types = spyOn(admission, "admittedTypes").mockImplementation((kind) =>
      kind === "document" ? [...real(kind), "text/plain"] : real(kind),
    );
    try {
      const byType = renderer(
        'file && (file as { mime?: string }).mime === "text/plain" ? `<img src="${escapeHtml(file.url)}" alt="">` : "<span>PDF</span>"',
      );
      expect(findDesignViolation(takes("document"), byType)).toContain(
        "for a synthetic document (text/plain) record",
      );
    } finally {
      types.mockRestore();
    }
  });

  test("keeps a scratch document a PDF, named as one", () => {
    expect(scratchFileType("document")).toBe("application/pdf");
    expect(tokenFileName("document").endsWith(".pdf")).toBe(true);
  });

  test("is reviewed down its document branch, not only the photo's", () => {
    const photoOrDocument = renderer(
      `!file ? "<span>None</span>" : \`<img src="\${escapeHtml(file.url)}" alt="">\``,
    );
    expect(findDesignViolation(takes("image", "document"), photoOrDocument)).toContain(
      "for a synthetic document record",
    );
  });
});

describe("a card that names a document's type", () => {
  test("catches a card that calls every file a PDF, however it spells it", () => {
    for (const label of ["PDF", "pdf", "PDFs", "&#80;DF", "P<b>DF</b>", "<b>P</b>DF", "P&shy;DF"]) {
      const always = renderer(`file ? "<span>${label}</span>" : "<span>No ${label} yet</span>"`);
      expect(findDesignViolation(takes("document"), always), label).toContain('says "PDF"');
    }
  });

  test("reads a field that holds several files as well as one", () => {
    const word = { kind: "document", mime: WORD_DOCUMENT_TYPE, url: "/files/a", name: "a.docx" };
    const say = (record: Readonly<Record<string, unknown>>) =>
      record.manuals ? "<span>PDF</span>" : "<span>None</span>";
    const record = { manuals: [word] };
    expect(mislabelledDocument(record, say)).toContain(WORD_DOCUMENT_TYPE);
    const right = (held: Readonly<Record<string, unknown>>) =>
      Array.isArray(held.manuals)
        ? held.manuals.map((file) => (file.mime === word.mime ? "Document" : "PDF")).join()
        : "None";
    expect(mislabelledDocument(record, right)).toBeUndefined();
  });

  test("lets a card hint at the types it takes beside a type it names right", () => {
    const hint = renderer(
      `file ? \`<span>\${(file as { mime?: string }).mime === "application/pdf" ? "PDF" : "Document"}</span><span>PDF or Word</span>\` : "<span>No manual</span>"`,
    );
    expect(findDesignViolation(takes("document"), hint)).toBeUndefined();
  });

  test("lets a card say PDF between the parts that show the file", () => {
    const between = renderer(
      '`<span>${file ? escapeHtml(file.name) : "No manual"}</span><span>Printed copies are PDF only</span>${file ? "<span>Open</span>" : ""}`',
    );
    expect(findDesignViolation(takes("document"), between)).toBeUndefined();
  });

  test("lets a card say PDF where it names no file's type", () => {
    const aside = renderer(`"<span>Keep the PDF or Word manual</span>" + (${inWords})`);
    expect(findDesignViolation(takes("document"), aside)).toBeUndefined();
  });

  test("catches a card that calls any further document type a PDF, or draws it", () => {
    const further = admission.admittedTypes("document").slice(1);
    expect(further.length).toBeGreaterThan(1);
    for (const type of further) {
      const only = (drawn: string) =>
        renderer(
          `file && (file as { mime?: string }).mime === "${type}" ? ${drawn} : (${inWords})`,
        );
      const probe = `for a synthetic document (${type}) record`;
      expect(findDesignViolation(takes("document"), only('"<span>PDF</span>"'))).toContain(probe);
      expect(
        findDesignViolation(
          takes("document"),
          only('`<img src="${escapeHtml(file.url)}" alt="">`'),
        ),
      ).toContain(probe);
    }
  });
});

describe("a card's PDF labels, read against the same card for a PDF and for none", () => {
  const word = { kind: "document", mime: WORD_DOCUMENT_TYPE, url: "/files/a", name: "a.docx" };
  const record = { manual: word };
  const spans = (...runs: string[]) => runs.map((run) => `<span>${run}</span>`).join("");
  /** The card for a record, or undefined when it throws, as the Gate renders one. */
  const cardOf =
    (draw: (held: { mime?: string } | null) => string) =>
    (held: Readonly<Record<string, unknown>>) => {
      try {
        return draw(held.manual as { mime?: string } | null);
      } catch {
        return undefined;
      }
    };
  const flagged = (draw: (held: { mime?: string } | null) => string) =>
    mislabelledDocument(record, cardOf(draw)) !== undefined;

  test("catches a PDF chip a card shows for every file", () => {
    const chip = (held: { mime?: string } | null) =>
      held
        ? spans("PDF", held.mime === "application/pdf" ? "View PDF" : "Download")
        : spans("No manual");
    expect(flagged(chip)).toBe(true);
  });

  test("catches a label when the card throws without a file, as a required field's may", () => {
    const required = (held: { mime?: string } | null) => {
      if (!held) throw new Error("A required manual is always there.");
      return spans("PDF", "48 KB");
    };
    expect(flagged(required)).toBe(true);
  });

  test("catches a label in an element's name, however it is spelled", () => {
    for (const name of ['title="P&#68;F"', 'aria-label="P&shy;DF"', 'aria-label="P\u00ADDF"']) {
      const named = (held: { mime?: string } | null) =>
        held ? `<span ${name}>Manual</span>` : spans("None");
      expect(flagged(named), name).toBe(true);
    }
  });

  test("lets a card say PDF where it says it of no file, or names the file's own type", () => {
    const cards = [
      (held: { mime?: string } | null) => spans("Manual", held ? "Word file, not a PDF" : "None"),
      (held: { mime?: string } | null) =>
        held
          ? spans("C", "PDF", "PDF", "A", "A", "B", "PDF")
          : spans("PDF", "B", "PDF", "PDF", "B", "B"),
    ];
    for (const card of cards) expect(flagged(card)).toBe(false);
  });

  test("reads each document field apart from another that holds a PDF", () => {
    const pdf = { ...word, mime: "application/pdf", name: "b.pdf" };
    const label = (file: unknown) => {
      const { mime } = file as { mime: string };
      return mime === "application/pdf" ? "PDF" : "Document";
    };
    const both = (held: Readonly<Record<string, unknown>>) =>
      spans(label(held.contract), label(held.addendum));
    const required = (held: Readonly<Record<string, unknown>>) => {
      try {
        return both(held);
      } catch {
        return undefined;
      }
    };
    for (const record of [
      { contract: word, addendum: pdf },
      { contract: pdf, addendum: word },
    ]) {
      expect(mislabelledDocument(record, required)).toBeUndefined();
    }
  });

  test("catches a card whose label for one field reads another's type", () => {
    const pdf = { ...word, mime: "application/pdf", name: "b.pdf" };
    const typeOf = (file: unknown) =>
      (file as { mime?: string }).mime === "application/pdf" ? "PDF" : "Document";
    // The contract's label reads the addendum's type: the slip a two-field card invites.
    const swapped = (held: Readonly<Record<string, unknown>>) =>
      spans(held.contract ? typeOf(held.addendum) : "No contract", typeOf(held.addendum));
    expect(mislabelledDocument({ contract: word, addendum: pdf }, swapped)).toContain(
      WORD_DOCUMENT_TYPE,
    );
  });

  test("reads each file of a list by its own type", () => {
    const pdf = { ...word, mime: "application/pdf", name: "b.pdf" };
    const chips = (say: (mime: string) => string) => (held: Readonly<Record<string, unknown>>) =>
      Array.isArray(held.papers)
        ? spans(...held.papers.map((file: { mime: string }) => say(file.mime)))
        : spans("No papers");
    const right = chips((mime) => (mime === "application/pdf" ? "PDF" : "Document"));
    const wrong = chips(() => "PDF");
    for (const papers of [
      [pdf, word],
      [word, pdf],
    ]) {
      expect(mislabelledDocument({ papers }, right)).toBeUndefined();
      expect(mislabelledDocument({ papers }, wrong)).toContain(WORD_DOCUMENT_TYPE);
    }
  });

  test("reads a card of thousands of runs at once", () => {
    const rows = Array.from({ length: 5_000 }, (_, at) => `row ${at}`);
    const long = (held: { mime?: string } | null) => spans(...rows, held ? "PDF" : "No manual");
    const started = performance.now();
    expect(flagged(long)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe.each([
  "photo_grid_tile",
  "walk_media_feed",
  "voice_memo_feed",
  "voice_memo_tile",
  "appliance_manual_feed",
  "appliance_manual_tile",
])("the %s exemplar", (id) => {
  const example = FEW_SHOT_DESIGN_EXAMPLES.find((candidate) => candidate.id === id);
  if (!example) throw new Error(`Expected the ${id} exemplar.`);

  function exemplarSpec(): CapabilitySpec {
    const base = validSpec();
    const fields = example?.capability.schema.fields ?? [];
    return validSpec({
      id: example?.capability.id,
      label: example?.capability.label,
      noun: example?.capability.noun,
      schema: { fields: fields.map((field) => ({ ...field })) },
      ui_intent: {
        ...base.ui_intent,
        collection: { ...base.ui_intent.collection, layout: example?.layout ?? "grid" },
        item: { ...base.ui_intent.item, shows: fields.map((field) => field.name) },
      },
    });
  }

  test("clears design lint over its own capability", () => {
    expect(findDesignViolation(exemplarSpec(), example.rendererSource)).toBeUndefined();
  });

  test("renders each preview as drawn", () => {
    const renderItem = loadItemRenderer(example.rendererSource);
    const collapse = (markup: string) => markup.replace(/>\s+</g, "><");
    for (const sample of example.previewSamples) {
      expect(collapse(enforceItemMarkup(renderItem(sample.record)))).toBe(sample.previewInnerHtml);
    }
  });
});
