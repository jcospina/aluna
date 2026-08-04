import { describe, expect, test } from "bun:test";

import { boomRow, notesRow } from "../router/router.test-support.ts";
import {
  dependentCapabilityNames,
  renderCapabilityDeletionBlocked,
  renderCapabilityDeletionConfirmation,
} from "./presentation.ts";

describe("capability-deletion presentation", () => {
  test("names the capability and explains permanent loss in plain product voice", () => {
    const html = renderCapabilityDeletionConfirmation(notesRow(), []);

    expect(html).toContain("Delete Notes permanently?");
    expect(html).toContain(
      "This deletes all records, every past setup, saved files and anything else it owns, plus its activity history. You can’t undo this.",
    );
    expect(html).toContain(
      "Aluna keeps a few measurements about creating or changing Notes, but never your content",
    );
    expect(html).toContain('class="capability-deletion__retention"');
    expect(html).toContain('class="btn btn--neutral capability-deletion__keep"');
    expect(html).toContain("Delete permanently</button>");
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
    expect(renderCapabilityDeletionBlocked(notesRow(), [alpha])).toContain(
      "Notes can’t be deleted while Reading list uses it",
    );
    expect(renderCapabilityDeletionBlocked(notesRow(), [alpha, beta])).toContain(
      "Notes can’t be deleted while Reading list and Weekly digest use it",
    );
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
});
