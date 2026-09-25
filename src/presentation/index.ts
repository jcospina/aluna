// The platform presentation layer: the runtime allow-list enforcer, the centralized create/edit
// field renderer, the list container and item wrapper, the in-window record view, and the
// adapter that composes them into the safe wrapped item HTML the router injects into every
// Handler.
//
// The enforcer is the render-time safety half of the closed-value design contract. The vocabulary
// and High Meadow token names it keys on are exported too, so the design-lint gate rung shares
// one source of truth rather than re-listing it.

export {
  ADDING_LABEL,
  BUSY_LABEL_ATTRIBUTE,
  busyLabelAttribute,
  DELETING_RECORD_LABEL,
  SAVING_RECORD_LABEL,
} from "./controls/busy-label.ts";
export {
  capabilityCreateErrorId,
  capabilityDeleteErrorId,
  capabilityEditErrorId,
  capabilityRecordsRegionId,
  type RenderableCapability,
  renderCreateForm,
  renderEditForm,
} from "./fields/field-renderer.ts";
export { renderableFromRow, renderableFromSpec } from "./fields/renderable-capability.ts";
export {
  createPlatformPresentationAdapter,
  createPresentationAdapter,
  type ItemRenderer,
  type PlatformPresentationAdapter,
  type PresentableRecord,
  type PresentationAdapter,
  type PresentationAdapterOptions,
  RECORD_TEMPLATE_ID_PREFIX,
} from "./records/adapter.ts";
export {
  collectionCountSentence,
  filteredCollectionCountSentence,
  type RecordNouns,
  renderCollectionCountSidecar,
} from "./records/collection-count.ts";
export {
  COLLECTION_LAYOUTS,
  type CollectionLayout,
  type CollectionOptions,
  collectionLayoutClass,
  countRenderedItems,
  DEFAULT_COLLECTION_LAYOUT,
  ITEM_PAYLOAD_ATTR,
  ITEM_RECORD_VIEW_ATTR,
  ITEM_TRIGGER_CLASS,
  type ItemRecordViewRef,
  itemElementIdForTemplate,
  renderCollection,
  renderItemWrapper,
  serializeItemPayload,
} from "./records/list-container.ts";
export {
  RECORD_BACK_ATTR,
  RECORD_VIEW_ATTR,
  renderRecordView,
  renderRecordViewTemplate,
} from "./records/record-view.ts";
export { enforceItemMarkup, neutralizeItemMarkup } from "./safety/enforcer.ts";
export { enforceHandlerFragment, type SafeFragment } from "./safety/fragment-safety.ts";
export { describeStyleViolation, sanitizeStyle } from "./safety/style-discipline.ts";
export {
  ALLOWED_CLASSES,
  ALLOWED_ELEMENTS,
  REMOVED_ELEMENTS,
} from "./safety/vocabulary.ts";
export {
  isTokenFrom,
  PALETTE_COLOR_TOKENS,
  SPACING_TOKENS,
  TYPE_SIZE_TOKENS,
  tokenList,
} from "./tokens/design-tokens.ts";
