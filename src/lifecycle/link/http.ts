import type { Database } from "bun:sqlite";
import type { Context, Hono } from "hono";
import {
  type ChooserList,
  type ChooserTarget,
  renderChooserPanel,
} from "../../presentation/controls/link/link-chooser.ts";
import {
  type CapabilityRow,
  canonicalCapabilityLabel,
  listCapabilities,
  type SpecField,
} from "../../registry/index.ts";
import type { MutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";
import type { ReadGateCoordinator } from "../../runtime/concurrency/read-gates.ts";
import { READ_UNAVAILABLE_FRAGMENT } from "../../runtime/router/index.ts";
import { NO_STORE } from "../../server/http/cache-headers.ts";
import { guardWritingRoute } from "../../server/http/writing-route-guard.ts";
import {
  type AdmittedEnds,
  type CapabilityLinkOutcome,
  type LinkPress,
  linkCapabilityField,
  pressFields,
  pressFrom,
  staleIfDropped,
} from "./front-half.ts";
import { afterTheNoteGoesOut, answerMatching } from "./matching/matching-answer.ts";
import { readPickList } from "./pick/pick.ts";
import {
  answerLinkNotice,
  LINK_STALE_CODE,
  LINK_UNREADABLE_CODE,
  notLinkedNotice,
} from "./presentation.ts";
import { readPreviews } from "./previews.ts";
import {
  type LinkEnd,
  type LinkTarget,
  linkableField,
  linkTargets,
  sourceRefusal,
} from "./rules.ts";
import { suggestedTarget } from "./suggestion.ts";
import { answerUnlink } from "./unlink/unlink-http.ts";

export interface CapabilityLinkHttpDeps {
  readonly registryReadwrite: Database;
  readonly registryReadonly: Database;
  readonly mutationCoordinator: MutationCoordinator;
  readonly readGates: ReadGateCoordinator;
}

/** The chooser list's own id, which every id in its panel is written under. */
const ID_PREFIX = /^[a-z][a-z0-9_-]{0,159}$/;

/**
 * Top-level platform routes, as Rename's are: no Handler loads, no resolver runs and no model is
 * asked, so the chain in a form reaches the registry zero-AI end to end.
 */
export function registerCapabilityLinkRoutes(app: Hono, deps: CapabilityLinkHttpDeps): void {
  // The pattern `capabilityLinkUrl` fills in; it would percent-encode the parameters' colons.
  app.get("/capability-link/:id/:field", (c) => answerChooser(c, deps));
  app.post("/capability-link/:id/:field", guardWritingRoute(), (c) => answerPress(c, deps));
  app.get("/capability-link/:id/:field/records", (c) => answerPick(c, deps));
  app.post("/capability-link/:id/:field/unlink", guardWritingRoute(), (c) => answerUnlink(c, deps));
}

/** The records a linked field's dropdown holds, read as the desk is now each time it opens. */
function answerPick(c: Context, deps: CapabilityLinkHttpDeps): Response {
  const answer = readPickList(c.req.param("id") ?? "", c.req.param("field") ?? "", {
    readGates: deps.readGates,
    readonly: deps.registryReadonly,
  });
  switch (answer.status) {
    case "read":
      return c.json(answer.list, 200, NO_STORE);
    case "not_linked":
      return answerLinkNotice(c, notLinkedNotice(answer.source));
    case "unavailable":
      return c.html(READ_UNAVAILABLE_FRAGMENT, 409, NO_STORE);
    case "gone":
      return answerLinkNotice(c, { code: LINK_STALE_CODE, moved: null, opening: true });
  }
}

/** The chooser's panel, read when it opens, so every target and value is as the desk is now. */
function answerChooser(c: Context, deps: CapabilityLinkHttpDeps): Response {
  const prefix = c.req.query("for") ?? "";
  if (!ID_PREFIX.test(prefix)) return c.text("", 400, NO_STORE);
  const catalog = listCapabilities(deps.registryReadonly);
  const row = catalog.find((candidate) => candidate.id === c.req.param("id"));
  if (!row) return answerLinkNotice(c, { code: LINK_STALE_CODE, moved: null, opening: true });
  const source = { row, field: c.req.param("field") ?? "" };
  const clicked = linkableField(source);
  const refused = sourceRefusal(source);
  if (refused || !clicked) {
    return answerLinkNotice(c, { code: refused ?? "source_not_linkable", source });
  }
  const list = chooserList(source, clicked, catalog, deps);
  const panel = renderChooserPanel(prefix, { noun: row.noun, field: clicked }, list);
  return c.html(panel, 200, NO_STORE);
}

function chooserList(
  source: LinkEnd,
  clicked: SpecField,
  catalog: readonly CapabilityRow[],
  deps: CapabilityLinkHttpDeps,
): ChooserList {
  const targets = linkTargets(source, catalog);
  const previews = readPreviews(targets, {
    readGates: deps.readGates,
    readonly: deps.registryReadonly,
  });
  const readable = targets.filter((target) => previews.has(target));
  const suggested = suggestedTarget(clicked, readable);
  const listed = (target: LinkTarget): ChooserTarget => ({
    capabilityId: target.row.id,
    capabilityLabel: canonicalCapabilityLabel(target.row),
    field: target.spec,
    preview: previews.get(target) ?? [],
    press: pressFor(source.row, target),
  });
  const rest = readable.filter((target) => target !== suggested);
  const groups = [...new Set(rest.map((target) => target.row))].map((row) =>
    rest.filter((target) => target.row === row).map(listed),
  );
  return suggested ? { suggested: listed(suggested), groups } : { groups };
}

/** What a press on one option posts: both ends, each as the chooser read it. */
function pressFor(source: CapabilityRow, target: LinkTarget): URLSearchParams {
  return new URLSearchParams(pressFields(source, target.row, target.field));
}

/**
 * A pick, written in place: a refusal as a notice, or once the pair is admitted, the note the form
 * shows while the relation is written and its names matched, then the report (`matching-answer.ts`).
 */
async function answerPress(c: Context, deps: CapabilityLinkHttpDeps): Promise<Response> {
  const form = await c.req.raw.formData().catch(() => null);
  const press = form && pressFrom(c.req.param("id") ?? "", c.req.param("field") ?? "", form);
  if (!press) return answerLinkNotice(c, { code: LINK_UNREADABLE_CODE });
  const admitted = Promise.withResolvers<AdmittedEnds>();
  const outcome = admit(press, deps, c.req.raw.signal, (ends) => {
    admitted.resolve(ends);
    return afterTheNoteGoesOut();
  });
  // An admitted pair is told before it is written, so a linked outcome never comes first.
  const first = await Promise.race([admitted.promise, outcome]);
  if (!("status" in first) || first.status === "linked") return answerMatching(first, outcome);
  if (first.status === "stale") {
    return answerLinkNotice(c, { code: LINK_STALE_CODE, moved: first.moved });
  }
  return answerLinkNotice(c, first);
}

function admit(
  press: LinkPress,
  deps: CapabilityLinkHttpDeps,
  signal: AbortSignal,
  onAdmitted: (ends: AdmittedEnds) => Promise<void>,
): Promise<CapabilityLinkOutcome> {
  return staleIfDropped(() =>
    linkCapabilityField(press, {
      database: deps.registryReadwrite,
      readonlyDatabase: deps.registryReadonly,
      mutationCoordinator: deps.mutationCoordinator,
      signal,
      onAdmitted,
    }),
  );
}
