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
import {
  MutationAdmissionError,
  type MutationCoordinator,
} from "../../runtime/concurrency/mutation-coordinator.ts";
import type { ReadGateCoordinator } from "../../runtime/concurrency/read-gates.ts";
import { NO_STORE } from "../../server/http/cache-headers.ts";
import { guardWritingRoute } from "../../server/http/writing-route-guard.ts";
import { singleFormValue } from "../form-values.ts";
import { type CapabilityLinkOutcome, type LinkPress, linkCapabilityField } from "./front-half.ts";
import {
  LINK_STALE_CODE,
  LINK_UNREADABLE_CODE,
  type LinkNotice,
  renderLinkNotice,
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
}

/** The chooser's panel, read when it opens, so every target and value is as the desk is now. */
function answerChooser(c: Context, deps: CapabilityLinkHttpDeps): Response {
  const prefix = c.req.query("for") ?? "";
  if (!ID_PREFIX.test(prefix)) return c.text("", 400, NO_STORE);
  const catalog = listCapabilities(deps.registryReadonly);
  const row = catalog.find((candidate) => candidate.id === c.req.param("id"));
  if (!row) return answerNotice(c, { code: LINK_STALE_CODE, moved: null, opening: true });
  const source = { row, field: c.req.param("field") ?? "" };
  const clicked = linkableField(source);
  const refused = sourceRefusal(source);
  if (refused || !clicked) {
    return answerNotice(c, { code: refused ?? "source_not_linkable", source });
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
  return new URLSearchParams({
    incarnation_id: source.incarnation_id,
    version: String(source.version),
    target: target.row.id,
    target_field: target.field,
    target_incarnation_id: target.row.incarnation_id,
    target_version: String(target.row.version),
  });
}

/** A pick, written in place. The prompt bar says nothing on success (owner ruling, 2026-10-08). */
async function answerPress(c: Context, deps: CapabilityLinkHttpDeps): Promise<Response> {
  const press = pressFrom(c, await c.req.raw.formData());
  if (!press) return answerNotice(c, { code: LINK_UNREADABLE_CODE });
  const outcome = await admit(press, deps, c.req.raw.signal);
  if (outcome.status === "linked") return c.body(null, 204, NO_STORE);
  if (outcome.status === "stale") {
    return answerNotice(c, { code: LINK_STALE_CODE, moved: outcome.moved });
  }
  return answerNotice(c, outcome);
}

/** Both versions, as integers; a form without them was not written by the chooser. */
function pressFrom(c: Context, form: Parameters<typeof singleFormValue>[0]): LinkPress | null {
  const version = versionIn(singleFormValue(form, "version"));
  const targetVersion = versionIn(singleFormValue(form, "target_version"));
  if (version === null || targetVersion === null) return null;
  return {
    source: {
      capabilityId: c.req.param("id") ?? "",
      field: c.req.param("field") ?? "",
      incarnationId: singleFormValue(form, "incarnation_id"),
      version,
    },
    target: {
      capabilityId: singleFormValue(form, "target"),
      field: singleFormValue(form, "target_field"),
      incarnationId: singleFormValue(form, "target_incarnation_id"),
      version: targetVersion,
    },
  };
}

/** A version as the chooser writes one: digits, nothing else. `Number` would read "" and "0x1". */
function versionIn(text: string): number | null {
  if (!/^[0-9]{1,15}$/.test(text)) return null;
  return Number(text);
}

/** A press whose caller went away while it queued leaves the queue; nobody reads the answer. */
async function admit(
  press: LinkPress,
  deps: CapabilityLinkHttpDeps,
  signal: AbortSignal,
): Promise<CapabilityLinkOutcome> {
  try {
    return await linkCapabilityField(press, {
      database: deps.registryReadwrite,
      readonlyDatabase: deps.registryReadonly,
      mutationCoordinator: deps.mutationCoordinator,
      signal,
    });
  } catch (error) {
    if (error instanceof MutationAdmissionError) return { status: "stale", moved: null };
    throw error;
  }
}

/** A refusal is spoken on the prompt bar by `public/controls/link-control.js`, never swapped in. */
function answerNotice(c: Context, notice: LinkNotice): Response {
  const status = notice.code === LINK_STALE_CODE ? 409 : 422;
  return c.html(renderLinkNotice(notice), status, NO_STORE);
}
