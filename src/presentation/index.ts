// The platform presentation layer. Module 3 introduces the capability-scoped
// presentation surface: the runtime allow-list enforcer, the
// centralized create/edit field renderer (deterministic from the
// spec), the list container/item wrapper, the in-window record view
// and the presentation adapter that composes them
// into the record → safe wrapped item HTML the router injects into every Handler.
//
// The enforcer is the render-time safety half of the closed-value design contract; the
// vocabulary and the High Meadow token names it keys on are exported too, so the
// design-lint gate rung (3.6, re-derived in 5.1) can share the one source of truth rather
// than re-list it.

export {
  createPlatformPresentationAdapter,
  createPresentationAdapter,
  type ItemRenderer,
  type PlatformPresentationAdapter,
  type PresentableRecord,
  type PresentationAdapter,
  type PresentationAdapterOptions,
  RECORD_TEMPLATE_ID_PREFIX,
} from "./adapter.ts";
export {
  isTokenFrom,
  PALETTE_COLOR_TOKENS,
  SPACING_TOKENS,
  TYPE_SIZE_TOKENS,
  tokenList,
} from "./design-tokens.ts";
export { enforceItemMarkup } from "./enforcer.ts";
export {
  capabilityCreateErrorId,
  capabilityDeleteErrorId,
  capabilityEditErrorId,
  capabilityRecordsRegionId,
  RECORD_CREATED_EVENT,
  type RenderableCapability,
  renderCreateForm,
  renderEditForm,
} from "./field-renderer.ts";
export {
  COLLECTION_LAYOUTS,
  type CollectionLayout,
  type CollectionOptions,
  collectionLayoutClass,
  DEFAULT_COLLECTION_LAYOUT,
  ITEM_PAYLOAD_ATTR,
  ITEM_RECORD_VIEW_ATTR,
  ITEM_TRIGGER_CLASS,
  type ItemRecordViewRef,
  itemElementIdForTemplate,
  renderCollection,
  renderItemWrapper,
  serializeItemPayload,
} from "./list-container.ts";
export {
  RECORD_BACK_ATTR,
  RECORD_VIEW_ATTR,
  renderRecordView,
  renderRecordViewTemplate,
} from "./record-view.ts";
export { describeStyleViolation, sanitizeStyle } from "./style-discipline.ts";
export {
  ALLOWED_CLASSES,
  ALLOWED_ELEMENTS,
  REMOVED_ELEMENTS,
} from "./vocabulary.ts";
