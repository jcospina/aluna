import type { Send } from "../sse/index.ts";

export const DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS = 2_000;

export async function runBoundedTerminalPresentation(
  work: () => Promise<void>,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const delivery = Promise.resolve().then(work);

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
): Promise<boolean> {
  return runBoundedTerminalPresentation(async () => {
    await send("commit-preview", commitPreview);
    await send("commit", commitFragment);
    await send("done", "ok");
  }, timeoutMs);
}

/** Present a pre-activation failure completely while the build lease is held. */
export async function deliverFailedPresentation(
  send: Send,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
): Promise<boolean> {
  return runBoundedTerminalPresentation(async () => {
    await send("narration", "Hmm, that didn't work. Mind trying again?");
    await send("done", "error");
  }, timeoutMs);
}

/** Activation is durable; tell the user to refresh if its View could not be prepared. */
export async function deliverActivatedRecoveryPresentation(
  send: Send,
  timeoutMs = DEFAULT_TERMINAL_PRESENTER_TIMEOUT_MS,
): Promise<boolean> {
  return runBoundedTerminalPresentation(async () => {
    await send(
      "narration",
      "It's ready, but I couldn't show it just now. Refresh and I'll bring it back.",
    );
    await send("done", "error");
  }, timeoutMs);
}
