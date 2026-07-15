export type BuildJobStatus = "pending" | "running" | "done";

export interface BuildJob {
  readonly id: string;
  readonly prompt: string;
  status: BuildJobStatus;
}

export type BuildEvent = "narration" | "fragment" | "done" | string;
export type SendBuildEvent = (event: BuildEvent, data: string) => Promise<void>;

export interface BuildPipelineContext {
  readonly job: BuildJob;
  readonly send: SendBuildEvent;
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
const BUILD_FAILURE_NARRATION = "Hmm, that didn't work. Mind trying again?";
const DEFAULT_PENDING_JOB_TTL_MS = 60_000;

interface StoredBuildJob extends BuildJob {
  readonly createdAt: number;
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

  create(prompt: string): CreateBuildJobResult {
    this.pruneExpiredPendingJobs();
    const job: StoredBuildJob = {
      id: this.createId(),
      prompt,
      status: "pending",
      createdAt: this.now(),
    };
    this.jobs.set(job.id, job);
    return { accepted: true, job };
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
      await send("done", "already-streaming");
      return;
    }

    await this.runPendingJob(job, send, isAborted, signal);
  }

  private findStreamableJob(jobId: string): BuildJob | undefined {
    const job = this.jobs.get(jobId);
    return job?.status !== "done" ? job : undefined;
  }

  private async runPendingJob(
    job: BuildJob,
    send: SendBuildEvent,
    isAborted: () => boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    job.status = "running";
    try {
      const completion = await this.pipeline({ job, send, isAborted, signal });
      if (!isAborted() && completion !== "terminal-sent") {
        await send("done", "ok");
      }
    } catch (err) {
      console.error("Aluna build job failed:", err instanceof Error ? err.message : err);
      if (!isAborted()) {
        await send("narration", BUILD_FAILURE_NARRATION);
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
