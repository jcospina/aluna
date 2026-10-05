// The desk loaded at an address and started the way the page starts it, each request it asks
// ending the way a test says, as htmx 2 ends it. Shared by the record address's own desk tests and
// a name pressed in an answer (ADR-0010).

import { randomUUID } from "node:crypto";
import { PROMPT_BAR_MESSAGE_EVENT } from "#shell/desk/prompt-bar.js";
import { WINDOW_TOOK_CAPABILITY_EVENT } from "#shell/desk/window/desk-window.js";
import { notesSpec } from "../../../../registry/spec/spec.test-support.ts";
import { createCapabilityActionRecord } from "../../../../runtime/data/index.ts";
import { NOT_FOUND_FRAGMENT } from "../../../../runtime/router/wire/failure-responses.ts";
import { renderCapabilitySurface } from "../../../../server/http/fragments/fragments.ts";
import { renderableFromSpec, renderPresentedRecordView } from "../../../index.ts";
import type { El } from "../standing-desk.test-support.ts";
import {
  deskNodes,
  serverLogo,
  type ViewportDesk,
  viewportDesk,
} from "../viewport-desk.test-support.ts";

export const RECORD = randomUUID();
const LOGOS = [serverLogo("notes", "Notes"), serverLogo("recipes", "Recipes")];

/** How one request ends, given a turn to land in, or held until `gate` opens. */
export interface Ending {
  readonly status: number;
  readonly gate?: Promise<void>;
}

let screen: ViewportDesk | undefined;
/** Whether each request was asked from inside the window, as `public/app.js` reads it. */
let askedFromWindow: boolean[] = [];

/** Requests in flight that no test is holding open. */
let unsettled = 0;

/**
 * Every request no test is holding has ended, and none has followed it for a few turns: a fixed
 * wait is overrun on a loaded machine, where one request's ending starts the next one late.
 */
export async function settled() {
  const until = Date.now() + 2000;
  let quiet = 0;
  while (quiet < 3 && Date.now() < until) {
    await Bun.sleep(1);
    quiet = unsettled === 0 ? quiet + 1 : 0;
  }
}

/** Put the desk away; every suite on this harness calls it after each test. */
export function restoreDesk() {
  screen?.restore();
  screen = undefined;
}

/** Whether each request so far was asked from inside the window. */
export const askedFrom = (): readonly boolean[] => askedFromWindow;

/** A gate a test opens when it has done what it needs to while a request is in flight. */
export function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** What the server sends a request it answers: a record's view, or a collection's scaffolding. */
export function answerFor(path: string): string {
  const [, , id = "", record] = path.split("/");
  const surface = { id, incarnation_id: "i", version: 1 };
  if (record === undefined) return renderCapabilitySurface(surface, "");
  const capability = renderableFromSpec(notesSpec({ id }));
  const stored = createCapabilityActionRecord({
    id: record,
    created_at: "2026-10-04T00:00:00.000Z",
    text: "Buy figs",
    pinned: false,
  });
  return renderCapabilitySurface(surface, renderPresentedRecordView(capability, stored));
}

/**
 * End request `index` where and in the order htmx 2 ends it: `htmx:beforeSwap` and
 * `htmx:afterSwap` on the target, then on the element that asked a refusal and
 * `htmx:afterRequest` (a severed request sends `htmx:afterRequest` before `htmx:sendError`), each
 * naming that element as `requestConfig.elt`. A success is swapped in, and so is a refusal asked
 * from inside the window (`public/app.js`), unless a listener said otherwise.
 */
async function end(index: number, ending: Ending) {
  if (ending.gate) await ending.gate;
  else {
    unsettled += 1;
    await Bun.sleep(1).finally(() => {
      unsettled -= 1;
    });
  }
  const asked = screen?.htmx.requests[index];
  const source = asked?.context.source as El | undefined;
  const target = asked?.context.target as El | undefined;
  const { status } = ending;
  const inWindow = target?.contains(source) === true;
  askedFromWindow[index] = inWindow;
  const detail = {
    requestConfig: { elt: source },
    xhr: { status },
    shouldSwap: status === 200 || (status !== 0 && inWindow),
  };
  const send = (on: El | undefined, type: string, more = {}) =>
    on?.dispatchEvent({ type, bubbles: true, detail: Object.assign(detail, more) } as never);
  const outcome = status === 0 ? {} : { successful: status === 200 };
  if (status === 0) {
    send(source, "htmx:afterRequest", outcome);
    send(source, "htmx:sendError");
    return;
  }
  swap(target, detail, status === 200 ? answerFor(asked?.path ?? "") : null, send);
  if (status !== 200) send(source, "htmx:responseError");
  send(source, "htmx:afterRequest", outcome);
}

/** A swap's half of an ending: asked about, then drawn if nobody said no. */
function swap(
  target: El | undefined,
  detail: { shouldSwap: boolean },
  answer: string | null,
  send: (on: El | undefined, type: string) => void,
) {
  send(target, "htmx:beforeSwap");
  if (!detail.shouldSwap) return;
  target?.replaceChildren(...deskNodes(answer ?? NOT_FOUND_FRAGMENT));
  send(target, "htmx:afterSwap");
}

/** The desk loaded at `pathname`, each request ending the next way, in turn. */
export async function deskAnswering(
  pathname: string,
  endings: readonly (Ending | number)[],
  hearPromptBar?: (event: { detail?: unknown }) => void,
) {
  const queue = endings.map((one) => (typeof one === "number" ? { status: one } : one));
  let asks = 0;
  askedFromWindow = [];
  screen = await viewportDesk({
    pathname,
    logos: LOGOS,
    answer: () => end(asks++, queue.shift() ?? { status: 0 }),
  });
  if (hearPromptBar) screen.desk.doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, hearPromptBar);
  await settled();
  const opened = screen;
  const logo = (name: string) =>
    opened.desk.root.querySelector(`[aria-label="Open ${name}"]`) as El;
  const region = () => opened.htmx.requests[0]?.context.target as El;
  return {
    ...opened,
    logo,
    region,
    asked: () => opened.htmx.requests.map(({ path }) => path),
    written: () => opened.desk.address.written.slice(1),
    title: () => opened.desk.windows()[0]?.querySelector("h2")?.textContent,
    /** A Back or Forward onto `next`, answered by the desk's own traversal listener. */
    async travelTo(next: string) {
      opened.desk.address.pathname = next;
      const bar = (globalThis as unknown as { window: { onpopstate: (e: unknown) => void } })
        .window;
      bar.onpopstate({ state: null });
      await settled();
    },
    /** The window changing hands, as `public/app.js` says it after every swap. */
    tookCapability() {
      opened.desk.doc.dispatchEvent({
        type: WINDOW_TOOK_CAPABILITY_EVENT,
        detail: { navigated: false },
      } as never);
    },
  };
}
