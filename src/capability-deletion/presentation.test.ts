import { describe, expect, test } from "bun:test";

import type { CapabilityRow } from "../registry/index.ts";
import { boomRow, notesRow } from "../router/router.test-support.ts";
import {
  dependentCapabilityNames,
  renderCapabilityDeletionAlreadyGone,
  renderCapabilityDeletionCommitted,
  renderCapabilityDeletionConfirmation,
  renderCapabilityDeletionPreCommitFailure,
  renderCapabilityDeletionRefusalRestoration,
} from "./presentation.ts";

describe("capability-deletion presentation", () => {
  test("names the capability and explains permanent loss in plain product voice", () => {
    const html = renderCapabilityDeletionConfirmation(notesRow(), []);

    expect(html).toContain("Delete Notes permanently?");
    expect(html).toContain(
      "This deletes all records, every past setup, saved files and anything else it owns, plus its activity history. You can’t undo this.",
    );
    expect(html).toContain(
      "I keep a few measurements about creating or changing Notes, but never your content",
    );
    expect(html).toContain('class="capability-deletion__retention"');
    expect(html).toContain('class="btn btn--neutral capability-deletion__keep"');
    expect(html).toContain("Delete permanently</span>");
    expect(html).not.toContain("Permanent deletion");
    expect(html).not.toContain("content-free");
    expect(html).toContain(`value="${notesRow().incarnation_id}"`);
  });

  test("names dependents in deterministic registry order with singular and plural grammar", () => {
    const alpha = { ...boomRow(), id: "alpha", label: "Reading list" };
    const beta = { ...boomRow(), id: "beta", label: "Weekly digest" };
    const gamma = { ...boomRow(), id: "gamma", label: "Saved searches" };

    expect(dependentCapabilityNames([alpha])).toBe("Reading list");
    expect(dependentCapabilityNames([alpha, beta])).toBe("Reading list and Weekly digest");
    expect(dependentCapabilityNames([alpha, beta, gamma])).toBe(
      "Reading list, Weekly digest, and Saved searches",
    );
    // Assert the grammar through the *live* refusal, not a parallel renderer: this is
    // the copy Confirm actually answers with once lease-held revalidation refuses.
    const blocked = (dependents: CapabilityRow[]) =>
      renderCapabilityDeletionRefusalRestoration(notesRow(), "", { kind: "blocked", dependents });

    expect(blocked([alpha])).toContain("I can’t delete Notes while Reading list uses it.");
    expect(blocked([alpha, beta])).toContain(
      "I can’t delete Notes while Reading list and Weekly digest use it.",
    );
  });

  test("the advisory preflight warns without pretending to be the answer", () => {
    const dependent = { ...boomRow(), id: "alpha", label: "Reading list" };
    const html = renderCapabilityDeletionConfirmation(notesRow(), [dependent]);

    expect(html).toContain("Reading list currently uses Notes. I’ll check again before deleting");
    expect(html).not.toContain("Aluna will");
  });

  test("escapes target and dependent labels in copy, controls, and accessible names", () => {
    const target = notesRow({ label: '<img src=x onerror="alert(1)">' });
    const dependent = { ...boomRow(), label: "<script>alert(2)</script>" };
    const html = renderCapabilityDeletionConfirmation(target, [dependent]);

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  test("leaves the primary output truly empty after a neutral committed deletion", () => {
    const html = renderCapabilityDeletionCommitted(notesRow(), "", false);

    expect(html).toBe(
      '<div data-capability-deletion-logo-removal hx-swap-oob="delete:#capability-logo-notes"></div><div id="prompt-notice" hx-swap-oob="innerHTML">I deleted Notes permanently.</div>',
    );
  });

  test("a neutral refusal or pre-commit failure leaves no primary bytes either", () => {
    // Only out-of-band updates may survive: a separator would leave a text node, and a
    // `#spec-build-output` holding one stops matching `:empty` — an empty bordered bar.
    const failure = renderCapabilityDeletionPreCommitFailure(notesRow(), "");
    const refusal = renderCapabilityDeletionRefusalRestoration(notesRow(), "", { kind: "busy" });

    expect(failure).toBe(
      '<div id="prompt-notice" hx-swap-oob="innerHTML">I couldn’t delete Notes. Everything you had there is still safe.</div>',
    );
    expect(refusal.startsWith('<div id="prompt-notice"')).toBe(true);
    expect(refusal).toContain("I’m making another change right now");
  });

  test("Confirm carries the preflight URL the shell re-asks when a response never lands", () => {
    const html = renderCapabilityDeletionConfirmation(notesRow(), []);

    expect(html).toContain('data-capability-deletion-confirm="/capability-deletion/notes"');
  });

  test("Confirm names the act while it runs and locks both controls", () => {
    const html = renderCapabilityDeletionConfirmation(notesRow(), []);

    expect(html).toContain(
      '<span class="capability-deletion__label" data-deletion-idle-label>Delete permanently</span>',
    );
    expect(html).toContain(
      '<span class="capability-deletion__label" data-deletion-busy-label>Erasing…</span>',
    );
    expect(html).toContain('hx-disabled-elt="find button"');
  });

  test("an already-gone target lands on the neutral home state, not a dead-end panel", () => {
    const html = renderCapabilityDeletionAlreadyGone("notes");

    expect(html).toBe(
      '<div data-capability-deletion-logo-removal hx-swap-oob="delete:#capability-logo-notes"></div><div id="prompt-notice" hx-swap-oob="innerHTML">That’s already gone, so I didn’t delete anything.</div>',
    );
    expect(html).not.toContain("capability-deletion__actions");
  });
});
