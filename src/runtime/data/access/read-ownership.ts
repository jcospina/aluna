// The one ownership check both halves of the injected toolbox share.
//
// A Handler can outlive the request that admitted it: the read gate can cancel it
// mid-flight for a deletion, and the router can abandon it at its execution deadline.
// In both cases the route has already returned, its read tokens are released, and its
// transaction is committed or rolled back — so any *later* port call from that orphaned
// Handler would run outside the boundary that authorised it. The query port would read a
// capability that may already be gone; the mutation port would write outside the
// transaction entirely, autocommitting.
//
// Generated code never receives the token or the signal. It observes cancellation only
// as a thrown error from the port it tried to use.

/** Throw if the read ownership this port was built under has ended. */
export function assertReadOwnership(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("The capability read was cancelled.", "AbortError");
}
