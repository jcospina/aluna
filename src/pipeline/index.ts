// The build pipeline — turning a prompt into a committed capability (Module 2).
//
// The single public entry point for the orchestration layer that sits above the
// builder stages (`src/builder`): the production `/prompt` pipeline a queued job
// runs, the `/demo/spec-build` route's runner, and the metrics-recorder type the app
// wires its writer through. The app depends only on this barrel; the stage-running,
// preview, deflection, and metrics internals stay private to the folder.
//
// Layout:
//   jobs/       — build-job admission/queueing and the Complete-View restoration descriptor
//   build/      — resolution and the core Builder. `prompt-pipeline.ts` classifies a typed
//                 prompt into a `ResolvedBuildRequest`; `core-builder.ts` takes it from
//                 there (lease, lease-head stale revalidation, admission row, run) behind a
//                 presenter interface, and `explicit-presenter.ts` is the explicit loop's
//                 implementation of that interface — the seam Module 7 reuses (4.8/03)
//   evolution/  — the one evolution path: candidate assembly (4.6/03) and the
//                 complete run through publication and activation (4.6/05)
//   streaming/  — what goes on the wire during a run: dev `*-preview` events and the
//                 product-voice terminal presentation
//   demo/       — the remaining `/demo/*` runner
//   metrics-recorder.ts — cross-cutting: one durable metrics row per run, for both paths

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
} from "./build/explicit-presenter.ts";
export {
  createPromptBuildPipeline,
  type PromptBuildPipelineDeps,
} from "./build/prompt-pipeline.ts";
export {
  type PromptResolutionMemory,
  type PromptResolutionOutcome,
  type ResolvedBuildRequest,
  type ResolvedExistingCapabilityRequest,
  type ResolvedNewCapabilityRequest,
  resolvedExistingCapabilityRequest,
  resolvedNewCapabilityRequest,
} from "./build/resolved-request.ts";
export {
  DEMO_SPEC_PROMPT,
  handleSpecBuildError,
  streamSpecBuildDemo,
} from "./demo/spec-build-demo.ts";
export {
  createMetricsRecorder,
  finalizeMeasuredNoChange,
  type RecordMetrics,
} from "./metrics-recorder.ts";
