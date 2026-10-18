// A desk for a record's way back: the record view and the mutation rules started on the markup
// the server renders, every press and traversal drawn by the desk's own `fillAddressedWindow`,
// and the bar following the window after every swap as the desk has it follow (`followRegion`). A
// read can be held in flight, and a place can have gone.

import { randomUUID } from "node:crypto";
import { recordAddress } from "#shell/core/routes.js";
import { PUT_WINDOW_AWAY_EVENT, WINDOW_TOOK_CAPABILITY_EVENT } from "#shell/core/shell-dom.js";
import {
  capabilityAddress,
  capabilityIdFromAddress,
  DESK_HISTORY_STATE,
  isAnotherPlace,
  OPEN_THE_RECORD_EVENT,
  recordFromAddress,
  startDeskHistory,
} from "#shell/desk/desk-address.js";
import { startLeavingAForm } from "#shell/desk/leaving-a-form.js";
import { askBeforeLeaving, startLeavingGuard } from "#shell/desk/leaving-a-run.js";
import { PROMPT_BAR_MESSAGE_EVENT } from "#shell/desk/prompt-bar.js";
import { fillAddressedWindow, followRegion, stayPut } from "#shell/desk/window/addressed-window.js";
import { startUnsavedChanges } from "#shell/records/unsaved-changes.js";
import {
  INTERNAL_ERROR_FRAGMENT,
  NOT_FOUND_FRAGMENT,
  READ_UNAVAILABLE_FRAGMENT,
} from "../../../../../runtime/router/wire/failure-responses.ts";
import { renderCapabilitySurface } from "../../../../../server/http/fragments/fragments.ts";
import { Doc, type El, parseHtml } from "../../../../controls/double/choice-picker.test-support.ts";
import {
  DEFAULT_COLLECTION_LAYOUT,
  renderCollection,
  renderItemWrapper,
} from "../../../../records/collection/list-container.ts";
import { renderLinkingSection } from "../../../../records/linking/record-links.ts";
import {
  CAPABILITY,
  RECORD,
  recordDesk,
} from "../../../../records/record-view/record-view.test-support.ts";
import { RECORD_VIEW_ATTR, renderRecordView } from "../../../../records/record-view/record-view.ts";

type Id = "notes" | "recipes";
type Stored = Record<Id, typeof RECORD>;

/** A read the desk asked for, and where it asked from. */
interface Read {
  readonly path: string;
  readonly source: El;
}

/** Pages stood up so far, each given a run of counts no other page has written. */
let pages = 0;

/** The addresses this desk's records live at. */
function places(stored: Stored) {
  return {
    list: (id: Id) => capabilityAddress(id),
    record: (id: Id) => recordAddress(id, stored[id].id),
  };
}
type Places = ReturnType<typeof places>;

/**
 * What an address draws: a list with its one card, or its record listing the other capability's,
 * each capability under the label its logo carries.
 */
function drawing(stored: Stored, labels: Record<Id, string>) {
  const capabilityOf = (id: Id) => ({
    ...CAPABILITY,
    id,
    label: labels[id],
    noun: id === "notes" ? "note" : "recipe",
  });
  const card = (id: Id, listed = false) =>
    renderItemWrapper(`<span>${stored[id].text}</span>`, stored[id], { capabilityId: id, listed });
  const idOf = (address: string) =>
    (recordFromAddress(address)?.capability ?? capabilityIdFromAddress(address)) as Id;
  /** The record an address names: the stored one, or another of its capability. */
  const recordAt = (id: Id, record: string) =>
    record === stored[id].id ? stored[id] : { ...stored[id], id: record, text: `Another ${id}` };
  const inner = (address: string) => {
    const id = idOf(address);
    const named = recordFromAddress(address);
    if (named === null) return renderCollection({ capability: capabilityOf(id), items: card(id) });
    const other: Id = id === "notes" ? "recipes" : "notes";
    const linking = renderLinkingSection({
      capability: capabilityOf(other),
      layout: DEFAULT_COLLECTION_LAYOUT,
      field: "source",
      count: 1,
      cards: card(other, true),
    });
    return renderRecordView(capabilityOf(id), recordAt(id, named.record), undefined, linking);
  };
  const surface = (address: string) =>
    renderCapabilitySurface({ id: idOf(address), incarnation_id: "i", version: 1 }, inner(address));
  return { inner, surface, idOf };
}

/**
 * The desk loaded at `start` (`at` names a place, as `at.list("notes")` does), Notes and Recipes on
 * it, each with one record that lists the other's. `framed` stands the window up in its frame, with
 * the unsaved-changes question wired as the page wires it.
 */
export async function wayBackDesk(start: (at: Places) => string, framed = false) {
  const stored: Stored = {
    notes: { ...RECORD, id: randomUUID() },
    recipes: { ...RECORD, id: randomUUID(), text: "Fig jam" },
  };
  const at = places(stored);
  const labels: Record<Id, string> = { notes: CAPABILITY.label, recipes: "Recipes" };
  const { inner, surface, idOf } = drawing(stored, labels);
  /** Addresses answering 404: with the platform's "not found", or with nothing, as a record the
   * capability has no view for answers. */
  const gone = new Set<string>();
  const bare = new Set<string>();
  /** Addresses briefly unreadable, as while a deletion drains (409), or broken (500). */
  const busy = new Set<string>();
  const broken = new Set<string>();
  const held: (Read & { resolve: () => void })[] = [];
  const reads = { holding: false, severed: false, shown: start(at) };

  const follow = () => {
    const id = desk.region
      .querySelector(":scope > [data-active-capability-id]")
      ?.getAttribute("data-active-capability-id") as Id | undefined;
    if (id) followRegion(desk.region as never, id, false, (of) => labels[of as Id] ?? "");
  };
  /** One read answered as htmx 2 answers it, the bar following the swap as `app.js` has it. */
  const ending = (path: string) => {
    if (busy.has(path)) return { status: 409, responseText: READ_UNAVAILABLE_FRAGMENT };
    if (broken.has(path)) return { status: 500, responseText: INTERNAL_ERROR_FRAGMENT };
    if (gone.has(path)) return { status: 404, responseText: NOT_FOUND_FRAGMENT };
    return { status: bare.has(path) ? 404 : 200, responseText: "" };
  };
  const answer = ({ path, source }: Read) => {
    const xhr = ending(path);
    const { status } = xhr;
    const detail = { requestConfig: { elt: source }, xhr, shouldSwap: status === 200 };
    desk.doc.fire("htmx:beforeSwap", desk.region, { detail });
    if (!detail.shouldSwap) {
      if (status !== 200) desk.doc.fire("htmx:responseError", source, { detail });
      return;
    }
    desk.region.replaceChildren(...parseHtml(surface(path), new Doc()).children);
    reads.shown = path;
    desk.doc.fire("htmx:afterSwap", desk.region, { detail });
    follow();
  };
  const desk = await recordDesk(inner(reads.shown), {
    capabilityId: idOf(reads.shown),
    modules: ["records/record-view.js", "records/record-mutations.js"],
    framed,
    answer: (asked) => {
      const last = asked.requests.at(-1);
      if (last === undefined) return Promise.resolve();
      const read = { path: last.path, source: last.context.source as El };
      if (reads.severed) return Promise.reject(new Error("severed"));
      if (reads.holding) return new Promise<void>((resolve) => held.push({ ...read, resolve }));
      answer(read);
      return Promise.resolve();
    },
  });
  pages += 1;
  const index = 200_000 + pages * 1000;
  desk.tab.history.replaceState({ ...DESK_HISTORY_STATE, index }, "", reads.shown);
  startDesk(desk, reads, follow, framed);
  const release = async () => {
    const read = held.shift();
    if (read === undefined) return;
    answer(read);
    read.resolve();
    await desk.settled();
  };
  const releaseAll = async () => {
    while (held.length > 0) await release();
  };
  const ways = { gone, bare, busy, broken };
  return {
    ...scene(desk),
    ...ways,
    at,
    stored,
    labels,
    reads,
    follow,
    release,
    releaseAll,
    drawn: surface,
  };
}

/**
 * Start the address module on the desk as the desk starts it: a press or a traversal draws what the
 * address names unless the window shows it already, and the desk follows the window when told.
 */
function startDesk(
  desk: Awaited<ReturnType<typeof recordDesk>>,
  reads: { shown: string },
  follow: () => void,
  framed: boolean,
) {
  const render = (address: string) => {
    if (!isAnotherPlace(reads.shown, address)) return void stayPut();
    const named = recordFromAddress(address);
    const id = named?.capability ?? capabilityIdFromAddress(address);
    if (id === null) return;
    const opened = () => ({ region: desk.region as never, current: () => true, putAway: () => {} });
    fillAddressedWindow(named ? { id, record: named.record } : { id }, opened);
  };
  const hold = (go: () => unknown) =>
    askBeforeLeaving(desk.doc.querySelector(".window") as never, go);
  startDeskHistory({
    render,
    hold,
    follow,
    knows: (id: string) => ["notes", "recipes"].includes(id),
  });
  desk.doc.addEventListener(WINDOW_TOOK_CAPABILITY_EVENT, follow);
  if (framed) {
    const page = { addEventListener: desk.doc.addEventListener.bind(desk.doc) };
    startLeavingAForm(page as never, desk.doc as never);
    startLeavingGuard(desk.doc as never);
    startUnsavedChanges(desk.doc as never);
  }
  follow();
}

/** What a test does on the desk and reads off it. */
function scene(desk: Awaited<ReturnType<typeof recordDesk>>) {
  const said: string[] = [];
  desk.doc.addEventListener(PROMPT_BAR_MESSAGE_EVENT, (event) => {
    said.push((event as unknown as CustomEvent<{ sentence: string }>).detail.sentence);
  });
  /** How many times the window was asked to go away, as the desk is asked. */
  const putAway = { asked: 0 };
  desk.doc.addEventListener(PUT_WINDOW_AWAY_EVENT, () => {
    putAway.asked += 1;
  });
  const view = () => desk.doc.querySelector(`[${RECORD_VIEW_ATTR}]`) as El;
  const back = () => view().querySelector("[data-record-back]") as El;
  return {
    ...desk,
    said,
    putAway,
    view,
    back,
    /** What the back control says, and whether the name it is announced by ends in those words. */
    names: () => {
      const text = back().textContent;
      return [text, back().getAttribute("aria-label")?.endsWith(text) ?? false] as const;
    },
    asked: () => desk.asked.requests.map(({ path }) => path),
    /** A press, and whatever it queued. */
    async pressOn(target: El) {
      desk.doc.fire("click", target, { button: 0 });
      await desk.settled();
    },
    /** The card a press opens: in the list, or listed on the record. */
    card: () => desk.region.querySelector(".capability-item") as El,
    listedCard: () => view().querySelector(".record-links .capability-item") as El,
    /** A name pressed in an answer, which writes no history of its own. */
    async answerLink(capability: Id, record: string) {
      const detail = { capability, record };
      desk.doc.dispatchEvent(new CustomEvent(OPEN_THE_RECORD_EVENT, { detail }) as never);
      await desk.settled();
    },
    /** The form's text changed, as typing into it does. */
    type(text: string) {
      const field = view().querySelector('[name="text"]') as El & { value: string };
      desk.doc.fire("focusin", field);
      field.value = text;
    },
    /** A committed save, or a confirmed delete, of the record standing. */
    commit(kind: "save" | "delete") {
      if (kind === "delete")
        desk.doc.fire("click", view().querySelector("[data-record-delete]") as El);
      const form = view().querySelector(
        kind === "save" ? "form[data-record-edit-form]" : "form[data-record-delete-form]",
      ) as El;
      desk.doc.fire("htmx:beforeRequest", form, { detail: { elt: form } });
      desk.doc.fire("htmx:afterRequest", form, {
        detail: { elt: form, successful: true, xhr: { status: 200 } },
      });
    },
  };
}

export type WayBackDesk = Awaited<ReturnType<typeof wayBackDesk>>;
