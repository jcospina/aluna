import { renderBuildEnding } from "../../web/fragments.ts";
import type { PromptResolutionMemory } from "../build/resolved-request.ts";
import { FAILED_BUILD_ENDING } from "../streaming/terminal-presentation.ts";
import type { RestorationDescriptor } from "./restoration.ts";

export type BuildJobStatus = "pending" | "running" | "done";

export interface BuildJob {
  readonly id: string;
  readonly prompt: string;
  /** Data-free identity of the content displaced by this foreground job. */
  readonly restoration: RestorationDescriptor;
  /** Content-free resolver outcome plus any resolved build request, retained in job memory. */
  resolution?: PromptResolutionMemory;
  status: BuildJobStatus;
}

export type BuildEvent = "narration" | "fragment" | "done" | string;
export type SendBuildEvent = (event: BuildEvent, data: string) => Promise<void>;

export interface BuildPipelineContext {
  readonly job: BuildJob;
  readonly send: SendBuildEvent;
  /** True while the connected subscriber can still receive a terminal restoration. */
  readonly canPresent: () => boolean;
  /** True for either transport disconnect or an explicit connected cancellation. */
  readonly isAborted: () => boolean;
  readonly signal?: AbortSignal;
}

export type BuildPipelineCompletion = "terminal-sent" | undefined;
export type BuildPipeline = (
  context: BuildPipelineContext,
) => Promise<BuildPipelineCompletion> | Promise<void>;
type CreateBuildId = () => string;
type Now = () => number;

export interface CreateBuildJobResult {
  readonly accepted: true;
  readonly job: BuildJob;
}

export interface BuildJobQueueOptions {
  readonly pipeline?: BuildPipeline;
  readonly createId?: CreateBuildId;
  readonly pendingJobTtlMs?: number;
  readonly now?: Now;
}

const DEFAULT_BUILD_NARRATION = "Got it. I'm putting that together now.";
const DEFAULT_PENDING_JOB_TTL_MS = 60_000;
const NEUTRAL_RESTORATION: RestorationDescriptor = { kind: "neutral" };

interface StoredBuildJob extends BuildJob {
  readonly createdAt: number;
  readonly cancelController: AbortController;
}

async function placeholderBuildPipeline({ send, isAborted }: BuildPipelineContext) {
  if (isAborted()) return;
  await send("narration", DEFAULT_BUILD_NARRATION);
}

function defaultBuildId(): string {
  return `build-${crypto.randomUUID()}`;
}

export class BuildJobQueue {
  private readonly pipeline: BuildPipeline;
  private readonly createId: CreateBuildId;
  private readonly jobs = new Map<string, StoredBuildJob>();
  private readonly now: Now;
  private readonly pendingJobTtlMs: number;

  constructor(options: BuildJobQueueOptions = {}) {
    this.pipeline = options.pipeline ?? placeholderBuildPipeline;
    this.createId = options.createId ?? defaultBuildId;
    this.now = options.now ?? Date.now;
    this.pendingJobTtlMs = options.pendingJobTtlMs ?? DEFAULT_PENDING_JOB_TTL_MS;
  }

  create(
    prompt: string,
    restoration: RestorationDescriptor = NEUTRAL_RESTORATION,
  ): CreateBuildJobResult {
    this.pruneExpiredPendingJobs();
    const job: StoredBuildJob = {
      id: this.createId(),
      prompt,
      restoration,
      status: "pending",
      createdAt: this.now(),
      cancelController: new AbortController(),
    };
    this.jobs.set(job.id, job);
    return { accepted: true, job };
  }

  /** Request cancellation without conflating it with an SSE disconnect. */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.cancelController.abort();
    return true;
  }

  async stream(
    jobId: string,
    send: SendBuildEvent,
    isAborted: () => boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    this.pruneExpiredPendingJobs();
    const job = this.findStreamableJob(jobId);
    if (!job) {
      await send("done", "missing");
      return;
    }

    if (job.status === "running") {
      await send("done", "error");
      return;
    }

    await this.runPendingJob(job, send, isAborted, signal);
  }

  private findStreamableJob(jobId: string): StoredBuildJob | undefined {
    const job = this.jobs.get(jobId);
    return job?.status !== "done" ? job : undefined;
  }

  private async runPendingJob(
    job: StoredBuildJob,
    send: SendBuildEvent,
    isAborted: () => boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    job.status = "running";
    const { cancelController } = job;
    const combinedSignal = signal
      ? AbortSignal.any([signal, cancelController.signal])
      : cancelController.signal;
    const workAborted = () => isAborted() || cancelController.signal.aborted;
    try {
      const completion = await this.pipeline({
        job,
        send,
        canPresent: () => !isAborted(),
        isAborted: workAborted,
        signal: combinedSignal,
      });
      if (!workAborted() && completion !== "terminal-sent") {
        await send("done", "ok");
      }
    } catch (err) {
      console.error("Aluna build job failed:", err instanceof Error ? err.message : err);
      if (!isAborted()) {
        // The last resort: a pipeline that threw *and* had not already presented its own
        // terminal. It has no restoration to give back — nothing here knows what the run
        // displaced — but it is still a build that failed, so it ends the narration the
        // way every failure does and the window holds there. Dismissing it drops the
        // story and leaves the surface the run only ever covered.
        await send("narration", renderBuildEnding(job.id, FAILED_BUILD_ENDING));
        await send("done", "error");
      }
    } finally {
      job.status = "done";
      this.jobs.delete(job.id);
    }
  }

  private pruneExpiredPendingJobs(): void {
    const cutoff = this.now() - this.pendingJobTtlMs;
    for (const [jobId, job] of this.jobs) {
      if (job.status === "pending" && job.createdAt <= cutoff) {
        this.jobs.delete(jobId);
      }
    }
  }
}

export function createBuildJobQueue(options: BuildJobQueueOptions = {}): BuildJobQueue {
  return new BuildJobQueue(options);
}
