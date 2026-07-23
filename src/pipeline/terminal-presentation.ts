import type { Send } from "../sse/index.ts";
import { escapeHtml } from "../web/html.ts";
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
  const persistentNotice = `<div id="prompt-notice" hx-swap-oob="innerHTML">${escapeHtml(FAILED_BUILD_NOTICE)}</div>`;
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

// Module 4.6/01 — the evolution-candidate trace's two terminal outcomes, in
// product voice with zero internals (ARCH §9.7). The trace changes nothing
// durable either way: the developer preview carries the accepted candidate or
// the total rejection, and the displaced View is restored beneath the notice.
export const CANDIDATE_ACCEPTED_NOTICE =
  "Here's how I'd shape that change — take a look whenever you're ready.";
export const CANDIDATE_REJECTED_NOTICE =
  "Hmm, I couldn't quite shape that change safely. Mind telling me again, a little differently?";
export const CANDIDATE_NO_CHANGE_NOTICE =
  "That's already exactly how this works — nothing to change.";

/**
 * Deliver an evolution-candidate trace outcome: the developer-panel candidate
 * preview, one warm narration line (kept visible as the persistent prompt
 * notice), and the restored View. `done=ok` only for an accepted candidate.
 */
export async function deliverCandidateOutcomePresentation(
  send: Send,
  candidatePreview: string,
  restorationFragment: string,
  outcome: "accepted" | "rejected",
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
): Promise<boolean> {
  const notice = outcome === "accepted" ? CANDIDATE_ACCEPTED_NOTICE : CANDIDATE_REJECTED_NOTICE;
  const persistentNotice = `<div id="prompt-notice" hx-swap-oob="innerHTML">${escapeHtml(notice)}</div>`;
  return runBoundedTerminalPresentation(
    send,
    async (sendWhileActive) => {
      await sendWhileActive("candidate-preview", candidatePreview);
      await sendWhileActive("narration", notice);
      await sendWhileActive("fragment", `${restorationFragment}\n${persistentNotice}`);
      await sendWhileActive("done", outcome === "accepted" ? "ok" : "error");
    },
    timeoutMs,
  );
}

/**
 * Deliver the measured no-op (decision 37): the developer-panel candidate preview
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
  const persistentNotice = `<div id="prompt-notice" hx-swap-oob="innerHTML">${escapeHtml(CANDIDATE_NO_CHANGE_NOTICE)}</div>`;
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
