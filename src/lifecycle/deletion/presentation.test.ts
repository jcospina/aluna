import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CapabilityRow } from "../../registry/index.ts";
import { boomRow, notesRow } from "../../runtime/router/dispatch/router.test-support.ts";
import {
  type CapabilityDeletionRestorationEvidence,
  DELETION_RECHECK_PARAM,
  dependentCapabilityNames,
  renderCapabilityDeletionAlreadyGone,
  renderCapabilityDeletionCommitted,
  renderCapabilityDeletionConfirmation,
  renderCapabilityDeletionPreCommitFailure,
  renderCapabilityDeletionRefusal,
} from "./presentation.ts";

const NEUTRAL: CapabilityDeletionRestorationEvidence = { kind: "neutral" };

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
    // `.btn--outline` is the design system's name for the action you take when you are
    // not taking the action; `neutral` is a name that system explicitly refuses.
    expect(html).toContain('class="btn btn--outline capability-deletion__keep"');
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
      renderCapabilityDeletionRefusal(notesRow(), { kind: "blocked", dependents }, NEUTRAL);

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

  // Two rules, and the outer one is why this reads as it does. A stored label that is not
  // a name is not shown at all — the name validator refuses markup shapes now, and
  // `canonicalCapabilityLabel` falls back rather than printing one. Escaping is still what
  // makes the sink safe, and is checked below on a name that *is* one.
  test("a label that is not a name is not rendered, escaped or otherwise", () => {
    const target = notesRow({ label: '<img src=x onerror="alert(1)">' });
    const dependent = { ...boomRow(), label: "<script>alert(2)</script>" };
    const html = renderCapabilityDeletionConfirmation(target, [dependent]);

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("&lt;img");
    expect(html).not.toContain("&lt;script&gt;");
    // What is written instead is the capability's own id, title-cased.
    expect(html).toContain("Notes");
  });

  test("every label it renders goes through the escape on the way out", () => {
    const target = notesRow({ label: "Tom & Jerry" });
    const dependent = { ...boomRow(), label: "Salt & Pepper" };
    const html = renderCapabilityDeletionConfirmation(target, [dependent]);

    expect(html).toContain("Tom &amp; Jerry");
    expect(html).toContain("Salt &amp; Pepper");
    expect(html).not.toMatch(/Tom & Jerry/);
  });

  test("leaves the primary output truly empty after a neutral committed deletion", () => {
    const html = renderCapabilityDeletionCommitted(notesRow(), "", false);

    expect(html).toBe(
      '<div data-capability-deletion-logo-removal hx-swap-oob="delete:#capability-logo-notes"></div><div id="prompt-notice" hx-swap-oob="innerHTML">I deleted Notes permanently.</div>',
    );
  });

  test("Confirm carries the preflight URL the shell re-asks when a response never lands", () => {
    const html = renderCapabilityDeletionConfirmation(notesRow(), []);

    expect(html).toContain('data-capability-deletion-confirm="/capability-deletion/notes"');
  });

  // The client marks its recheck so the answer can tell "you never deleted this" from
  // "your Confirm may be exactly why it is gone". Saying the first when the second is true
  // tells somebody their destructive action did nothing when it may have done everything.
  test("the recheck's own answer says what is true of a Confirm that may have landed", () => {
    const recovered = renderCapabilityDeletionAlreadyGone("notes", "", "after-confirm");
    const pressed = renderCapabilityDeletionAlreadyGone("notes", "", "never-asked");

    expect(recovered).toContain("It’s gone.");
    expect(recovered).not.toContain("I didn’t delete anything");
    expect(pressed).toContain("I didn’t delete anything");
    // And the shell and the server agree on the mark that tells them apart.
    expect(
      readFileSync(resolve(import.meta.dir, "../../../public/capability-deletion.js"), "utf8"),
    ).toContain(`const DELETION_RECHECK_PARAM = "${DELETION_RECHECK_PARAM}";`);
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

  // The already-gone branch is reached with a raw URL segment: no registry row proved it,
  // because there is no row. `escapeHtml` stops an attribute breakout and says nothing
  // about selector *shape* — `notes, body` is a well-formed attribute value and a
  // two-element selector, and htmx would delete `<body>` along with the tile.
  test("an id that is not a capability id names no element to delete", () => {
    for (const hostile of ["notes, body", "notes\\, body", "Notes", "", "*", "notes:not(x)"]) {
      const html = renderCapabilityDeletionAlreadyGone(hostile);

      expect(html, hostile).not.toContain("delete:#");
      // The person is still told what happened.
      expect(html, hostile).toContain("That’s already gone");
    }
  });
});

describe("the ending a deletion that did not happen leaves in the window", () => {
  test("a refusal and a pre-commit failure each fill the window and hold there", () => {
    const failure = renderCapabilityDeletionPreCommitFailure(notesRow(), NEUTRAL);
    const refusal = renderCapabilityDeletionRefusal(notesRow(), { kind: "busy" }, NEUTRAL);

    for (const ending of [failure, refusal]) {
      // The sentence lives in the window now, not on the prompt bar behind it, and the
      // window holds it: nothing is restored and no address moves until the press.
      expect(ending).not.toContain("prompt-notice");
      expect(ending).toContain("data-capability-deletion-ending");
      expect(ending).toContain('hx-get="/capability-deletion-restoration?restore_surface=neutral"');
      expect(ending).toContain(">Continue</button>");
      // One sentence and one control. A heading over it could only say again what the
      // sentence says, so the sentence is the ending's own name and takes the keyboard.
      expect(ending).not.toContain("<h1");
      expect(ending.split("<p ").length - 1).toBe(1);
      expect(ending).toContain(
        '<p class="capability-deletion__ending" id="capability-deletion-ending" tabindex="-1" data-capability-deletion-focus data-capability-deletion-sentence>',
      );
      expect(ending).toContain('aria-labelledby="capability-deletion-ending"');
      // An ordinary in-window section: no dialog, no inertness, no focus trap.
      expect(ending).not.toContain("role=");
      expect(ending).not.toContain("inert");
    }
    expect(failure).toContain("I couldn’t delete Notes. Everything you had there is still safe.");
    expect(refusal).toContain("I’m making another change right now");
  });

  test("the four refusals keep four sentences, and the drain has its own", () => {
    const say = (refusal: Parameters<typeof renderCapabilityDeletionRefusal>[1]) =>
      renderCapabilityDeletionRefusal(notesRow(), refusal, NEUTRAL);

    expect(say({ kind: "busy" })).toContain(
      "I’m making another change right now, so I didn’t delete Notes. Try again when I’m finished.",
    );
    expect(say({ kind: "drain_timeout" })).toContain(
      "Something in Notes was still finishing, so I didn’t delete it. Everything you had there is still safe — try again in a moment.",
    );
    expect(say({ kind: "stale" })).toContain(
      "Notes changed after you opened this page, so I didn’t delete it.",
    );
    // The drain is not a shade of the generic failure: it says what was happening and it
    // invites the retry that will probably work.
    expect(say({ kind: "drain_timeout" })).not.toContain("I couldn’t delete Notes.");
  });

  test("a held ending carries the evidence forward rather than a rendered surface", () => {
    const other = { ...boomRow(), id: "ledger", incarnation_id: "inc-ledger" };
    const ending = renderCapabilityDeletionRefusal(
      notesRow(),
      { kind: "busy" },
      {
        kind: "capability",
        capabilityId: other.id,
        incarnationId: other.incarnation_id,
      },
    );

    // The same restoration route **Keep it** takes, re-resolved at the press.
    expect(ending).toContain(
      `hx-get="/capability-deletion-restoration?restore_surface=capability&amp;restore_capability_id=ledger&amp;restore_incarnation_id=inc-ledger"`,
    );
    expect(ending).not.toContain("data-active-capability-id");
  });

  test("an ending escapes every label it renders", () => {
    const ending = renderCapabilityDeletionRefusal(
      notesRow({ label: "Tom & Jerry" }),
      { kind: "stale" },
      NEUTRAL,
    );

    expect(ending).toContain("Tom &amp; Jerry changed after you opened this page");
    expect(ending).not.toMatch(/Tom & Jerry/);
  });

  test("and an ending for a label that is not a name shows the fallback instead", () => {
    const ending = renderCapabilityDeletionRefusal(
      notesRow({ label: '<img src=x onerror="alert(1)">' }),
      { kind: "stale" },
      NEUTRAL,
    );

    expect(ending).not.toContain("<img");
    expect(ending).not.toContain("&lt;img");
    expect(ending).toContain("Notes changed after you opened this page");
  });
});
