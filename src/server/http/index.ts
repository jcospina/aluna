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
  ANSWER_WINDOW_ATTRIBUTE,
  ANSWER_WINDOW_OPENING,
  ANSWER_WINDOW_SAYING_ATTRIBUTE,
  ANSWER_WINDOW_TITLE_LIMIT,
  answerWindowTitle,
  BLANK_PROMPT_NOTICE,
  BUILD_WINDOW_TITLE_ATTRIBUTE,
  BUILDING_WINDOW_TITLE,
  capabilityLogoElementId,
  capabilityLogoFaceElementId,
  LONG_PROMPT_NOTICE,
  MAX_PROMPT_LENGTH,
  NOT_FOUND_NOTICE,
  PAGE_ASSEMBLY_ANCHORS,
  PROMPT_REFUSAL_ATTRIBUTE,
  type PromptNoticeTone,
  type RenderableCapabilityLogo,
  renderAnswerWindowOpening,
  renderAnswerWindowSaying,
  renderBuildEnding,
  renderBuildSubscriber,
  renderBuildWindowTitle,
  renderCapabilityLogo,
  renderCapabilityLogoFace,
  renderPromptNotice,
  renderProvisionalLogo,
  renderProvisionalLogoName,
  renderRehydratedShell,
} from "./fragments.ts";
export {
  hasMeaningfulPromptContent,
  isCrossSitePrompt,
  readPrompt,
  readPromptSubmission,
} from "./prompt-request.ts";
