// The build pipeline — turning a prompt into a committed capability.
//
// The app depends only on this barrel; stage-running, preview, deflection and metrics stay private.
//
// Layout:
//   jobs/       — build-job admission/queueing and the Complete-View restoration descriptor
//   build/      — resolution and the core Builder: `prompt-pipeline.ts` classifies a typed prompt
//                 into a `ResolvedBuildRequest`, `core-builder.ts` runs it behind the presenter
//                 interface `explicit-presenter.ts` implements
//   evolution/  — the one evolution path: candidate assembly, publication and activation
//   query/     — a classified data_query: the whole-catalog read scope opened around the loop
//   streaming/  — what goes on the wire during a run
//   metrics-recorder.ts — one durable metrics row per run, v1 build and evolution alike

export {
  type PromptResolutionMemory,
  type PromptResolutionOutcome,
  type ResolvedBuildRequest,
  type ResolvedExistingCapabilityRequest,
  type ResolvedNewCapabilityRequest,
  resolvedExistingCapabilityRequest,
  resolvedNewCapabilityRequest,
} from "./build/admission/resolved-request.ts";
export {
  type CoreBuilderPresenter,
  type CoreBuildInput,
  type CoreBuildTerminal,
  revalidateResolvedRequest,
  runCoreBuild,
  type StaleBuildRefusal,
  type StaleRefusalReason,
} from "./build/core-builder.ts";
export {
  createExplicitEvolutionPresenter,
  createExplicitPresenter,
  type ExplicitPresenterInput,
} from "./build/presenter/explicit-presenter.ts";
export {
  createPromptBuildPipeline,
  type PromptBuildPipelineDeps,
} from "./build/prompt-pipeline.ts";
export {
  createMetricsRecorder,
  finalizeMeasuredNoChange,
  type RecordMetrics,
} from "./metrics-recorder.ts";
