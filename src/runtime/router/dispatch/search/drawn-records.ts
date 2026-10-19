// The `present()` a search Handler receives: the capability's own, noting each record it draws
// and the card it drew, as the Gate's smoke rung does at build time. A search Handler's whole
// answer is its cards, which is what lets the platform add cards after them; an answer holding
// anything else leaves no place it can tell they would land.

import {
  enforceHandlerFragment,
  type PresentationAdapter,
} from "../../../../presentation/index.ts";
import { materializeCapabilityActionRecord } from "../../../data/index.ts";

export interface DrawnRecords {
  readonly present: PresentationAdapter;
  /**
   * The records the cleaned answer shows, when it is nothing but cards drawn here, in the order
   * drawn, with whitespace between; a record drawn and left out is not shown. Undefined when the
   * answer holds anything else.
   */
  readonly shownIn: (cleaned: string) => ReadonlySet<string> | undefined;
}

export function noteDrawnRecords(present: PresentationAdapter): DrawnRecords {
  const drawn: { readonly id: string; readonly card: string }[] = [];
  return {
    present(record) {
      const card = present(record);
      drawn.push({ id: String(materializeCapabilityActionRecord(record).id), card });
      return card;
    },
    shownIn(cleaned) {
      const shown = new Set<string>();
      let at = afterSpace(cleaned, 0);
      for (const { id, card } of drawn) {
        if (at === cleaned.length) break;
        const length = cardAt(cleaned, at, card);
        if (length === 0) continue;
        shown.add(id);
        at = afterSpace(cleaned, at + length);
      }
      return at === cleaned.length ? shown : undefined;
    },
  };
}

/** How long `card` runs where it stands at `at`, as drawn or as the scrub left it: 0 if not there. */
function cardAt(cleaned: string, at: number, card: string): number {
  if (cleaned.startsWith(card, at)) return card.length;
  const scrubbed = enforceHandlerFragment(card).html;
  return scrubbed !== card && cleaned.startsWith(scrubbed, at) ? scrubbed.length : 0;
}

function afterSpace(text: string, from: number): number {
  let at = from;
  while (at < text.length && /\s/u.test(text.charAt(at))) at += 1;
  return at;
}
