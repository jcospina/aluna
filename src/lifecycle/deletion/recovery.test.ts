// A capability deletion whose reply never arrived, recovered by the real
// `public/capability-deletion.js` on the confirmation the server renders: it asks again on a
// schedule, and says what the server answers — in the window while it still owns it, on the prompt
// bar once it does not. Timers run at once here, and each delay asked for is kept.

import { describe, expect, test } from "bun:test";

import {
  CAPABILITY_DELETION_RECHECK_DELAYS_MS,
  capabilityDeletionPreflightUrl,
  configureCapabilityDeletionRestoration,
  DELETION_RECHECK_ASKING,
  DELETION_RECHECK_GAVE_UP,
  DELETION_RECHECK_SETTLED,
  focusCapabilityDeletion,
  recoverSeveredCapabilityDeletion,
  rescueCapabilityDeletionEnding,
  startCapabilityDeletionRecovery,
} from "#shell/capability-deletion.js";
import { WINDOW_CONTENT_REGION } from "#shell/desk-window.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "#shell/prompt-bar.js";
import {
  RELEASE_REGION_EVENT,
  regionScopeReport,
  releaseRegionContent,
} from "#shell/region-scope.js";
import { WINDOW_CONTENT_ID } from "#shell/shell-dom.js";
import { Doc, El, parseHtml } from "../../presentation/controls/choice-picker.test-support.ts";
import { startedOn } from "../../presentation/controls/started-module.test-support.ts";
import { notesRow } from "../../runtime/router/dispatch/router.test-support.ts";
import { renderPromptNotice } from "../../server/http/fragments.ts";
import {
  DELETION_ENDING_ATTRIBUTE,
  DELETION_EXIT_ATTRIBUTE,
  DELETION_SENTENCE_ATTRIBUTE,
  renderCapabilityDeletionConfirmation,
  renderCapabilityDeletionPreCommitFailure,
} from "./index.ts";

/** One reply to a recheck: a status and a body, or the connection going before any arrives. */
type Reply = { status?: number; body?: string; replaceUrl?: string } | "severed";

/** A window holding the confirmation, and every effect the recovery can have, written down. */
function confirmationDesk() {
  const doc = new Doc();
  parseHtml(
    `<div id="${WINDOW_CONTENT_ID}" data-content-region="${WINDOW_CONTENT_REGION}">` +
      `${renderCapabilityDeletionConfirmation(notesRow(), [])}</div>`,
    doc,
  );
  const output = doc.getElementById(WINDOW_CONTENT_ID) as El;
  const said: { sentence: string; refused: boolean }[] = [];
  doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (event) => {
    said.push((event as unknown as CustomEvent).detail);
  });
  const order: string[] = [];
  doc.addEventListener(RELEASE_REGION_EVENT, (event) => {
    if (event.target === output) order.push("release");
  });
  return {
    doc,
    output,
    confirm: output.querySelector("[data-capability-deletion-confirm]") as El,
    said,
    order,
  };
}

/** Stand the page's globals up for one recovery, run it to the end, and put every one back. */
async function recover(
  desk: ReturnType<typeof confirmationDesk>,
  replies: Reply[],
  {
    elt = desk.confirm as unknown,
    htmx = true,
    meanwhile = () => {},
    start = () => recoverSeveredCapabilityDeletion({ detail: { elt } } as never, desk.doc as never),
  }: { elt?: unknown; htmx?: boolean; meanwhile?: () => void; start?: () => unknown } = {},
) {
  const rechecks = () =>
    regionScopeReport().filter(({ label }) => label === "deletion recheck").length;
  const standing = rechecks();
  const asked = {
    delays: [] as number[],
    fetched: [] as [string, RequestInit | undefined][],
    swaps: [] as unknown[][],
    replaced: [] as unknown[][],
    claims: [] as number[],
  };
  const history = {
    state: { at: "the desk" },
    replaceState: (...args: unknown[]) => void asked.replaced.push(args),
  };
  const globals: Record<string, unknown> = {
    document: desk.doc,
    HTMLElement: El,
    window: {
      history,
      ...(htmx
        ? {
            htmx: {
              swap: (...args: unknown[]) => {
                desk.order.push("swap");
                asked.swaps.push(args);
              },
            },
          }
        : {}),
    },
    // Run at once, but never past the schedule's own length: a recheck that stopped counting its
    // tries would otherwise spin on microtasks without end.
    setTimeout: (run: () => void, delay: number) => {
      asked.delays.push(delay);
      if (asked.delays.length <= CAPABILITY_DELETION_RECHECK_DELAYS_MS.length) queueMicrotask(run);
      return 0;
    },
    fetch: (url: string, init?: RequestInit) => {
      asked.fetched.push([url, init]);
      asked.claims.push(rechecks() - standing);
      meanwhile();
      const reply = replies.shift() ?? "severed";
      if (reply === "severed") return Promise.reject(new Error("severed"));
      const headers = reply.replaceUrl ? { "HX-Replace-Url": reply.replaceUrl } : undefined;
      return Promise.resolve(
        new Response(reply.body ?? "", { status: reply.status ?? 200, headers }),
      );
    },
  };
  const host = globalThis as Record<string, unknown>;
  const before = Object.keys(globals).map(
    (name) => [name, Reflect.getOwnPropertyDescriptor(host, name)] as const,
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(host, name, { value, configurable: true, writable: true });
  }
  try {
    await start();
    for (let turn = 0; turn < 20; turn += 1) await Bun.sleep(0);
  } finally {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(host, name, descriptor);
      else Reflect.deleteProperty(host, name);
    }
  }
  return { ...asked, claimed: rechecks() - standing };
}

const failure = () => renderCapabilityDeletionPreCommitFailure(notesRow(), { kind: "neutral" });
/** The sentence that failure says, read off the server's own markup. */
const ending = (
  parseHtml(failure(), new El("div")).querySelector(`[${DELETION_SENTENCE_ATTRIBUTE}]`) as El
).textContent;

describe("asking again until the server answers", () => {
  test("three tries on the schedule, then it says it cannot tell and lets the window go", async () => {
    const desk = confirmationDesk();
    const asked = await recover(desk, ["severed", { status: 500 }, "severed"]);
    expect(asked.delays).toEqual(CAPABILITY_DELETION_RECHECK_DELAYS_MS);
    const url = capabilityDeletionPreflightUrl(desk.confirm as never) as string;
    expect(asked.fetched).toEqual(
      [1, 2, 3].map(() => [url, { headers: { "HX-Request": "true" } }]),
    );
    expect(desk.said).toEqual([
      { sentence: DELETION_RECHECK_ASKING, refused: false },
      { sentence: DELETION_RECHECK_GAVE_UP, refused: true },
    ]);
    expect(asked.claims).toEqual([1, 1, 1]);
    expect(asked.claimed).toBe(0);
    expect(asked.swaps).toEqual([]);
  });

  test("an answer while the window is still its own is swapped in, after the region lets go", async () => {
    const desk = confirmationDesk();
    const asked = await recover(desk, [{ status: 500 }, { body: failure(), replaceUrl: "/" }]);
    expect(desk.said).toEqual([
      { sentence: DELETION_RECHECK_ASKING, refused: false },
      { sentence: "", refused: false },
    ]);
    expect(desk.order).toEqual(["release", "swap"]);
    expect(asked.swaps).toEqual([
      [
        desk.output,
        failure(),
        { swapStyle: "innerHTML", swapDelay: 0, settleDelay: 0 },
        { eventInfo: { target: desk.output } },
      ],
    ]);
    expect(asked.replaced).toEqual([[{ at: "the desk" }, "", "/"]]);
    expect(asked.claimed).toBe(0);
  });

  test("with no htmx the answer is written in, and an answer naming no address moves none", async () => {
    const desk = confirmationDesk();
    const asked = await recover(desk, [{ body: failure() }], { htmx: false });
    expect(desk.output.querySelector(`[${DELETION_ENDING_ATTRIBUTE}]`)).not.toBeNull();
    expect(asked.replaced).toEqual([]);
  });
});

describe("an answer that arrives after the window moved on", () => {
  test("an ending's sentence goes to the prompt bar, trimmed, as a refusal", async () => {
    const desk = confirmationDesk();
    const release = () => releaseRegionContent(desk.output as never);
    const asked = await recover(desk, [{ body: `\n${failure()}\n` }], { meanwhile: release });
    expect(desk.said.at(-1)).toEqual({ sentence: ending, refused: true });
    expect(asked.swaps).toEqual([]);
    expect(asked.replaced).toEqual([]);
  });

  test("an ending's sentence is said without the space around it, and a blank one is not said", async () => {
    const padded = failure().replace(ending, `  ${ending}  `);
    const blank = failure().replace(ending, "   ");
    for (const [body, sentence] of [
      [padded, ending],
      [blank, DELETION_RECHECK_SETTLED],
    ]) {
      const desk = confirmationDesk();
      const release = () => releaseRegionContent(desk.output as never);
      await recover(desk, [{ body }], { meanwhile: release });
      expect(desk.said.at(-1)?.sentence).toBe(sentence);
    }
    expect(padded).not.toBe(failure());
    expect(
      new Set([DELETION_RECHECK_ASKING, DELETION_RECHECK_GAVE_UP, DELETION_RECHECK_SETTLED, ""])
        .size,
    ).toBe(4);
  });

  test("a notice is said with its own tone, and a reply saying nothing says the desk is settled", async () => {
    const replies: [string, { sentence: string; refused: boolean }][] = [
      [renderPromptNotice("  Gone for good.  "), { sentence: "Gone for good.", refused: false }],
      [
        renderPromptNotice("Not this one.", "refusal"),
        { sentence: "Not this one.", refused: true },
      ],
      [renderPromptNotice("   "), { sentence: DELETION_RECHECK_SETTLED, refused: false }],
      ["<p>nothing to say</p>", { sentence: DELETION_RECHECK_SETTLED, refused: false }],
    ];
    for (const [body, expected] of replies) {
      const desk = confirmationDesk();
      const release = () => releaseRegionContent(desk.output as never);
      await recover(desk, [{ body }], { meanwhile: release });
      expect(desk.said.at(-1)).toEqual(expected);
    }
  });

  test("a window gone altogether takes the answer's address with it", async () => {
    const desk = confirmationDesk();
    const asked = await recover(desk, [{ body: failure(), replaceUrl: "/" }], {
      meanwhile: () => desk.output.remove(),
    });
    expect(desk.said.at(-1)).toEqual({ sentence: ending, refused: true });
    expect(asked.replaced).toEqual([[{ at: "the desk" }, "", "/"]]);
  });

  test("a confirmation that is not an element answers on the prompt bar, never in the window", async () => {
    const desk = confirmationDesk();
    const bare = {
      getAttribute: (name: string) => desk.confirm.getAttribute(name),
    };
    const asked = await recover(desk, [{ body: failure(), replaceUrl: "/" }], { elt: bare });
    expect(asked.fetched[0]?.[0]).toBe(capabilityDeletionPreflightUrl(bare as never) as string);
    expect(desk.said.at(-1)).toEqual({ sentence: ending, refused: true });
    expect(asked.swaps).toEqual([]);
    expect(asked.replaced).toEqual([]);
  });

  test("a request that was not a confirmation starts nothing", async () => {
    for (const elt of [null, {}, new El("form")]) {
      const desk = confirmationDesk();
      const asked = await recover(desk, [], { elt });
      expect([desk.said, asked.fetched]).toEqual([[], []]);
    }
  });
});

describe("the recheck's own address", () => {
  test("carries only the restoration it was given, and marks itself a recheck", () => {
    const doc = new Doc();
    parseHtml(renderCapabilityDeletionConfirmation(notesRow(), [], { kind: "neutral" }), doc);
    const confirm = doc.querySelector("[data-capability-deletion-confirm]") as El;
    const url = new URL(capabilityDeletionPreflightUrl(confirm as never) as string, "http://desk");
    expect([...url.searchParams.keys()]).toEqual(["restore_surface", "after_confirm"]);
    expect(url.searchParams.get("restore_surface")).toBe("neutral");
    const emptied = confirm.querySelector('[name="restore_surface"]') as El;
    emptied.value = "";
    const bare = new URL(capabilityDeletionPreflightUrl(confirm as never) as string, "http://desk");
    expect([...bare.searchParams.keys()]).toEqual(["after_confirm"]);
    expect(capabilityDeletionPreflightUrl(new El("form") as never)).toBeNull();
  });
});

describe("what a deletion's request says it displaces", () => {
  const deleting = () => {
    const doc = new Doc();
    parseHtml(`<button data-capability-delete></button>`, doc);
    return doc.querySelector("button") as El;
  };

  test("only a deletion is told anything, and a desk with no window is neutral", () => {
    const parameters: Record<string, unknown> = {};
    expect(
      configureCapabilityDeletionRestoration({ elt: new El("button") as never, parameters }),
    ).toBe(false);
    expect(configureCapabilityDeletionRestoration({ parameters })).toBe(false);
    expect(parameters).toEqual({});
    const empty = new Doc();
    expect(
      configureCapabilityDeletionRestoration(
        { elt: deleting() as never, parameters },
        empty as never,
      ),
    ).toBe(true);
    expect(parameters).toEqual({ restore_surface: "neutral" });
    expect(
      configureCapabilityDeletionRestoration({ elt: deleting() as never }, empty as never),
    ).toBe(true);
  });

  test("a capability standing in the window is what the deletion restores", () => {
    const doc = new Doc();
    parseHtml(
      `<div id="${WINDOW_CONTENT_ID}"><section data-active-capability-id="notes"` +
        ` data-active-capability-incarnation="inc-1"></section></div>`,
      doc,
    );
    const parameters: Record<string, unknown> = {};
    expect(
      configureCapabilityDeletionRestoration(
        { elt: deleting() as never, parameters },
        doc as never,
      ),
    ).toBe(true);
    expect(parameters).toEqual({
      restore_surface: "capability",
      restore_capability_id: "notes",
      restore_incarnation_id: "inc-1",
    });
    (doc.querySelector("section") as El).removeAttribute("data-active-capability-incarnation");
    const half: Record<string, unknown> = {};
    expect(
      configureCapabilityDeletionRestoration(
        { elt: deleting() as never, parameters: half },
        doc as never,
      ),
    ).toBe(true);
    expect(half).toEqual({ restore_surface: "neutral" });
  });
});

describe("the recovery's listeners, on the document it starts on", () => {
  /** An ending standing in a started document, and what the prompt bar was told. */
  function endingDesk() {
    const doc = new Doc();
    parseHtml(`<div id="${WINDOW_CONTENT_ID}">${failure()}</div>`, doc);
    const said: unknown[] = [];
    doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (event) => {
      said.push((event as unknown as CustomEvent).detail);
    });
    const ending = doc.querySelector(`[${DELETION_ENDING_ATTRIBUTE}]`) as El;
    startCapabilityDeletionRecovery(doc as never);
    return { doc, said, ending, exit: ending.querySelector("button") as El };
  }

  test("a reply that failed to send, timed out or was aborted starts the recovery", async () => {
    for (const type of ["htmx:sendError", "htmx:timeout", "htmx:sendAbort"]) {
      const desk = confirmationDesk();
      await recover(desk, [], {
        start: () => {
          startCapabilityDeletionRecovery(desk.doc as never);
          desk.doc.fire(type, desk.confirm, { detail: { elt: desk.confirm } });
        },
      });
      expect(desk.said[0]).toEqual({ sentence: DELETION_RECHECK_ASKING, refused: false });
    }
  });

  test("the module starts itself on the document it is loaded into", async () => {
    const desk = confirmationDesk();
    await recover(desk, [], {
      start: async () => {
        await startedOn("capability-deletion.js", desk.doc);
        desk.doc.fire("htmx:sendError", desk.confirm, { detail: { elt: desk.confirm } });
      },
    });
    expect(desk.said[0]).toEqual({ sentence: DELETION_RECHECK_ASKING, refused: false });
  });

  test("an ending being cleaned away is carried to the prompt bar once, trimmed", () => {
    const desk = endingDesk();
    const sentence = desk.ending.querySelector("p") as El;
    sentence.textContent = `  ${sentence.textContent}  `;
    desk.doc.fire("htmx:beforeCleanupElement", desk.ending);
    desk.doc.fire("htmx:beforeCleanupElement", desk.ending);
    expect(desk.said).toEqual([{ sentence: sentence.textContent.trim(), refused: false }]);
    expect(desk.ending.hasAttribute(DELETION_ENDING_ATTRIBUTE)).toBe(false);
  });

  test("an ending with nothing to say, or anything else cleaned away, carries nothing", () => {
    const desk = endingDesk();
    (desk.ending.querySelector("p") as El).textContent = "  ";
    desk.doc.fire("htmx:beforeCleanupElement", desk.ending);
    desk.doc.fire("htmx:beforeCleanupElement", desk.exit);
    expect(desk.said).toEqual([]);
    expect(() => rescueCapabilityDeletionEnding(null, undefined)).not.toThrow();
    // With no document to say it on, a rescue says nothing rather than failing the cleanup.
    const standing = Reflect.getOwnPropertyDescriptor(globalThis, "document");
    Reflect.deleteProperty(globalThis, "document");
    try {
      (desk.ending.querySelector("p") as El).textContent = ending;
      expect(() => rescueCapabilityDeletionEnding(desk.ending as never, undefined)).not.toThrow();
    } finally {
      if (standing) Object.defineProperty(globalThis, "document", standing);
    }
  });

  test("an answer to one of its exits retires the ending, so it is not carried off as well", () => {
    const desk = endingDesk();
    desk.doc.fire("htmx:beforeSwap", desk.doc, {
      detail: { shouldSwap: false, requestConfig: { elt: desk.exit } },
    });
    expect(desk.ending.hasAttribute(DELETION_ENDING_ATTRIBUTE)).toBe(true);
    desk.doc.fire("htmx:beforeSwap", desk.doc, {
      detail: { requestConfig: { elt: desk.doc.querySelector("div") } },
    });
    desk.doc.fire("htmx:beforeSwap", desk.doc, {});
    expect(desk.ending.hasAttribute(DELETION_ENDING_ATTRIBUTE)).toBe(true);
    desk.doc.fire("htmx:beforeSwap", desk.doc, { detail: { requestConfig: { elt: desk.exit } } });
    expect(desk.ending.hasAttribute(DELETION_ENDING_ATTRIBUTE)).toBe(false);
  });

  test("Keep it, an exit outside any ending, is answered with nothing to retire", () => {
    const desk = confirmationDesk();
    startCapabilityDeletionRecovery(desk.doc as never);
    const keep = desk.output.querySelector(".capability-deletion__keep") as El;
    expect(keep.hasAttribute(DELETION_EXIT_ATTRIBUTE)).toBe(true);
    expect(() =>
      desk.doc.fire("htmx:beforeSwap", keep, { detail: { requestConfig: { elt: keep } } }),
    ).not.toThrow();
  });

  test("pressing an exit with no prompt bar on the page moves nothing and throws nothing", () => {
    const desk = endingDesk();
    expect(() => desk.doc.fire("click", desk.exit)).not.toThrow();
    expect(() => focusCapabilityDeletion({} as never)).not.toThrow();
  });
});
