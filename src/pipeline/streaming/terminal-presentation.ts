import type { Send } from "../../sse/index.ts";
import { renderPromptNotice } from "../../web/fragments.ts";
import { buildDemoErrorPreview } from "./previews.ts";

export const DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS = 2_000;

/** The product-voice failure line: narrated live, and left behind as the notice. */
export const FAILED_BUILD_NOTICE = "Hmm, that didn't work. Mind trying again?";

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
    // A timed-out in-flight write cannot be forcibly cancelled through the generic
    // transport Promise, but it must never unlock the rest of the terminal sequence.
    // Closing this gate prevents any later commit/fragment/done write after teardown.
    active = false;
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Deliver the post-activation developer preview and complete View swap without
 * letting a disconnected presenter hold mutation ownership indefinitely.
 * Activation is already durable, so delivery timeout/failure is observational.
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
 * Present a pre-activation failure completely while the build lease is held.
 * The narration is transient — terminal promotion replaces the subscriber with the
 * restored View — so the same product-voice line also rides the fragment as an
 * out-of-band `#prompt-notice` swap and stays visible after the View is restored.
 */
export async function deliverFailedPresentation(
  send: Send,
  error: unknown,
  restorationFragment: string,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  metricsPreview?: string,
): Promise<boolean> {
  const persistentNotice = renderPromptNotice(FAILED_BUILD_NOTICE);
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      if (metricsPreview !== undefined) await sendWhileActive("metrics-preview", metricsPreview);
      await sendWhileActive("build-error-preview", JSON.stringify(buildDemoErrorPreview(error)));
      await sendWhileActive("narration", FAILED_BUILD_NOTICE);
      await sendWhileActive("fragment", `${restorationFragment}\n${persistentNotice}`);
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
 * An evolution's two non-activating terminal outcomes, in product voice
 * with zero internals. Neither changes anything durable beyond its own
 * metrics row: the developer preview carries the total rejection or the zero-fact Diff,
 * and the displaced View is restored beneath the notice. An accepted candidate is no
 * longer a terminal shape of its own — an accepted
 * candidate goes on to publish and activate, and ends in `commit`.
 */
export const CANDIDATE_REJECTED_NOTICE =
  "Hmm, I couldn't quite shape that change safely. Mind telling me again, a little differently?";
export const CANDIDATE_NO_CHANGE_NOTICE =
  "That's already exactly how this works — nothing to change.";

/**
 * Deliver the warm rejection: the developer-panel candidate preview carrying every
 * validation issue, one warm narration line (kept visible as the persistent prompt
 * notice), and the restored View.
 */
export async function deliverCandidateRejectedPresentation(
  send: Send,
  candidatePreview: string,
  restorationFragment: string,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
): Promise<boolean> {
  const persistentNotice = renderPromptNotice(CANDIDATE_REJECTED_NOTICE);
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      await sendWhileActive("candidate-preview", candidatePreview);
      await sendWhileActive("narration", CANDIDATE_REJECTED_NOTICE);
      await sendWhileActive("fragment", `${restorationFragment}\n${persistentNotice}`);
      await sendWhileActive("done", "error");
    },
    timeoutMs,
  );
}

/**
 * Deliver the measured no-op: the developer-panel candidate preview
 * carrying the zero-fact Diff, the `success/no_change` metrics row's preview, one
 * warm narration line kept as the persistent prompt notice, the committed View
 * restored through `fragment`, and a warm `done=ok`. No version bumped, no unit or
 * DDL work ran — the candidate was semantically identical.
 */
export async function deliverCandidateNoChangePresentation(
  send: Send,
  candidatePreview: string,
  restorationFragment: string,
  metricsPreview: string,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
): Promise<boolean> {
  const persistentNotice = renderPromptNotice(CANDIDATE_NO_CHANGE_NOTICE);
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      await sendWhileActive("metrics-preview", metricsPreview);
      await sendWhileActive("candidate-preview", candidatePreview);
      await sendWhileActive("narration", CANDIDATE_NO_CHANGE_NOTICE);
      await sendWhileActive("fragment", `${restorationFragment}\n${persistentNotice}`);
      await sendWhileActive("done", "ok");
    },
    timeoutMs,
  );
}

/**
 * The lease-head stale refusal, in product voice with zero internals.
 * The user is not told about catalogs, fingerprints, incarnations or leases; they are told
 * the true thing, which is that the world moved while Aluna was queued and their words were
 * about the older one. Nothing durable changed except this build's own refusal row.
 */
export const STALE_BUILD_NOTICE =
  "That changed while I was getting to it, so I stopped rather than guess. Have a look and tell me again?";

/**
 * Deliver a refused admission: the direct `failed/stale` row's metrics preview, one warm
 * narration line kept visible as the persistent prompt notice, the then-current canonical
 * View restored through `fragment` with no toolbar sidecar, and `done=error`. No provider
 * work ran and no product state moved, so there is nothing else to say.
 */
export async function deliverStalePresentation(
  send: Send,
  restorationFragment: string,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
  metricsPreview?: string,
): Promise<boolean> {
  const persistentNotice = renderPromptNotice(STALE_BUILD_NOTICE);
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      if (metricsPreview !== undefined) await sendWhileActive("metrics-preview", metricsPreview);
      await sendWhileActive("narration", STALE_BUILD_NOTICE);
      await sendWhileActive("fragment", `${restorationFragment}\n${persistentNotice}`);
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
