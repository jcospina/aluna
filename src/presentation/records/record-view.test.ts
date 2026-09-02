import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyDeleteConfirmation,
  deleteOutcomeDisposition,
  UNCONFIRMED_ON_THE_DESK,
  unconfirmedMutationAnswer,
} from "#shell/record-mutations.js";
import { claimRecordExit, releaseRecordExit, swapInRecordView } from "#shell/record-view.js";
import { createRegionReleaseRegistry } from "#shell/region-scope.js";
import {
  capabilityDeleteConfirmationId,
  capabilityDeleteErrorId,
  type RenderableCapability,
} from "../fields/field-renderer.ts";
import { itemElementIdForTemplate } from "./list-container.ts";
import {
  RECORD_BACK_ATTR,
  RECORD_VIEW_ATTR,
  renderRecordView,
  renderRecordViewTemplate,
} from "./record-view.ts";

// The record's own view is platform chrome: a back control above the record's form, and
// nothing else. These pin what the design settled — a record opens in edit mode, there is
// no read view of one anywhere, an absent value is an empty input rather than a muted em
// dash, and nothing about this surface is a dialog.

const CAPABILITY: RenderableCapability = {
  id: "notes",
  label: "Notes",
  noun: "note",
  schema: {
    fields: [
      { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
      { name: "due_on", label: "Due on", type: "date", required: false, lifecycle: "active" },
      {
        name: "retired",
        label: "Retired",
        type: "string",
        required: true,
        lifecycle: "inactive",
      },
    ],
  },
  form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
  actions: ["create", "read", "update", "delete", "search"],
};

const RECORD = {
  id: "note-1",
  created_at: "2026-08-27T00:00:00.000Z",
  text: "Buy oat milk",
  due_on: null,
  retired: "server only",
};

const TEMPLATE_ID = "record-notes-note-1";

describe("the record view — back control above the form", () => {
  const view = renderRecordView(CAPABILITY, RECORD, TEMPLATE_ID);

  test("marks itself as the record view and names the item it came from", () => {
    expect(view).toContain(`<div class="capability-record-view" ${RECORD_VIEW_ATTR}`);
    expect(view).toContain(`data-item-target-id="${itemElementIdForTemplate(TEMPLATE_ID)}"`);
  });

  test("the back control is a button naming the capability it goes back to", () => {
    expect(view).toContain('<button type="button" class="capability-record-view__back"');
    expect(view).toContain(RECORD_BACK_ATTR);
    expect(view).toContain('aria-label="Back to Notes"');
    expect(view).toContain("<span>Notes</span>");
    // The accessible name contains the visible label, so speaking the control and
    // reading it agree (WCAG 2.5.3).
    expect(view).toContain('aria-hidden="true"');
  });

  test("back comes above the form, not beside its actions", () => {
    expect(view.indexOf("capability-record-view__bar")).toBeLessThan(
      view.indexOf("capability-edit-form"),
    );
  });

  test("nothing here is a dialog", () => {
    expect(view).not.toContain("<dialog");
    expect(view).not.toContain("aria-haspopup");
    expect(view).not.toContain("aria-modal");
    expect(view).not.toContain("inert");
  });
});

describe("the record view — a record opens in edit mode", () => {
  const view = renderRecordView(CAPABILITY, RECORD, TEMPLATE_ID);

  test("what opens is the form, prefilled and wired to update", () => {
    expect(view).toContain('class="capability-edit-form"');
    expect(view).toContain('hx-post="/capability/notes/update"');
    expect(view).toContain('name="text" value="Buy oat milk"');
  });

  test("an absent value is an empty input, never a muted em dash", () => {
    expect(view).toContain('name="due_on" value=""');
    expect(view).not.toContain("—");
    expect(view).not.toContain("detail-field");
    expect(view).not.toContain("detail-fields");
  });

  test("inactive stored values never reach the surface", () => {
    expect(view).not.toContain("server only");
    expect(view).not.toContain("Retired");
  });

  test("a capability that cannot be updated has no record surface at all", () => {
    // There is no read view to fall back on, so rendering an inert form would be a
    // surface that does nothing.
    const readOnly = { ...CAPABILITY, actions: ["create", "read"] as const };
    expect(renderRecordView(readOnly, RECORD, TEMPLATE_ID)).toBe("");
    expect(renderRecordViewTemplate(TEMPLATE_ID, readOnly, RECORD)).toBe("");
  });
});

// Record deletion changes container and nothing else (PLAN decision 22): the shape the
// modal had is the shape the form's action row keeps, and the only way to a delete is to
// open the record first.
describe("the record view — deletion lives in the form's action row", () => {
  const view = renderRecordView(CAPABILITY, RECORD, TEMPLATE_ID);
  const confirmationId = capabilityDeleteConfirmationId("notes");

  test("the confirmation is the form's sibling, below it and never inside it", () => {
    // A form cannot nest inside another form, and this one posts a delete of its own.
    const formEnd = view.indexOf("</form>") + "</form>".length;
    expect(view.slice(0, formEnd)).not.toContain("capability-record-delete");
    expect(view.slice(formEnd)).toContain('<form class="capability-record-delete"');
  });

  test("keeps the modal's copy, and Cancel beside Delete record", () => {
    expect(view).toContain(
      `<p id="${confirmationId}">Delete this record? You won’t be able to bring it back.</p>`,
    );
    expect(view).toContain(
      `<button class="btn btn--outline" type="button" data-record-cancel-delete` +
        ` aria-describedby="${confirmationId}">Cancel</button>`,
    );
    expect(view).toContain(
      `<button class="btn btn--danger" type="submit"` +
        ` aria-describedby="${confirmationId}">Delete record</button>`,
    );
    expect(view.indexOf("data-record-cancel-delete")).toBeLessThan(view.indexOf(">Delete record<"));
  });

  test("its Cancel is not the record view's Cancel, so it cannot leave the record", () => {
    // `public/record-view.js` leaves on `[data-record-cancel]`; a different attribute name
    // is what keeps cancelling the question from also cancelling the record.
    const confirmation = view.slice(view.indexOf("capability-record-delete"));
    expect(confirmation).not.toContain("data-record-cancel>");
    expect(confirmation).not.toContain("data-record-cancel ");
  });

  test("posts the delete for the record the form is editing, and swaps nothing", () => {
    expect(view).toContain('hx-post="/capability/notes/delete"');
    const targets = view.match(/name="__aluna_record_id" value="[^"]+"/g) ?? [];
    expect(targets).toEqual([
      'name="__aluna_record_id" value="note-1"',
      'name="__aluna_record_id" value="note-1"',
    ]);
  });

  test("starts hidden, and reserves the live region a refusal is retargeted to", () => {
    expect(view).toContain("data-record-delete-form hidden");
    expect(view).toContain(`id="${capabilityDeleteErrorId("notes")}"`);
    expect(view).toContain('aria-live="polite"');
  });

  test("deleting opens nothing over anything: it is still one surface", () => {
    expect(view).not.toContain("<dialog");
    expect(view).not.toContain("aria-modal");
    expect(view).not.toContain('role="alertdialog"');
  });

  test("a capability that cannot delete carries no destructive control at all", () => {
    const keeps = { ...CAPABILITY, actions: ["create", "read", "update", "search"] as const };
    const kept = renderRecordView(keeps, RECORD, TEMPLATE_ID);
    expect(kept).toContain("capability-edit-form");
    expect(kept).not.toContain("data-record-delete");
    expect(kept).not.toContain("capability-record-delete");
  });

  test("a record with no usable id cannot render a confirmation that would delete nothing", () => {
    expect(() => renderRecordView(CAPABILITY, { ...RECORD, id: "  " }, TEMPLATE_ID)).toThrow(
      /nonblank record id/,
    );
  });
});

describe("the record view — the inert template it travels in", () => {
  test("wraps the view in a template keyed by the id the item points at", () => {
    const html = renderRecordViewTemplate(TEMPLATE_ID, CAPABILITY, RECORD);
    expect(html.startsWith(`<template id="${TEMPLATE_ID}">`)).toBe(true);
    expect(html.endsWith("</template>")).toBe(true);
    expect(html).toContain(renderRecordView(CAPABILITY, RECORD, TEMPLATE_ID));
  });

  test("escapes a hostile template id so it cannot break out of the attribute", () => {
    const html = renderRecordViewTemplate('t"><script>', CAPABILITY, RECORD);
    expect(html).not.toContain('"><script>');
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  test("a hostile record value stays inert escaped text inside the form", () => {
    const hostile = renderRecordView(
      CAPABILITY,
      { ...RECORD, text: "<script>alert(1)</script>" },
      TEMPLATE_ID,
    );
    expect(hostile).not.toMatch(/<script/i);
    expect(hostile).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

// No DOM in Bun, so the swap mechanics live in a browser file this test can only read.
// It pins that the client leaves by the same two controls the server renders, and that
// leaving is a fresh read of the collection rather than a restored snapshot.
describe("the record swap — the way out (server ⇄ client)", () => {
  const controller = readFileSync(join(import.meta.dir, "../../../public/record-view.js"), "utf8");

  test("both exits the server renders lead out of the record", () => {
    expect(controller).toContain(RECORD_BACK_ATTR);
    expect(controller).toContain("data-record-cancel");
    expect(controller).toContain(RECORD_VIEW_ATTR);
  });

  test("leaving asks for the collection again — the fresh read, not a snapshot", () => {
    expect(controller).toContain('.ajax("GET", `/capability/');
    expect(controller).toContain("capabilityId");
    expect(controller).toContain('swap: "innerHTML"');
  });

  test("a committed update leaves the same way pressing back does", () => {
    const mutations = readFileSync(
      join(import.meta.dir, "../../../public/record-mutations.js"),
      "utf8",
    );
    expect(controller).toContain("export function leaveRecordView");
    expect(mutations).toContain('import { leaveRecordView } from "./record-view.js"');
    expect(mutations).toContain("leaveRecordView(view)");
  });
});

// The swap's own rules, run in Bun against structural doubles. The release rule is
// deliberately structural (`public/region-scope.js`) so the thing the acceptance criterion
// names — what a swap releases — can be executed rather than grepped for.
// The confirmation's own rules, run in Bun against structural doubles for the same reason
// the release rule is: what the acceptance criteria name — the row and the question
// trading places, and where a finished delete leaves the user — is executed rather than
// grepped for.
describe("the record's deletion — the row and the question trade places", () => {
  /** The four facts the rule needs of a record view, and no more. */
  function surface(confirming = false) {
    const focused: string[] = [];
    const cleared: number[] = [];
    let errors = 1;
    return {
      focused,
      cleared,
      get errors() {
        return errors;
      },
      toggle: {
        actions: { hidden: confirming, trigger: "delete-trigger" },
        question: {
          hidden: !confirming,
          cancel: "confirmation-cancel",
          clearError: () => {
            errors = 0;
            cleared.push(1);
          },
        },
        focus: (control: string) => void focused.push(control),
      },
    };
  }

  test("asking hides the action row, shows the question, and lands on Cancel", () => {
    const view = surface();
    applyDeleteConfirmation({ confirming: true, ...view.toggle });
    expect(view.toggle.actions.hidden).toBe(true);
    expect(view.toggle.question.hidden).toBe(false);
    expect(view.focused).toEqual(["confirmation-cancel"]);
  });

  test("Cancel restores the row and gives focus back to the Delete that opened it", () => {
    const view = surface(true);
    applyDeleteConfirmation({ confirming: false, ...view.toggle });
    expect(view.toggle.actions.hidden).toBe(false);
    expect(view.toggle.question.hidden).toBe(true);
    expect(view.focused).toEqual(["delete-trigger"]);
  });

  test("exactly one of the two is ever shown", () => {
    for (const confirming of [true, false]) {
      const view = surface(!confirming);
      applyDeleteConfirmation({ confirming, ...view.toggle });
      expect(view.toggle.actions.hidden).not.toBe(view.toggle.question.hidden);
    }
  });

  test("every asking starts with an empty error region", () => {
    // A refusal from the last attempt would otherwise sit under the new question,
    // describing something the user has not tried yet.
    const view = surface();
    applyDeleteConfirmation({ confirming: true, ...view.toggle });
    expect(view.errors).toBe(0);
    expect(view.cleared).toHaveLength(1);
  });
});

describe("the record's deletion — where a finished delete leaves the user", () => {
  test("a committed delete leaves the record, the way a committed update does", () => {
    expect(deleteOutcomeDisposition({ successful: true, outcomeUnknown: false })).toBe("leave");
  });

  test("a refused delete leaves the question standing, so the refusal has somewhere to land", () => {
    expect(deleteOutcomeDisposition({ successful: false, outcomeUnknown: false })).toBe("stand");
  });

  test("a severed delete keeps the question and says what it cannot confirm", () => {
    expect(deleteOutcomeDisposition({ successful: false, outcomeUnknown: true })).toBe(
      "stand-and-say",
    );
  });
});

// The sentence used to be written into the form's own live region unconditionally — inside
// the subtree being destroyed in the same tick when the region rule was what aborted the
// request. It was written and thrown away, and the server may have committed the write.
describe("the record's deletion — where an unconfirmed outcome is said", () => {
  const inField = "I couldn’t confirm that change. Go back and check before trying again.";

  test("a surface that is still standing says it in the field", () => {
    expect(unconfirmedMutationAnswer({ surfaceGone: false, hasField: true, inField })).toEqual({
      where: "field",
      sentence: inField,
    });
  });

  test("a surface that is going says it on the desk, in words that fit the desk", () => {
    const answer = unconfirmedMutationAnswer({ surfaceGone: true, hasField: true, inField });

    expect(answer.where).toBe("prompt-bar");
    expect(answer.sentence).toBe(UNCONFIRMED_ON_THE_DESK);
    // "Go back" names a control the person no longer has.
    expect(answer.sentence).not.toContain("Go back");
  });

  test("a form with nowhere to put it says it on the desk too", () => {
    expect(unconfirmedMutationAnswer({ surfaceGone: false, hasField: false, inField }).where).toBe(
      "prompt-bar",
    );
  });
});

// The wiring those rules hang off cannot be evaluated without a browser, so it is read.
// Each assertion names a call site rather than a declaration: deleting the listener or the
// outcome branch fails these, which is exactly what a declaration-only grep would not.
describe("the record's deletion — the wiring (server ⇄ client)", () => {
  const mutations = readFileSync(
    join(import.meta.dir, "../../../public/record-mutations.js"),
    "utf8",
  );

  test("both of the server's controls drive the toggle", () => {
    expect(mutations).toContain(
      "setDeleteConfirming(view, control.matches(DELETE_TRIGGER_SELECTOR))",
    );
    expect(mutations).toContain('"[data-record-cancel-delete]"');
    expect(mutations).toContain('".capability-edit-form__actions"');
  });

  test("the delete's outcome is handled, and its request says what it is doing", () => {
    // The fourth argument is whether the surface went while the request was out: a delete
    // aborted by the region rule must not write its sentence into a subtree that is being
    // destroyed in the same tick.
    expect(mutations).toContain("handleDeleteOutcome(");
    expect(mutations).toContain("releaseMutationSurface(deleteForm)");
    expect(mutations).toContain("setDeletePending(deleteForm, true)");
    expect(mutations).toContain('setPending(form, pending, "I’m deleting…", "Delete record"');
  });

  test("the form beneath a standing question cannot be submitted", () => {
    // A hidden submit button is still the form's default button, so Enter in any field
    // would save — and, mid-delete, race the delete it is answering.
    expect(mutations).toContain("!standingDeleteConfirmation(view)) return;");
    expect(mutations).toContain("event.stopPropagation()");
  });

  test("Escape dismisses the question, the one exit a `<dialog>` used to supply", () => {
    expect(mutations).toContain('if (event.key !== "Escape") return;');
    expect(mutations).toContain("setDeleteConfirming(view, false)");
  });
});

// The swap's own rules, run in Bun against structural doubles. The release rule is
// deliberately structural (`public/region-scope.js`) so the thing the acceptance criterion
// names — what a swap releases — can be executed rather than grepped for.
describe("the record swap — what a swap releases, and in what order", () => {
  /** The three DOM facts the release rule needs, and no more. */
  class Node {
    readonly children: Node[] = [];
    parent: Node | null = null;
    rooted = false;
    constructor(
      readonly name: string,
      readonly region?: string,
    ) {}
    get isConnected(): boolean {
      for (let node: Node | null = this; node; node = node.parent) if (node.rooted) return true;
      return false;
    }
    contains(other: Node): boolean {
      for (let node: Node | null = other; node; node = node.parent) if (node === this) return true;
      return false;
    }
    closest(): Node | null {
      for (let node: Node | null = this; node; node = node.parent) {
        if (node.region !== undefined) return node;
      }
      return null;
    }
    getAttribute(name: string): string | null {
      return name === "data-content-region" ? (this.region ?? null) : null;
    }
    append(...nodes: Node[]): void {
      for (const node of nodes) {
        node.parent = this;
        this.children.push(node);
      }
    }
  }

  /** The window's content region holding a capability's collection, as the swap finds it. */
  function collectionTree() {
    const window = new Node("window", "the window's content");
    window.rooted = true;
    const collection = new Node("collection");
    const searchForm = new Node("search form");
    const records = new Node("records", "records");
    collection.append(searchForm, records);
    window.append(collection);
    return { window, collection, searchForm, records };
  }

  test("releasing the collection releases the search controller and the records read", () => {
    // Both are anchored to their own node — the controller to the search form, the read
    // to the records region — and both sit under the collection the record replaces.
    const { collection, searchForm, records } = collectionTree();
    const registry = createRegionReleaseRegistry();
    const ran: string[] = [];
    registry.register(searchForm as never, "search controller", () => ran.push("search"));
    registry.register(records as never, "records read", () => ran.push("read"));

    registry.releaseUnder(collection as never);

    expect(ran.sort()).toEqual(["read", "search"]);
    expect(registry.size).toBe(0);
  });

  test("a record that cannot open releases nothing — the collection stays as it was", () => {
    const { collection, searchForm } = collectionTree();
    const registry = createRegionReleaseRegistry();
    registry.register(searchForm as never, "search controller", () => {
      throw new Error("released a collection that was never replaced");
    });

    const released: unknown[] = [];
    const swapped = swapInRecordView({
      outgoing: collection,
      incoming: null,
      release: (node) => released.push(node),
      replace: () => {
        throw new Error("replaced the collection with nothing");
      },
      process: () => undefined,
    });

    expect(swapped).toBe(false);
    expect(released).toEqual([]);
    expect(registry.size).toBe(1);
  });

  test("the outgoing content is released before it is replaced, and processed after", () => {
    const { collection } = collectionTree();
    const view = new Node("record view");
    const order: string[] = [];

    const swapped = swapInRecordView({
      outgoing: collection,
      incoming: view,
      release: () => order.push("release"),
      replace: () => order.push("replace"),
      process: () => order.push("process"),
    });

    expect(swapped).toBe(true);
    // Release must run while the content is still connected: that is the only moment an
    // htmx request under it can still be aborted, which is what frees the read token.
    expect(order).toEqual(["release", "replace", "process"]);
  });
});

describe("the record swap — one exit at a time", () => {
  function view() {
    const attributes = new Map<string, string>();
    return {
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    };
  }

  test("a second press while the collection is on its way is refused", () => {
    const record = view();
    expect(claimRecordExit(record)).toBe(true);
    expect(claimRecordExit(record)).toBe(false);
  });

  test("the claim comes back when the request ends, however it ended", () => {
    const record = view();
    claimRecordExit(record);
    releaseRecordExit(record);
    expect(claimRecordExit(record)).toBe(true);
  });
});
