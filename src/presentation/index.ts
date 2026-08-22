// The platform presentation layer. Module 3 introduces the capability-scoped
// presentation surface: the runtime allow-list enforcer, the
// centralized create/edit/detail field renderer (deterministic from the
// spec), the list container/item wrapper, the shared read/edit modal
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
  DETAIL_TEMPLATE_ID_PREFIX,
  type ItemRenderer,
  type PlatformPresentationAdapter,
  type PresentableRecord,
  type PresentationAdapter,
  type PresentationAdapterOptions,
} from "./adapter.ts";
export {
  isTokenFrom,
  LINE_WEIGHT_TOKENS,
  PALETTE_COLOR_TOKENS,
  SPACING_TOKENS,
  TYPE_SIZE_TOKENS,
  tokenList,
} from "./design-tokens.ts";
export {
  DETAIL_MODAL_BODY_ID,
  DETAIL_MODAL_ID,
  DETAIL_MODAL_TITLE_ID,
  OPEN_DETAIL_EVENT,
  renderDetailContent,
  renderDetailContentTemplate,
  renderDetailModal,
} from "./detail-modal.ts";
export { enforceItemMarkup } from "./enforcer.ts";
export {
  capabilityCreateErrorId,
  capabilityDeleteErrorId,
  capabilityEditErrorId,
  capabilityRecordsRegionId,
  RECORD_CREATED_EVENT,
  type RenderableCapability,
  renderCreateForm,
  renderDetailFields,
  renderEditForm,
} from "./field-renderer.ts";
export {
  COLLECTION_LAYOUTS,
  type CollectionLayout,
  type CollectionOptions,
  collectionLayoutClass,
  DEFAULT_COLLECTION_LAYOUT,
  ITEM_DETAIL_TEMPLATE_ATTR,
  ITEM_DETAIL_TITLE_ATTR,
  ITEM_PAYLOAD_ATTR,
  ITEM_TRIGGER_CLASS,
  type ItemDetailRef,
  itemElementIdForTemplate,
  renderCollection,
  renderItemWrapper,
  serializeItemPayload,
} from "./list-container.ts";
export { describeStyleViolation, sanitizeStyle } from "./style-discipline.ts";
export {
  ALLOWED_CLASSES,
  ALLOWED_ELEMENTS,
  REMOVED_ELEMENTS,
} from "./vocabulary.ts";
