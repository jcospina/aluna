// The platform presentation layer. Module 3 introduces the capability-scoped
// presentation surface: the runtime allow-list enforcer (epic 3.1/02), the
// centralized create/edit/detail field renderer (epic 4.3/01, deterministic from the
// spec), the list container/item wrapper (epic 3.2/02), the shared read/edit modal
// (epic 4.3/01), and the presentation adapter (epic 3.4/01) that composes them
// into the record → safe wrapped item HTML the router injects into every Handler.
//
// The enforcer is the render-time safety half of the closed-value design contract; the
// vocabulary it keys on is exported too, so the design-lint gate rung (3.6) can share the
// one source of truth rather than re-list it.

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
  capabilityEditErrorId,
  capabilityRecordsRegionId,
  RECORD_CREATED_EVENT,
  RECORD_UPDATED_EVENT,
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
export { sanitizeStyle } from "./style-discipline.ts";
export {
  ALLOWED_CLASSES,
  ALLOWED_ELEMENTS,
  REMOVED_ELEMENTS,
} from "./vocabulary.ts";
