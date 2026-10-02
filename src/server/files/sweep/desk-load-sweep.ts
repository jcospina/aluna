// The desk-load sweep (Module 7 PLAN decision 32; ADR-0009). A reload destroys any open form, so
// every key still `pending` when the desk loads is an orphan. The sweep takes its place in the
// coordinator's queue as the load arrives, and that place is the cutoff: an upload recorded after
// the load queues behind it and is never taken. The render does not wait for it. A load that finds
// no key pending queues nothing. A later load takes over a sweep still last in the queue, and
// takes everything that sweep would have; one with anything queued behind it keeps its place.

import { errorDetail } from "../../../platform/errors.ts";
import { enqueueAllPendingFiles, hasPendingFile } from "../../../platform/files/store/ledger.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import {
  type MutationCoordinator,
  MutationReservationCancelledError,
} from "../../../runtime/concurrency/mutation-coordinator.ts";

export interface DeskLoadSweepDeps {
  readonly databases: PlatformDatabase;
  readonly mutationCoordinator: MutationCoordinator;
  /** Told once a sweep that moved a key has committed. */
  readonly wakeFileCleanup: () => void;
}

/**
 * Whether `request` is the browser loading a page into a tab, which destroys the forms that tab
 * held. An image, a prefetch, a prerender, a HEAD or a request from outside a browser is not.
 */
export function isPageNavigation(request: Request): boolean {
  const { headers } = request;
  return (
    request.method === "GET" &&
    headers.get("sec-fetch-mode") === "navigate" &&
    headers.get("sec-fetch-dest") === "document" &&
    !headers.has("sec-purpose")
  );
}

/** The ticket queued last on `coordinator`, if any is queued. */
function lastQueued(coordinator: MutationCoordinator): string | undefined {
  return coordinator.snapshot().queuedTickets.at(-1)?.ticketId;
}

interface WaitingSweep {
  readonly admission: AbortController;
  readonly ticket: string | undefined;
}

/** Gives up `waiting`'s place when nothing has queued behind it since. */
function takeOver(waiting: WaitingSweep | null, coordinator: MutationCoordinator): void {
  if (waiting?.ticket !== undefined && waiting.ticket === lastQueued(coordinator)) {
    waiting.admission.abort();
  }
}

function logFailure(error: unknown): void {
  if (error instanceof MutationReservationCancelledError) return;
  console.error("omni-crud could not sweep pending uploads on desk load:", errorDetail(error));
}

/**
 * A sweep per call that finds a key pending, queued before the call returns. The promise settles
 * once that sweep committed or a later one took it over; a failure is logged, never thrown.
 */
export function createDeskLoadSweep(deps: DeskLoadSweepDeps): () => Promise<void> {
  const coordinator = deps.mutationCoordinator;
  let waiting: WaitingSweep | null = null;
  return async () => {
    try {
      if (!hasPendingFile(deps.databases.readonly)) return;
      takeOver(waiting, coordinator);
      const admission = new AbortController();
      const sweep = coordinator.withPlatformWrite(
        () => enqueueAllPendingFiles(deps.databases.readwrite),
        { signal: admission.signal },
      );
      // Queued last, or admitted at once with nothing queued behind it, which leaves no ticket.
      waiting = { admission, ticket: lastQueued(coordinator) };
      if ((await sweep) > 0) deps.wakeFileCleanup();
    } catch (error) {
      logFailure(error);
    }
  };
}
