// The Link control's scene: the renderer's own forms with their chains, the shipped client started on
// them, and a stand-in server answering the chooser's reads and writes with the platform's own
// renderers. The client reads `fetch` off the page, so it is put back after each test. Not a test file.

import { afterEach } from "bun:test";
import { startLinkControls } from "#shell/controls/link-control.js";
import { PROMPT_BAR_MESSAGE_EVENT, PROMPT_NOTICE_ID } from "#shell/desk/prompt-bar.js";
import type { MatchingLine } from "../../../lifecycle/link/matching/matching-answer.ts";
import { type LinkNotice, renderLinkNotice } from "../../../lifecycle/link/presentation.ts";
import { SECOND_INCARNATION_ID } from "../../../registry/incarnations.test-support.ts";
import type { SpecField } from "../../../registry/index.ts";
import { notesRow } from "../../../runtime/router/dispatch/router.test-support.ts";
import { probeField } from "../../fields/field-renderer.test-support.ts";
import {
  type RenderableCapability,
  renderCreateForm,
  renderEditForm,
} from "../../fields/field-renderer.ts";
import { installDomGlobals } from "../double/choice-picker.fixture.test-support.ts";
import { Doc, type El, parseHtml } from "../double/choice-picker.test-support.ts";
import { type ChooserList, type ChooserTarget, renderChooserPanel } from "./link-chooser.ts";
import { connectingNote, matchingReport } from "./link-copy.ts";

/** One request the client made, as the server would read it. */
export interface Exchange {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

export type Reply = (exchange: Exchange) => Response | Promise<Response>;

/** The single-line text fields the chain is drawn in. */
export const AUTHOR = probeField("string", { name: "author", label: "Author", required: false });
export const TITLE = probeField("string", { name: "title", label: "Title", required: false });

/** A capability whose form holds `fields`, with the relations a registry row carries. */
export function bookCapability(fields: readonly SpecField[] = [AUTHOR]): RenderableCapability {
  return {
    id: "books",
    label: "Books",
    noun: "book",
    relations: [],
    schema: { fields },
    form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
    actions: ["create", "read", "update"],
  };
}

/** The new-record form alone, every field's one copy on the page. */
export function deskWithOneForm(fields: readonly SpecField[] = [AUTHOR, TITLE]): string {
  return renderCreateForm(bookCapability(fields));
}

/** The new-record form and a record's Edit form, both on the page: two copies of every field. */
export function deskWithTwoForms(fields: readonly SpecField[] = [AUTHOR, TITLE]): string {
  const capability = bookCapability(fields);
  return renderCreateForm(capability) + renderEditForm(capability, { id: "book-1" });
}

/** One field the chooser lists, with the press the server would hand it. */
export function chooserTarget(
  capabilityId: string,
  capabilityLabel: string,
  field: Pick<SpecField, "name" | "label">,
  preview: readonly string[] = [],
): ChooserTarget {
  return {
    capabilityId,
    capabilityLabel,
    field: probeField("string", { ...field, required: false }),
    preview,
    press: new URLSearchParams({
      incarnation_id: SECOND_INCARNATION_ID,
      version: "3",
      target: capabilityId,
      target_field: field.name,
      target_incarnation_id: SECOND_INCARNATION_ID,
      target_version: "7",
    }),
  };
}

export const NAMES = chooserTarget("authors", "Authors", { name: "name", label: "Name" }, [
  "Ursula K. Le Guin",
  "Octavia E. Butler",
]);
export const SHELF = chooserTarget("shelves", "Shelves", { name: "label", label: "Label" });
export const LIST: ChooserList = { suggested: NAMES, groups: [[SHELF]] };

/** The chooser's whole panel, written under the list id the client asked for. */
export const listed =
  (list: ChooserList = LIST): Reply =>
  (exchange) => {
    const listId = new URL(exchange.url, "http://desk.test").searchParams.get("for") ?? "";
    const panel = renderChooserPanel(listId, { noun: "book", field: AUTHOR }, list);
    return new Response(panel, { status: 200 });
  };

/** The note a written pick's answer opens with, and the report it ends with. */
export const NOTE = connectingNote("books", "authors");
export const REPORT = matchingReport({ noun: "book", plural: "books" }, "author", {
  linked: 2,
  unmatched: 1,
});

/** A written pick's answer, each line as the route sends one; a line may be held back. */
export function matched(lines: readonly MatchingLine[] = [{ note: NOTE }, { report: REPORT }]) {
  let send: (line: MatchingLine) => void = () => {};
  let end = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      send = (line) => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(line)}\n`));
      end = () => controller.close();
    },
  });
  for (const line of lines) send(line);
  return { response: new Response(body, { status: 200 }), send, end };
}

export const written: Reply = () => {
  const answer = matched();
  answer.end();
  return answer.response;
};

/** A notice the platform answers instead, at the status its route gives it. */
export const noticed =
  (notice: LinkNotice, status: number): Reply =>
  () =>
    new Response(renderLinkNotice(notice), { status });

/** A refusal with no notice in it, as a server that failed outright sends one. */
export const failed: Reply = () => new Response("Internal Server Error", { status: 500 });

/** The connection lost before any answer came. */
export const unreachable: Reply = () => Promise.reject(new TypeError("Failed to fetch"));

/** An answer whose body is lost on the way. */
export const cutOff =
  (status: number): Reply =>
  () =>
    ({ ok: status < 300, status, text: () => Promise.reject(new TypeError("cut off")) }) as never;

export const STALE: LinkNotice = { code: "link_stale", moved: null };
export const REFUSED: LinkNotice = {
  code: "target_is_source",
  source: { row: notesRow(), field: "text" },
};
export const NOT_LINKABLE: LinkNotice = {
  code: "source_not_linkable",
  source: { row: notesRow(), field: "text" },
};
export const ALREADY_LINKED: LinkNotice = {
  code: "source_already_linked",
  source: { row: notesRow(), field: "text" },
};

/** A reply the test lets go of when it chooses, so a request can be caught in flight. */
export function held(reply: Reply): { reply: Reply; release: () => void } {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reply: async (exchange) => gate.then(() => reply(exchange)), release };
}

const page = globalThis as unknown as { fetch: unknown };
const realFetch = page.fetch;

/** The DOM globals for a suite, and `fetch` restored after every test in it. */
export function installLinkGlobals(): void {
  installDomGlobals();
  afterEach(() => {
    page.fetch = realFetch;
  });
}

/** Every pending answer delivered and every promise after it run: a few turns of the event loop. */
export async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** One chooser's parts. The panel's inside is replaced on every read, so those are asked for live. */
export function chooserParts(root: El) {
  const panel = root.querySelector(".listbox__panel") as El;
  const shell = root.querySelector(".field__control") as El;
  const inside = (selector: string) => panel.querySelector(selector);
  return {
    root,
    panel,
    shell,
    button: root.querySelector(".link-control__button") as El,
    input: shell.querySelector("input") as El,
    scroll: () => inside(".listbox__scroll") as El,
    head: () => inside(".link-control__head"),
    line: () => inside(".link-control__line"),
    empty: () => inside(".listbox__empty"),
    options: () => panel.querySelectorAll('[role="option"]'),
  };
}

/** A document holding `html`, the client started on it, and `replies` answering in order. */
export async function linkScene(replies: Reply[] = [], html = renderCreateForm(bookCapability())) {
  const exchanges: Exchange[] = [];
  page.fetch = async (url: string, init: RequestInit = {}) => {
    const exchange = {
      url: String(url),
      method: init.method ?? "GET",
      body: init.body === undefined ? "" : String(init.body),
    };
    exchanges.push(exchange);
    const reply = replies.shift();
    if (!reply) throw new Error(`nothing answers ${exchange.method} ${exchange.url}`);
    return reply(exchange);
  };
  const doc = new Doc();
  parseHtml(`${html}<p id="${PROMPT_NOTICE_ID}"></p>`, doc);
  const said: unknown[] = [];
  // The bar's slot, standing in for `public/desk/prompt-bar.js`: it holds what was last said.
  const notice = doc.getElementById(PROMPT_NOTICE_ID) as El;
  doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (event) => {
    const detail = (event as unknown as CustomEvent).detail;
    said.push(detail);
    notice.textContent = detail.sentence;
  });
  startLinkControls(doc as never);
  const first = doc.querySelector("[data-link-control]");
  return {
    ...(first ? chooserParts(first) : ({} as ReturnType<typeof chooserParts>)),
    doc,
    notice,
    exchanges,
    said,
    replies,
    /** The chooser around the input with this id, in the document. */
    chooserOf: (inputId: string) =>
      chooserParts((doc.getElementById(inputId) as El).closest("[data-link-control]") as El),
    press: async (on: El) => {
      doc.fire("click", on);
      await settle();
    },
    key: async (key: string, on: El) => {
      doc.fire("keydown", on, { key });
      await settle();
    },
  };
}

export async function openScene(replies: Reply[] = [], html?: string) {
  const scene = await linkScene([listed(), ...replies], html);
  await scene.press(scene.button);
  return scene;
}
