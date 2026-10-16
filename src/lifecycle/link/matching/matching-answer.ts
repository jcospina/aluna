// A press's answer once the rules admit its pair under the lease, sent in two lines of JSON as the
// write goes: `{"note"}` first, which the form shows atop itself while the relation and its link
// rows are written, then `{"report"}`, which the prompt bar says. A body that ends with no report
// wrote nothing, as the two are written in one transaction.

import { errorDetail } from "../../../platform/errors.ts";
import { connectingNote, matchingReport } from "../../../presentation/controls/link/link-copy.ts";
import { NO_STORE } from "../../../server/http/cache-headers.ts";
import type { AdmittedEnds, CapabilityLinkOutcome } from "../front-half.ts";

export const MATCHING_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

/** What one line of the answer carries. */
export type MatchingLine = { readonly note: string } | { readonly report: string };

/**
 * The turn the write waits for once the pair is admitted: the write holds the thread until it
 * ends, so the answer's head and its note go out first.
 */
export function afterTheNoteGoesOut(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The answer for `ends`, whose report follows once `outcome` settles. */
export function answerMatching(
  ends: AdmittedEnds,
  outcome: Promise<CapabilityLinkOutcome>,
): Response {
  const encoder = new TextEncoder();
  // Gone once the reader lets go: a person who left is told nothing, and the scan runs anyway.
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(opened) {
      controller = opened;
    },
    cancel() {
      controller = undefined;
    },
  });
  const send = (line: MatchingLine) =>
    controller?.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
  const end = () => {
    controller?.close();
    controller = undefined;
  };
  send({ note: connectingNote(ends.source.plural_noun, ends.target.plural_noun) });
  void outcome
    .then((settled) => {
      if (settled.status !== "linked") return;
      const nouns = { noun: settled.source.noun, plural: settled.source.plural_noun };
      send({ report: matchingReport(nouns, settled.target.noun, settled.matched) });
    })
    .catch((error: unknown) => {
      console.error(
        "omni-crud could not match the names a linked field holds:",
        errorDetail(error),
      );
    })
    .finally(end);
  return new Response(body, {
    status: 200,
    headers: { ...NO_STORE, "content-type": MATCHING_CONTENT_TYPE },
  });
}
