/**
 * Renaming a capability from its own logo.
 *
 * The whole of it is one short platform write. The user-facing name a rename moves is a nullable
 * `display_label_override` the platform owns; the AI-authored `spec.label` under it and every
 * immutable `spec.json` snapshot stay byte-for-byte truthful, so no version and no build is
 * manufactured merely to rename desk furniture (PLAN decision 19).
 *
 * The effective label every display path reads is `display_label_override ?? label`, resolved
 * once in `src/registry/labels.ts`. Being ordinary semantic registry content, the override is
 * inside the resolver catalog's fingerprint, so a request resolved before a rename and not yet
 * revalidated at its lease head is refused stale rather than running against a name that is no
 * longer on the desk.
 */
export {
  type CapabilityRenameDeps,
  type CapabilityRenameExpectation,
  type CapabilityRenameOutcome,
  renameCapabilityLabel,
} from "./front-half.ts";
export { type CapabilityRenameHttpDeps, handleCapabilityRename } from "./http.ts";
export {
  CAPABILITY_RENAME_ERROR_CODE,
  renderCapabilityRenameRefusal,
  renderRenamedCapabilityLogo,
} from "./presentation.ts";
