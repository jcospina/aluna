// The web presentation layer — the route handlers' request parsing and HTML output.
//
// The single public entry point: reading the typed prompt off a request and
// rendering the shell fragments the `/prompt` and build flows return or stream.
// Everything here is transport/markup glue with no build logic. (`escapeHtml` is
// deliberately not re-exported: every caller imports it from `./html.ts` directly.)

export {
  renderCachedCapabilityCommitSwap,
  renderCachedCapabilitySurface,
  renderRehydratedShellPage,
} from "./cached-view.ts";
export {
  BLANK_PROMPT_NOTICE,
  BUILD_WINDOW_TITLE_ATTRIBUTE,
  BUILDING_WINDOW_TITLE,
  capabilityLogoElementId,
  PAGE_ASSEMBLY_ANCHORS,
  type RenderableCapabilityLogo,
  renderBuildEnding,
  renderBuildSubscriber,
  renderBuildWindowTitle,
  renderCapabilityLogo,
  renderPromptNotice,
  renderProvisionalLogo,
  renderProvisionalLogoName,
  renderRehydratedShell,
} from "./fragments.ts";
export {
  hasMeaningfulPromptContent,
  readPrompt,
  readPromptSubmission,
} from "./prompt-request.ts";
