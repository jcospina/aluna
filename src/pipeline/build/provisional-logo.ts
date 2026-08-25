// What is written under the tile an admitted build stands on the desk. The tile itself is
// `renderProvisionalLogo` (`src/web/fragments.ts`), which is where its contract is written
// down; this is only the question of what to call a capability that does not exist yet.

import type { IntentClassification } from "../../intent-resolver/index.ts";
import { isCapabilityNameLabel } from "../../registry/index.ts";
import { renderProvisionalLogo } from "../../web/index.ts";

/** The name for a capability resolution admitted but did not name. */
export const UNNAMED_PROVISIONAL_LOGO_LABEL = "Something new";

/**
 * A logo's name is a *name*, and at admission there is not reliably one to use: the
 * resolver's `user_facing_label` is one warm sentence about the request, and the
 * capability's authored label does not exist until the spec stage. So the two places a
 * name can legitimately come from are tried in turn, and anything sentence-shaped falls
 * back. The guard is the one the registry canonicalises labels with, so "Got it. I'm
 * putting that together now." can never end up written on the desk.
 */
export function provisionalLogoLabel(intent: IntentClassification): string {
  const proposed = intent.proposed_identity?.label?.trim();
  if (proposed && isCapabilityNameLabel(proposed)) return proposed;
  const resolved = intent.user_facing_label.trim();
  if (isCapabilityNameLabel(resolved)) return resolved;
  return UNNAMED_PROVISIONAL_LOGO_LABEL;
}

/** The out-of-band desk sidecar announcing one admitted new-capability build. */
export function renderProvisionalLogoSwap(buildId: string, intent: IntentClassification): string {
  return renderProvisionalLogo(buildId, provisionalLogoLabel(intent));
}
