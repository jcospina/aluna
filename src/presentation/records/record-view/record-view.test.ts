import { describe, expect, test } from "bun:test";
import { createRegionReleaseRegistry } from "#shell/core/region-scope.js";
import { capabilityActionUrl } from "#shell/core/routes.js";
import { WINDOW_CONTENT_REGION } from "#shell/desk/window/desk-window.js";
import {
  applyDeleteConfirmation,
  deleteOutcomeDisposition,
  UNCONFIRMED_IN_THE_FORM,
  UNCONFIRMED_ON_THE_DESK,
  unconfirmedMutationAnswer,
} from "#shell/records/record-mutations.js";
import { claimRecordExit, releaseRecordExit } from "#shell/records/record-view.js";
import { ALUNA_RECORD_ID_MARKER } from "../../../runtime/router/wire/wire-protocol.ts";
import { BUSY_LABEL_ATTRIBUTE, DELETING_RECORD_LABEL } from "../../controls/busy-label.ts";
import { Doc, type El, parseHtml } from "../../controls/double/choice-picker.test-support.ts";
import {
  capabilityDeleteConfirmationId,
  capabilityDeleteErrorId,
  capabilityEditFormId,
} from "../../fields/field-renderer.ts";
import { named } from "../collection/collection-page.test-support.ts";
import { CAPABILITY, RECORD } from "./record-view.test-support.ts";
import {
  RECORD_BACK_ATTR,
  RECORD_VIEW_ATTR,
  recordItemId,
  renderRecordView,
} from "./record-view.ts";

// The record's own view is platform chrome: a back control above the record's form, and nothing
// else. A record opens in edit mode, an absent value is an empty input, and nothing is a dialog.

/** A record view, parsed the way the browser reads what the server wrote. */
function viewOf(
  capability = CAPABILITY,
  record: Record<string, unknown> = RECORD,
  linking = "",
): El {
  return parseHtml(renderRecordView(capability, record, undefined, linking), new Doc())
    .children[0] as El;
}

const before = (root: El, first: El, second: El) => {
  const all = [...root.descendants()];
  return all.indexOf(first) < all.indexOf(second);
};

describe("the record view — back control above the form", () => {
  const view = viewOf();

  test("marks itself as the record view and names the item it came from", () => {
    expect(view.hasAttribute(RECORD_VIEW_ATTR)).toBe(true);
    expect(view.getAttribute("data-item-target-id")).toBe(recordItemId(CAPABILITY.id, RECORD.id));
  });

  test("the back control is a button whose name contains the words it shows", () => {
    // The accessible name contains the visible label, so speaking the control and reading it
    // agree (WCAG 2.5.3), and the arrow beside it is not read at all.
    const back = named(view, "button", `Back to ${CAPABILITY.label}`);
    expect(back.getAttribute("type")).toBe("button");
    expect(back.hasAttribute(RECORD_BACK_ATTR)).toBe(true);
    expect(back.textContent.trim()).toBe(CAPABILITY.label);
    expect(back.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("back comes above the form, not beside its actions", () => {
    const back = named(view, "button", `Back to ${CAPABILITY.label}`);
    const form = named(view, "form", `Edit ${CAPABILITY.label}`);
    expect(before(view, back, form)).toBe(true);
    expect(form.contains(back)).toBe(false);
  });

  test("nothing here is a dialog", () => {
    const html = renderRecordView(CAPABILITY, RECORD);
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain("aria-haspopup");
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain("inert");
  });
});

describe("the record view — a record opens in edit mode", () => {
  const view = viewOf();
  const form = named(view, "form", `Edit ${CAPABILITY.label}`);

  test("what opens is the form, prefilled and wired to update", () => {
    expect(form.getAttribute("hx-post")).toBe(capabilityActionUrl(CAPABILITY.id, "update"));
    expect(form.querySelector('input[name="text"]')?.value).toBe(RECORD.text);
  });

  test("an absent value is an empty input, never a muted em dash", () => {
    expect(form.querySelector('input[name="due_on"]')?.value).toBe("");
    const html = renderRecordView(CAPABILITY, RECORD);
    expect(html).not.toContain("—");
    expect(html).not.toContain("detail-field");
    expect(html).not.toContain("detail-fields");
  });

  test("inactive stored values never reach the surface", () => {
    const html = renderRecordView(CAPABILITY, RECORD);
    expect(html).not.toContain("server only");
    expect(html).not.toContain("Retired");
  });

  test("a capability that cannot be updated has no record surface at all", () => {
    // There is no read view to fall back on, so rendering an inert form would be a
    // surface that does nothing.
    const readOnly = { ...CAPABILITY, actions: ["create", "read"] as const };
    expect(renderRecordView(readOnly, RECORD)).toBe("");
  });
});

// The records linking here stand outside the edit form, so the form's
// action row stands after them, joined to the form by its `form` attribute.
describe("the record view — the action row stands outside the form and names it", () => {
  const linking = `<section class="record-links"><button type="button">Listed</button></section>`;
  const view = viewOf(CAPABILITY, RECORD, linking);
  const form = named(view, "form", `Edit ${CAPABILITY.label}`);
  const actions = view.querySelector(".capability-edit-form__actions") as El;
  const section = view.querySelector(".record-links") as El;

  test("Save, Cancel and Delete stand outside the form, and each one's form is the edit form", () => {
    expect(form.id).toBe(capabilityEditFormId(CAPABILITY.id));
    const row = actions.querySelectorAll("button");
    const roles = ['[type="submit"]', "[data-record-cancel]", "[data-record-delete]"];
    expect(row.map((button) => roles.findIndex((role) => button.matches(role)))).toEqual([0, 1, 2]);
    for (const button of row) {
      expect(form.contains(button)).toBe(false);
      expect(button.getAttribute("form")).toBe(form.id);
      expect(button.form).toBe(form);
    }
  });

  test("the records linking here come between the form and its action row, outside both", () => {
    expect(before(view, form, section)).toBe(true);
    expect(before(view, section, actions)).toBe(true);
    expect(form.contains(section)).toBe(false);
    expect(actions.contains(section)).toBe(false);
    expect(named(section, "button", "Listed").form).toBeNull();
  });

  test("the form and the sections scroll together in the body; the bar and the row stay put", () => {
    const body = view.querySelector(".capability-record-view__body") as El;
    expect(body.contains(form)).toBe(true);
    expect(body.contains(section)).toBe(true);
    expect(body.contains(actions)).toBe(false);
    expect(body.contains(named(view, "button", `Back to ${CAPABILITY.label}`))).toBe(false);
  });

  test("a record with no records linking here draws the same row, with nothing before it", () => {
    const bare = viewOf();
    const body = bare.querySelector(".capability-record-view__body") as El;
    expect(body.children.map((child) => child.tag)).toEqual(["form"]);
    expect(bare.querySelector(".capability-edit-form__actions")?.parent).toBe(bare);
  });
});

// Record deletion changes container and nothing else: the shape the modal had
// is the shape the form's action row keeps, and a delete starts by opening the record.
describe("the record view — deletion lives in the form's action row", () => {
  const view = viewOf();
  const confirmationId = capabilityDeleteConfirmationId("notes");
  const deleteUrl = capabilityActionUrl(CAPABILITY.id, "delete");
  const question = view.querySelector(`form[hx-post="${deleteUrl}"]`) as El;

  test("the confirmation stands beside the action row it replaces, below the form, never in it", () => {
    // A form cannot nest inside another form, and this one posts a delete of its own.
    const form = named(view, "form", `Edit ${CAPABILITY.label}`);
    const actions = view.querySelector(".capability-edit-form__actions") as El;
    expect(question.parent).toBe(actions.parent);
    expect(form.contains(question)).toBe(false);
    expect(before(view, form, question)).toBe(true);
    expect(before(view, actions, question)).toBe(true);
  });

  test("it asks a question, and both answers are described by it", () => {
    const cancel = named(question, "button", "Cancel");
    const remove = named(question, "button", "Delete record");
    const asked = view.querySelector(`#${confirmationId}`);
    expect(asked?.textContent.trim()).not.toBe("");
    expect(cancel.getAttribute("type")).toBe("button");
    expect(remove.getAttribute("type")).toBe("submit");
    expect(remove.getAttribute(BUSY_LABEL_ATTRIBUTE)).toBe(DELETING_RECORD_LABEL);
    for (const answer of [cancel, remove]) {
      expect(answer.getAttribute("aria-describedby")).toBe(confirmationId);
    }
    expect(before(view, cancel, remove)).toBe(true);
  });

  test("posts the delete for the record the form is editing, and swaps nothing", () => {
    expect(question.getAttribute("hx-swap")).toBe("none");
    const targets = view.querySelectorAll(`input[name="${ALUNA_RECORD_ID_MARKER}"]`);
    expect(targets.map((target) => target.value)).toEqual([RECORD.id, RECORD.id]);
    expect(question.contains(targets[1] as El)).toBe(true);
  });

  test("starts hidden, and reserves the live region a refusal is retargeted to", () => {
    expect(question.hidden).toBe(true);
    const error = view.querySelector(`#${capabilityDeleteErrorId("notes")}`);
    expect(question.contains(error as El)).toBe(true);
    expect(error?.getAttribute("aria-live")).toBe("polite");
  });

  test("deleting opens nothing over anything: it is still one surface", () => {
    const html = renderRecordView(CAPABILITY, RECORD);
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain('role="alertdialog"');
  });

  test("a capability that cannot delete carries no destructive control at all", () => {
    const keeps = viewOf({ ...CAPABILITY, actions: ["create", "read", "update", "search"] });
    expect(named(keeps, "form", `Edit ${CAPABILITY.label}`).tag).toBe("form");
    expect(keeps.querySelector(`form[hx-post="${deleteUrl}"]`)).toBeNull();
    expect(keeps.querySelectorAll("button").map((b) => b.textContent.trim())).not.toContain(
      "Delete",
    );
  });

  test("a record with no usable id cannot render a confirmation that would delete nothing", () => {
    expect(() => renderRecordView(CAPABILITY, { ...RECORD, id: "  " })).toThrow(
      /nonblank record id/,
    );
  });
});

describe("the record view — what it carries stays inert", () => {
  test("a hostile record id stays the attribute's value and opens no element", () => {
    const hostile = 't"><script>';
    const root = viewOf(CAPABILITY, { ...RECORD, id: hostile });
    expect(root.querySelector("script")).toBeNull();
    expect(root.getAttribute("data-item-target-id")).toBe(recordItemId(CAPABILITY.id, hostile));
  });

  test("a hostile record value stays inert escaped text inside the form", () => {
    const text = "<script>alert(1)</script>";
    const hostile = renderRecordView(CAPABILITY, { ...RECORD, text });
    expect(hostile).not.toMatch(/<script/i);
    expect(viewOf(CAPABILITY, { ...RECORD, text }).querySelector('input[name="text"]')?.value).toBe(
      text,
    );
  });
});

// The confirmation's own rules, run in Bun against structural doubles, so the row and the
// question trading places is executed rather than grepped for.
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

// The sentence used to be written into the form's own live region unconditionally, inside a
// subtree being destroyed in the same tick, so it was written and thrown away.
describe("the record's deletion — where an unconfirmed outcome is said", () => {
  const inField = UNCONFIRMED_IN_THE_FORM;

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

// The release rule is structural (`public/core/region-scope.js`), so what leaving a collection
// releases can be executed in Bun against structural doubles rather than grepped for.
describe("the record swap — what leaving the collection releases", () => {
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
    const window = new Node("window", WINDOW_CONTENT_REGION);
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
