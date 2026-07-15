import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DETAIL_MODAL_BODY_ID,
  DETAIL_MODAL_ID,
  DETAIL_MODAL_TITLE_ID,
  OPEN_DETAIL_EVENT,
  renderDetailContent,
  renderDetailContentTemplate,
  renderDetailModal,
} from "./detail-modal.ts";
import type { RenderableCapability } from "./field-renderer.ts";
import { renderDetailFields } from "./field-renderer.ts";

// The shared read-only detail modal (epic 3.2/04) is platform chrome — its
// open/close/prefill/focus invariants are deterministic platform tests, not gate rungs
// the model can fail (ADR-0005 §4). The hard mechanics (focus trap + restore, Escape,
// backdrop) are delegated to the native <dialog>, so these pin: that the markup IS a
// native modal dialog wired for those (labelled, native close, empty data-free body),
// that the body is rendered through the ONE centralized field renderer, and that the
// client controller agrees with the server on the shared ids + open event + showModal()
// (the no-DOM analogue of the container's CSS-parity test).

const SAMPLE: RenderableCapability = {
  id: "tasks",
  label: "Tasks",
  schema: {
    fields: [
      { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
      { name: "priority", label: "Priority", type: "number", required: true, lifecycle: "active" },
      { name: "urgent", label: "Urgent", type: "boolean", required: false, lifecycle: "active" },
      { name: "due_on", label: "Due on", type: "date", required: true, lifecycle: "active" },
      {
        name: "remind_at",
        label: "Remind at",
        type: "datetime",
        required: false,
        lifecycle: "active",
      },
      { name: "note", label: "Note", type: "string", required: false, lifecycle: "active" },
    ],
  },
  form: { list_inputs: [] },
};

const RECORD: Readonly<Record<string, unknown>> = {
  title: "Buy oat milk",
  priority: 2,
  urgent: true,
  due_on: "2026-07-05",
  remind_at: "2026-07-05T09:30",
  note: null,
};

describe("renderDetailModal — the one shared dialog instance", () => {
  const modal = renderDetailModal();

  test("is a native <dialog> carrying the shared instance id", () => {
    // A native modal <dialog> is what supplies the focus trap + restore + Escape + backdrop
    // (via showModal()); pinning the element and its id is pinning those mechanics.
    expect(modal.startsWith(`<dialog id="${DETAIL_MODAL_ID}"`)).toBe(true);
    expect(modal.trimEnd().endsWith("</dialog>")).toBe(true);
  });

  test("is labelled by its heading, so the dialog announces what it shows", () => {
    expect(modal).toContain(`aria-labelledby="${DETAIL_MODAL_TITLE_ID}"`);
    expect(modal).toContain(`<h2 class="detail-modal__title" id="${DETAIL_MODAL_TITLE_ID}">`);
  });

  test("has a native close: a method=dialog form + a labelled close button", () => {
    // Submitting a `method="dialog"` form closes the dialog and restores focus with no JS —
    // the guaranteed close path (alongside native Escape) even if the controller never loads.
    expect(modal).toContain('<form method="dialog"');
    expect(modal).toContain('aria-label="Close"');
    expect(modal).toContain("detail-modal__close");
  });

  test("body region is present, identified, and empty — data-free chrome (ADR-0004)", () => {
    // Content is prefilled on open (cloned from a per-record template), never baked into the
    // shared instance, so the modal caches no user data between opens.
    expect(modal).toContain(`<div class="detail-modal__body" id="${DETAIL_MODAL_BODY_ID}"></div>`);
  });

  test("wraps content in a padded panel distinct from the dialog (backdrop-dismiss seam)", () => {
    // The dialog is chrome-less and the panel holds the padding, so a click on the dialog
    // element itself is a click on the ::backdrop — the controller's light-dismiss target.
    expect(modal).toContain('<div class="detail-modal__panel">');
  });

  test("renders exactly one dialog (a single shared instance, not one per capability)", () => {
    expect(modal.match(/<dialog\b/g)?.length).toBe(1);
  });
});

describe("renderDetailContent — read-only body via the centralized field renderer", () => {
  test("delegates to the one field renderer, so create and detail never drift", () => {
    // Byte-identical to renderDetailFields: the modal owns WHERE the body shows, the field
    // renderer owns HOW each field renders (the single place M4/M6 extend).
    expect(renderDetailContent(SAMPLE, RECORD)).toBe(renderDetailFields(SAMPLE, RECORD));
  });

  test("without detail.shows, falls back to every spec field in spec order", () => {
    // SAMPLE carries no detail.shows, so the body shows the whole record in spec order —
    // the fallback that keeps a demo/test (or a pre-reshape row) rendering everything.
    const body = renderDetailContent(SAMPLE, RECORD);
    const order = ["Title", "Priority", "Urgent", "Due on", "Remind at", "Note"];
    const positions = order.map((label) => body.indexOf(label));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("honors detail.shows — exactly those fields, in that order (3.3/02)", () => {
    // The reshaped ui_intent's detail.shows drives the read-only surface: a reordered
    // subset must show exactly its fields, in its order, dropping the rest.
    const scoped: RenderableCapability = {
      ...SAMPLE,
      detail: { shows: ["note", "title", "urgent"] },
    };
    const body = renderDetailContent(scoped, RECORD);

    // The three named fields show, in the named order.
    const shown = ["Note", "Title", "Urgent"].map((label) => body.indexOf(label));
    expect(shown.every((p) => p >= 0)).toBe(true);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));

    // The dropped fields do not appear at all, and the <dl> holds exactly three rows.
    for (const dropped of ["Priority", "Due on", "Remind at"]) {
      expect(body).not.toContain(`>${dropped}</dt>`);
    }
    expect([...body.matchAll(/<dt class="detail-field__label">/g)]).toHaveLength(3);
  });

  test("formats by type and shows the placeholder for an absent value", () => {
    const body = renderDetailContent(SAMPLE, RECORD);
    expect(body).toContain("Yes"); // boolean urgent=true
    expect(body).toContain('<time datetime="2026-07-05">'); // date due_on
    expect(body).toContain("—"); // absent note
  });

  test("escapes a hostile record value — it can never become live markup", () => {
    const body = renderDetailContent(SAMPLE, {
      ...RECORD,
      title: '"><script>alert(1)</script>',
    });
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("renderDetailContentTemplate — inert, cloneable detail", () => {
  test("wraps the detail body in a <template> keyed by the given id", () => {
    const tpl = renderDetailContentTemplate("detail-tpl-1", SAMPLE, RECORD);
    expect(tpl.startsWith('<template id="detail-tpl-1">')).toBe(true);
    expect(tpl.trimEnd().endsWith("</template>")).toBe(true);
    expect(tpl).toContain(renderDetailContent(SAMPLE, RECORD));
  });

  test("escapes the template id so it cannot break out of the attribute", () => {
    const tpl = renderDetailContentTemplate('x"><script>', SAMPLE, RECORD);
    expect(tpl).not.toContain('"><script>');
    expect(tpl).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("detail modal — CSS parity", () => {
  // The classes the modal emits must actually be styled, or the modal renders unstyled.
  const css = readFileSync(join(import.meta.dir, "../../public/css/detail-modal.css"), "utf8");

  test("every structural class the markup uses is defined in detail-modal.css", () => {
    for (const cls of [
      "detail-modal",
      "detail-modal__panel",
      "detail-modal__header",
      "detail-modal__title",
      "detail-modal__close",
      "detail-modal__body",
    ]) {
      expect(css).toContain(`.${cls}`);
    }
  });

  test("styles the ::backdrop (the native dimmed layer behind the modal)", () => {
    expect(css).toContain(".detail-modal::backdrop");
  });

  test("detail-modal.css is wired into the served stylesheet", () => {
    const appCss = readFileSync(join(import.meta.dir, "../../public/app.css"), "utf8");
    expect(appCss).toContain("css/detail-modal.css");
  });
});

describe("detail modal — controller contract parity (server ⇄ client)", () => {
  // No DOM in Bun, so the open/close/focus mechanics live in a browser file this test can
  // only read. It pins that the client agrees with the server on the shared ids + open
  // event, and that it opens via native showModal() — the source of focus trap + restore.
  const controller = readFileSync(join(import.meta.dir, "../../public/detail-modal.js"), "utf8");

  test("references the same shared ids the server renders", () => {
    for (const id of [DETAIL_MODAL_ID, DETAIL_MODAL_TITLE_ID, DETAIL_MODAL_BODY_ID]) {
      expect(controller).toContain(`"${id}"`);
    }
  });

  test("listens on the shared open event — the only way the modal opens", () => {
    expect(controller).toContain(`"${OPEN_DETAIL_EVENT}"`);
    expect(controller).toContain(`addEventListener(OPEN_EVENT`);
  });

  test("opens via native showModal() — the source of the focus trap + restore", () => {
    expect(controller).toContain(".showModal()");
  });

  test("closes on a backdrop click — the light-dismiss path", () => {
    expect(controller).toContain(".close()");
  });
});
