// The platform presentation layer. Module 3 introduces the capability-scoped
// presentation surface: the runtime allow-list enforcer (epic 3.1/02), the
// centralized create/detail field renderer (epic 3.2/01, deterministic from the
// spec), and later the list container/item wrapper, modal, and presentation adapter
// (epics 3.2 / 3.4).
//
// The enforcer is the render-time safety half of the closed-value design contract; the
// vocabulary it keys on is exported too, so the design-lint gate rung (3.6) can share the
// one source of truth rather than re-list it.

export { enforceItemMarkup } from "./enforcer.ts";
export {
  capabilityRecordsRegionId,
  RECORD_CREATED_EVENT,
  type RenderableCapability,
  renderCreateForm,
  renderDetailFields,
} from "./field-renderer.ts";
export {
  COLLECTION_LAYOUTS,
  type CollectionLayout,
  type CollectionOptions,
  collectionLayoutClass,
  DEFAULT_COLLECTION_LAYOUT,
  ITEM_PAYLOAD_ATTR,
  ITEM_TRIGGER_CLASS,
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
