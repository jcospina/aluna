// Which incarnations have a logo attempt running *in this process*, right now.
//
// Two questions need the same answer, and neither can be read from the registry row:
//
//   - **Is this `generating` row interrupted?** Recovery has to tell a claim whose
//     process died from one that is three seconds into a ninety-second drawing. The
//     durable row looks identical in both cases, and a timestamp would only turn the
//     question into a guess about how slow a service is allowed to be. In-process
//     bookkeeping answers it exactly: a claim nothing here is holding is a claim nobody
//     is running, because the only code that can hold one runs here.
//   - **What is a claim loser waiting for?** ADR-0007 gives a loser a bounded observation
//     of the winner and forbids a polling loop. The winner's own completion is already a
//     promise; handing it to the loser is the observation, with no interval, no scheduler
//     and nothing for a client to repeat.
//
// The set is per-app rather than a module global, so a test can hold its own and two apps
// in one process cannot see each other's attempts.

import type { CapabilityIncarnation } from "../runtime/concurrency/read-gates.ts";

/** One running attempt, from before its claim is asked for until after it is finalized. */
export interface LogoClaimTicket {
  /** The claim was won: this attempt owns the incarnation's `generating` row. */
  claimed(): void;
  /** The attempt is over, whatever it did. Safe to call twice. */
  end(): void;
}

export interface RunningLogoClaims {
  /**
   * Start tracking an attempt. Called **before** the claim is asked for: between the
   * claim's commit and its registration there would otherwise be a window in which a
   * concurrent desk load's recovery reads a `generating` row nobody appears to hold.
   */
  begin(incarnation: CapabilityIncarnation): LogoClaimTicket;
  /**
   * Whether any attempt for this incarnation is running here, won or still asking.
   * Deliberately the wider question: a loser is in flight for microseconds, and treating
   * its incarnation as busy only defers recovery to the next desk load, which is the safe
   * direction. Answering the narrow question would put the winner's registration back in
   * the race this exists to close.
   */
  isAttempting(incarnation: CapabilityIncarnation): boolean;
  /**
   * Wait for the attempt that *won* this incarnation's claim, for at most `timeoutMs`, or
   * until `abandoned` says the client that asked has gone.
   *
   * Resolves true when the winner finished inside the bound, false when there was no
   * winner to observe, the bound ran out, or nobody is listening any more. Never rejects:
   * a loser reports the row as it then stands either way.
   */
  awaitWinner(
    incarnation: CapabilityIncarnation,
    timeoutMs: number,
    abandoned?: AbortSignal,
  ): Promise<boolean>;
}

interface TrackedAttempt {
  claimed: boolean;
  readonly finished: Promise<void>;
  finish(): void;
}

function key(incarnation: CapabilityIncarnation): string {
  return `${incarnation.capabilityId} ${incarnation.incarnationId}`;
}

export function createRunningLogoClaims(): RunningLogoClaims {
  const running = new Map<string, Set<TrackedAttempt>>();

  const forget = (id: string, attempt: TrackedAttempt): void => {
    const attempts = running.get(id);
    if (!attempts?.delete(attempt)) return;
    if (attempts.size === 0) running.delete(id);
  };

  return {
    begin(incarnation) {
      const id = key(incarnation);
      let finish = (): void => {};
      const attempt: TrackedAttempt = {
        claimed: false,
        finished: new Promise<void>((resolve) => {
          finish = resolve;
        }),
        finish: () => {
          finish();
        },
      };
      const attempts = running.get(id) ?? new Set<TrackedAttempt>();
      attempts.add(attempt);
      running.set(id, attempts);
      return {
        claimed: () => {
          attempt.claimed = true;
        },
        end: () => {
          // Woken before it is forgotten, so a loser awaiting this exact attempt sees the
          // finished row rather than an entry that vanished without a word.
          attempt.finish();
          forget(id, attempt);
        },
      };
    },

    isAttempting(incarnation) {
      return (running.get(key(incarnation))?.size ?? 0) > 0;
    },

    async awaitWinner(incarnation, timeoutMs, abandoned) {
      const winner = [...(running.get(key(incarnation)) ?? [])].find((attempt) => attempt.claimed);
      if (!winner || abandoned?.aborted) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let giveUp = (): void => {};
      const stopped = new Promise<false>((resolve) => {
        giveUp = () => {
          resolve(false);
        };
        timer = setTimeout(giveUp, timeoutMs);
      });
      // A drawing takes most of a minute, and a reader who navigated away is not going to
      // see the tile it produces. Without this, every reload during one winner's call
      // leaves a minute-and-a-half timer and a pinned handler behind it.
      abandoned?.addEventListener("abort", giveUp, { once: true });
      try {
        return await Promise.race([winner.finished.then(() => true), stopped]);
      } finally {
        // The bound limits waiting, never how long the process lives: a winner that
        // finishes first must not leave a timer holding the event loop open.
        clearTimeout(timer);
        abandoned?.removeEventListener("abort", giveUp);
      }
    },
  };
}
