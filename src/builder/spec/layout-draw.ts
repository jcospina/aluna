// The collection layout of a capability whose card shows a file is drawn from its incarnation, not
// left to the spec model (7.4/03). Asked cold, the model lays out every photo capability as a grid
// and every sound or document as a feed, the mode collapse the logo's shades answer the same way
// (`registry/logo.ts`). The gallery shows every set of families a field may take, alone or as a
// list, in both layouts, so either draw is one the item renderer has an example for. A card that
// shows no file keeps the layout the model chose.

import { seedFrom } from "#design/lib/random.js";
import {
  type CapabilitySpec,
  isFileFieldType,
  type UiCollectionLayout,
  uiCollectionLayoutSchema,
} from "../../registry/index.ts";

/** The layout `incarnationId` draws for a card that shows a file. */
export function drawnFileCardLayout(incarnationId: string): UiCollectionLayout {
  const layouts: readonly UiCollectionLayout[] = uiCollectionLayoutSchema.options;
  return layouts[seedFrom(incarnationId) % layouts.length] as UiCollectionLayout;
}

/** The spec with its layout drawn from `incarnationId` when its card shows a file. */
export function drawFileCardLayout(spec: CapabilitySpec, incarnationId: string): CapabilitySpec {
  const showsFile = spec.schema.fields.some(
    (field) => isFileFieldType(field.type) && spec.ui_intent.item.shows.includes(field.name),
  );
  if (!showsFile) return spec;
  const layout = drawnFileCardLayout(incarnationId);
  return {
    ...spec,
    ui_intent: { ...spec.ui_intent, collection: { ...spec.ui_intent.collection, layout } },
  };
}
