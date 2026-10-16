/**
 * Linking a field by hand, from the chain inside it, and unlinking it from the broken chain
 * (ADR-0011).
 *
 * One short platform write, the way Rename is one: the relation lands on the registry row beside
 * the logo seed, no model is asked and no version is made. The rules that decide which fields can
 * link are written once, in `rules.ts`, for the chooser that offers a target and the write that
 * takes it, so the list never offers what the write refuses.
 */
export { type CapabilityLinkHttpDeps, registerCapabilityLinkRoutes } from "./http.ts";
export { matchLinkedFieldsAtStartup } from "./matching/match-at-startup.ts";
export { type LinkRefusalCode, linkRefusal, linkTargets } from "./rules.ts";
