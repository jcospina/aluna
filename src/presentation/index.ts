// The platform presentation layer. Module 3 introduces the capability-scoped
// presentation surface: the runtime allow-list enforcer (epic 3.1/02, here), and later
// the item wrapper, modal, and presentation adapter (epics 3.2 / 3.4).
//
// The enforcer is the render-time safety half of the closed-value design contract; the
// vocabulary it keys on is exported too, so the design-lint gate rung (3.6) can share the
// one source of truth rather than re-list it.

export { enforceItemMarkup } from "./enforcer.ts";
export { sanitizeStyle } from "./style-discipline.ts";
export {
  ALLOWED_CLASSES,
  ALLOWED_ELEMENTS,
  REMOVED_ELEMENTS,
} from "./vocabulary.ts";
