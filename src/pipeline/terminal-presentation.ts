import type { Send } from "../sse/index.ts";
import { buildDemoErrorPreview } from "./previews.ts";

export const DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS = 2_000;

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

/** Present a pre-activation failure completely while the build lease is held. */
export async function deliverFailedPresentation(
  send: Send,
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
      await sendWhileActive("narration", "Hmm, that didn't work. Mind trying again?");
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
