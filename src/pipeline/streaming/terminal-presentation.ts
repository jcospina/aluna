import { CapabilityIdReservedError } from "../../registry/index.ts";
import { renderBuildEnding } from "../../server/http/fragments.ts";
import type { Send } from "../../server/sse/index.ts";
import { buildDemoErrorPreview } from "./previews.ts";

export const DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS = 2_000;

/** The product-voice failure line: the last thing the narration says. */
export const FAILED_BUILD_ENDING = "Hmm, that didn't work. Mind trying again?";

/**
 * A capability id a deletion tombstone still reserves cannot be rebuilt until that deletion's
 * cleanup is discharged, so the generic "mind trying again?" invites a retry that cannot succeed.
 */
export const RESERVED_ID_BUILD_ENDING =
  "I'm still tidying up after the last one of those. Give me a moment, then ask me again.";

/** Which ending a failure gets. Everything but the reserved id shares the generic one. */
export function buildEndingFor(error: unknown): string {
  return error instanceof CapabilityIdReservedError
    ? RESERVED_ID_BUILD_ENDING
    : FAILED_BUILD_ENDING;
}

export async function runBoundedTerminalPresentation(
  send: Send,
  work: (sendWhileActive: Send) => Promise<void>,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let active = true;
  const sendWhileActive: Send = async (event, data) => {
    if (!active) return;
    await send(event, data);
  };
  const delivery = Promise.resolve().then(() => work(sendWhileActive));

  try {
    await Promise.race([
      delivery,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Terminal build presentation exceeded ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
    return true;
  } catch (error) {
    console.error(
      "Aluna terminal build presentation did not complete:",
      error instanceof Error ? error.message : error,
    );
    return false;
  } finally {
    // A timed-out in-flight write cannot be cancelled through the generic transport Promise, so
    // closing this gate stops any later commit/fragment/done write after teardown.
    active = false;
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Delivers the post-activation preview and View swap without letting a disconnected presenter
 * hold mutation ownership. Activation is already durable, so a delivery failure is observational.
 */
export async function deliverActivatedPresentation(
  send: Send,
  commitPreview: string,
  commitFragment: string,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  metricsPreview?: string,
): Promise<boolean> {
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      if (metricsPreview !== undefined) await sendWhileActive("metrics-preview", metricsPreview);
      await sendWhileActive("commit-preview", commitPreview);
      await sendWhileActive("commit", commitFragment);
      await sendWhileActive("done", "ok");
    },
    timeoutMs,
  );
}

/**
 * Presents a pre-activation failure while the build lease is held. The narration ends on the
 * failure line, and the shell holds the streamed restoration until dismissed (PLAN decision 25).
 */
export async function deliverFailedPresentation(
  send: Send,
  buildId: string,
  error: unknown,
  restorationFragment: string,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  metricsPreview?: string,
): Promise<boolean> {
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      if (metricsPreview !== undefined) await sendWhileActive("metrics-preview", metricsPreview);
      await sendWhileActive("build-error-preview", JSON.stringify(buildDemoErrorPreview(error)));
      await sendWhileActive("narration", renderBuildEnding(buildId, buildEndingFor(error)));
      await sendWhileActive("fragment", restorationFragment);
      await sendWhileActive("done", "error");
    },
    timeoutMs,
  );
}

/** Restore a non-activating terminal path without inventing a second UI event. */
export interface RestoredPresentationOptions {
  readonly metricsPreview?: string;
  readonly narration?: string;
}

export async function deliverRestoredPresentation(
  send: Send,
  restorationFragment: string,
  outcome: "ok" | "no_change" | "stale" | "cancelled",
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  options: RestoredPresentationOptions = {},
): Promise<boolean> {
  const doneOutcome = outcome === "ok" || outcome === "no_change" ? "ok" : "error";
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      if (options.metricsPreview !== undefined) {
        await sendWhileActive("metrics-preview", options.metricsPreview);
      }
      if (options.narration !== undefined) await sendWhileActive("narration", options.narration);
      await sendWhileActive("fragment", restorationFragment);
      await sendWhileActive("done", doneOutcome);
    },
    timeoutMs,
  );
}

/**
 * An evolution's two non-activating terminals, in product voice. Neither changes anything durable
 * beyond its metrics row; an accepted candidate publishes, activates and ends in `commit`.
 */
export const CANDIDATE_REJECTED_ENDING =
  "Hmm, I couldn't quite shape that change safely. Mind telling me again, a little differently?";
export const CANDIDATE_NO_CHANGE_ENDING =
  "That's already exactly how this works — nothing to change.";

/**
 * Delivers the warm rejection: the candidate preview carrying every validation issue, the line
 * the narration ends on, and the restoration the shell holds until it is dismissed.
 */
export async function deliverCandidateRejectedPresentation(
  send: Send,
  buildId: string,
  candidatePreview: string,
  restorationFragment: string,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
): Promise<boolean> {
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      await sendWhileActive("candidate-preview", candidatePreview);
      await sendWhileActive("narration", renderBuildEnding(buildId, CANDIDATE_REJECTED_ENDING));
      await sendWhileActive("fragment", restorationFragment);
      await sendWhileActive("done", "error");
    },
    timeoutMs,
  );
}

/**
 * Delivers the measured no-op: the zero-fact Diff's candidate preview, the `success/no_change`
 * row, the committed View through `fragment`, and `done=ok`. No version bumped, no unit or DDL.
 */
export async function deliverCandidateNoChangePresentation(
  send: Send,
  buildId: string,
  candidatePreview: string,
  restorationFragment: string,
  metricsPreview: string,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
): Promise<boolean> {
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      await sendWhileActive("metrics-preview", metricsPreview);
      await sendWhileActive("candidate-preview", candidatePreview);
      await sendWhileActive("narration", renderBuildEnding(buildId, CANDIDATE_NO_CHANGE_ENDING));
      await sendWhileActive("fragment", restorationFragment);
      await sendWhileActive("done", "ok");
    },
    timeoutMs,
  );
}

/**
 * The lease-head stale refusal in product voice: no catalogs, fingerprints or leases, just that
 * the world moved while Aluna was queued and their words were about the older one.
 */
export const STALE_BUILD_ENDING =
  "That changed while I was getting to it, so I stopped rather than guess. Have a look and tell me again?";

/**
 * Delivers a refused admission: the `failed/stale` row's preview, the ending line, the current
 * canonical View through `fragment` with no desk sidecar, then `done=error`.
 */
export async function deliverStalePresentation(
  send: Send,
  buildId: string,
  restorationFragment: string,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  metricsPreview?: string,
): Promise<boolean> {
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      if (metricsPreview !== undefined) await sendWhileActive("metrics-preview", metricsPreview);
      await sendWhileActive("narration", renderBuildEnding(buildId, STALE_BUILD_ENDING));
      await sendWhileActive("fragment", restorationFragment);
      await sendWhileActive("done", "error");
    },
    timeoutMs,
  );
}

/** Activation is durable; tell the user to refresh if its View could not be prepared. */
export async function deliverActivatedRecoveryPresentation(
  send: Send,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
): Promise<boolean> {
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      await sendWhileActive(
        "narration",
        "It's ready, but I couldn't show it just now. Refresh and I'll bring it back.",
      );
      await sendWhileActive("done", "error");
    },
    timeoutMs,
  );
}
