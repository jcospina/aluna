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
}

export type BuildPipeline = (context: BuildPipelineContext) => Promise<void>;
type CreateBuildId = () => string;

export type CreateBuildJobResult =
  | { readonly accepted: true; readonly job: BuildJob }
  | { readonly accepted: false; readonly activeJobId: string };

export interface BuildJobQueueOptions {
  readonly pipeline?: BuildPipeline;
  readonly createId?: CreateBuildId;
}

const DEFAULT_BUILD_NARRATION = "Got it. I'm putting that together now.";
const BUILD_FAILURE_NARRATION = "Hmm, that didn't work. Mind trying again?";

async function placeholderBuildPipeline({ send, isAborted }: BuildPipelineContext) {
  if (isAborted()) return;
  await send("narration", DEFAULT_BUILD_NARRATION);
}

function defaultBuildId(): string {
  return `build-${crypto.randomUUID()}`;
}

export class BuildJobQueue {
  private activeJob: BuildJob | undefined;
  private readonly pipeline: BuildPipeline;
  private readonly createId: CreateBuildId;

  constructor(options: BuildJobQueueOptions = {}) {
    this.pipeline = options.pipeline ?? placeholderBuildPipeline;
    this.createId = options.createId ?? defaultBuildId;
  }

  create(prompt: string): CreateBuildJobResult {
    if (this.activeJob && this.activeJob.status !== "done") {
      return { accepted: false, activeJobId: this.activeJob.id };
    }

    const job: BuildJob = {
      id: this.createId(),
      prompt,
      status: "pending",
    };
    this.activeJob = job;
    return { accepted: true, job };
  }

  async stream(jobId: string, send: SendBuildEvent, isAborted: () => boolean): Promise<void> {
    const job = this.findStreamableJob(jobId);
    if (!job) {
      await send("done", "missing");
      return;
    }

    if (job.status === "running") {
      await send("done", "already-streaming");
      return;
    }

    await this.runPendingJob(job, send, isAborted);
  }

  private findStreamableJob(jobId: string): BuildJob | undefined {
    const job = this.activeJob;
    return job && job.id === jobId && job.status !== "done" ? job : undefined;
  }

  private async runPendingJob(
    job: BuildJob,
    send: SendBuildEvent,
    isAborted: () => boolean,
  ): Promise<void> {
    job.status = "running";
    try {
      await this.pipeline({ job, send, isAborted });
      if (!isAborted()) {
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
      if (this.activeJob === job) {
        this.activeJob = undefined;
      }
    }
  }
}

export function createBuildJobQueue(options: BuildJobQueueOptions = {}): BuildJobQueue {
  return new BuildJobQueue(options);
}
