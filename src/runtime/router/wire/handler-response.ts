// How a generated Handler's returned fragment becomes an HTTP answer. Two things happen to it.
//
// It is scrubbed. The enforcer runs on the item renderer's output inside `present()`, and nothing
// looked at the wrapper markup a Handler composes around those items, which htmx swaps into a live
// page where Alpine evaluates what it finds. `enforceHandlerFragment` is that wrapper's last line.
//
// And a declared refusal is read as one. A Handler signals a `behavioral_errors` refusal by
// returning a fragment carrying the spec's markers; answered as a bare 200 under `hx-swap="none"`,
// `record-mutations.js` could not tell it from a commit, reading htmx's `detail.successful`.
// Delivering it as the platform's own 422 also rolls the mutation back, because the router commits
// on `response.ok`. The code must be one the spec declared for the running Action, so a Handler
// cannot invent a refusal and record data cannot spell one by accident.

import type { Context } from "hono";

import { enforceHandlerFragment } from "../../../presentation/index.ts";
import { BEHAVIORAL_ERROR_MARKERS, type CapabilitySpec } from "../../../registry/index.ts";
import { type DeclaredRefusal, declaredRefusal } from "./failure-responses.ts";
import type { WireProtocolAction } from "./wire-protocol.ts";

export interface HandlerFragmentOutcome {
  readonly html: string;
  /** True when executable markup had to be removed — logged, never shown to the user. */
  readonly neutralized: boolean;
  /** The declared behavioral error this fragment refuses with, if it refuses. */
  readonly refusal?: DeclaredRefusal;
}

/**
 * Scrub the fragment and decide whether it is a declared refusal.
 *
 * @param spec the running capability's spec — the only source of admissible refusal codes
 */
export function readHandlerFragment(
  fragment: string,
  spec: CapabilitySpec,
  action: WireProtocolAction,
): HandlerFragmentOutcome {
  const { html, neutralized } = enforceHandlerFragment(fragment);
  const declared = declaredErrorCodes(spec, action);
  const refusal = declared.size === 0 ? undefined : findDeclaredRefusal(html, declared);
  return refusal === undefined ? { html, neutralized } : { html, neutralized, refusal };
}

function declaredErrorCodes(spec: CapabilitySpec, action: WireProtocolAction): ReadonlySet<string> {
  return new Set(
    spec.behavioral_errors
      .filter((errorCase) => errorCase.action === action)
      .map((errorCase) => errorCase.code),
  );
}

/**
 * The first element carrying both markers with a declared code, with its words, or `undefined`.
 * Parsed rather than pattern-matched: a regex cannot say the two markers sit on the *same* element.
 */
function findDeclaredRefusal(
  html: string,
  declared: ReadonlySet<string>,
): DeclaredRefusal | undefined {
  const { role_attribute, role, code_attribute, fields_attribute, fields_separator } =
    BEHAVIORAL_ERROR_MARKERS;
  const read: RefusalReading = { opened: 0, reading: false, words: "" };
  const isRefusal = (element: HTMLRewriterTypes.Element): string | undefined => {
    if (read.code !== undefined || element.getAttribute(role_attribute) !== role) return undefined;
    const code = element.getAttribute(code_attribute);
    return code !== null && declared.has(code) ? code : undefined;
  };
  new HTMLRewriter()
    .on("*", {
      element(element) {
        const index = read.opened++;
        whenItEnds(element, () => {
          if (index <= (read.at ?? -1)) read.reading = false;
        });
        if (read.reading && endsTheSentence(element.tagName, read.tag)) read.reading = false;
        const code = isRefusal(element);
        if (code === undefined) return;
        const fields = element.getAttribute(fields_attribute)?.split(fields_separator);
        Object.assign(read, {
          code,
          fields: fields?.filter(Boolean),
          at: index,
          tag: element.tagName,
          reading: element.canHaveContent,
        });
      },
      text(chunk) {
        if (read.reading) read.words += chunk.text;
      },
    })
    .transform(html);
  if (read.code === undefined) return undefined;
  // Words inside a raw-text element arrive with their markup unparsed; no `<` may reach the page.
  const sentence = read.words.replace(/\s+/g, " ").trim().replaceAll("<", "&lt;");
  return { code: read.code, sentence, fields: read.fields };
}

interface RefusalReading {
  code?: string;
  fields?: readonly string[];
  /** The refusal element's place in document order, and its tag. */
  at?: number;
  tag?: string;
  opened: number;
  reading: boolean;
  words: string;
}

/** Elements a sentence runs through; any other start tag is a new block, which ends it. */
const PHRASING = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "button",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "mark",
  "meter",
  "output",
  "progress",
  "q",
  "s",
  "samp",
  "select",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "textarea",
  "time",
  "u",
  "var",
  "wbr",
]);

/**
 * Where a browser stops reading the refusal though no end tag says so: lol-html reports an
 * implicitly closed element's end late or never, so a new block or a sibling of the same tag ends it.
 */
function endsTheSentence(tagName: string, refusalTag: string | undefined): boolean {
  return tagName === refusalTag || !PHRASING.has(tagName);
}

function whenItEnds(element: HTMLRewriterTypes.Element, then: () => void): void {
  if (!element.canHaveContent) return;
  try {
    element.onEndTag(then);
  } catch {
    // A self-closed foreign element has no end tag to wait for.
  }
}

/**
 * Deliver a Handler's fragment, scrubbed, and as a platform refusal when it carries a declared
 * marker. `countSidecar` reads the scrubbed fragment; the enforcer's subject is the model's markup.
 */
export function answerWithHandlerFragment(
  c: Context,
  id: string,
  spec: CapabilitySpec,
  action: WireProtocolAction,
  fragment: string,
  countSidecar: (html: string) => string,
): Response {
  const outcome = readHandlerFragment(fragment, spec, action);
  if (outcome.neutralized) {
    // Precise for the developer, invisible to the user: the fragment still renders minus whatever
    // executed. A Handler emitting this is a contract violation the fix loop should have caught.
    console.error(
      `Capability ${id}/${action} returned executable markup; it was neutralized before the response.`,
    );
  }
  if (outcome.refusal !== undefined && isRefusableAction(action)) {
    return declaredRefusal(c, id, action, outcome.refusal);
  }
  return c.html(`${countSidecar(outcome.html)}${outcome.html}`);
}

/** Only a mutation has a form error region for a refusal to be retargeted into. */
function isRefusableAction(action: WireProtocolAction): action is "create" | "update" | "delete" {
  return action === "create" || action === "update" || action === "delete";
}
