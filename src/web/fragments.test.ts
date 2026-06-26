import { describe, expect, test } from "bun:test";

import { renderCapabilityCommitSwap } from "./fragments.ts";

interface OobInspection {
  readonly entryCount: number;
  readonly entryInsideOobCount: number;
  readonly oobCount: number;
  readonly oobIsCapabilityEntry: boolean;
  readonly oobValue: string | null;
}

async function inspectToolbarOob(fragment: string): Promise<OobInspection> {
  const insideOobStack: boolean[] = [];
  let entryCount = 0;
  let entryInsideOobCount = 0;
  let oobCount = 0;
  let oobIsCapabilityEntry = false;
  let oobValue: string | null = null;

  const rewriter = new HTMLRewriter()
    .on("*", {
      element(element) {
        const hasOob = element.getAttribute("hx-swap-oob") !== null;
        const insideOob = hasOob || insideOobStack.includes(true);

        if (hasOob) {
          oobCount += 1;
          oobValue = element.getAttribute("hx-swap-oob");
        }

        if (element.canHaveContent) {
          insideOobStack.push(insideOob);
          element.onEndTag(() => {
            insideOobStack.pop();
          });
        }
      },
    })
    .on("[data-capability-entry]", {
      element(element) {
        entryCount += 1;
        entryInsideOobCount += insideOobStack.includes(true) ? 1 : 0;
        oobIsCapabilityEntry ||= element.getAttribute("hx-swap-oob") !== null;
      },
    });

  await new Response(rewriter.transform(new Response(fragment)).body).text();
  return { entryCount, entryInsideOobCount, oobCount, oobIsCapabilityEntry, oobValue };
}

describe("web fragments", () => {
  test("commit-time toolbar OOB wraps the canonical entry for htmx beforeend insertion", async () => {
    const fragment = renderCapabilityCommitSwap(
      { id: "notes", label: "Notes" },
      '<section id="notes-records" hx-get="/capability/notes/read"></section>',
      '<form hx-post="/capability/notes/create"></form>',
    );

    expect(await inspectToolbarOob(fragment)).toEqual({
      entryCount: 1,
      entryInsideOobCount: 1,
      oobCount: 1,
      oobIsCapabilityEntry: false,
      oobValue: "beforeend:#capability-toolbar",
    });
    expect(fragment).toContain("data-capability-toolbar-oob");
    expect(fragment).toContain("data-capability-entry");
  });
});
