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
//   build/      — the v1 `new_capability` path: intent → deflection → stages → commit
//   evolution/  — additive evolution candidate assembly (4.6/03)
//   streaming/  — what goes on the wire during a run: dev `*-preview` events and the
//                 product-voice terminal presentation
//   demo/       — the `/demo/*` runners and the temporary hand-authored tracers
//   metrics-recorder.ts — cross-cutting: one durable metrics row per run, for both paths

export {
  createPromptBuildPipeline,
  type PromptBuildPipelineDeps,
} from "./build/prompt-pipeline.ts";
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
