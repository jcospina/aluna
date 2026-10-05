// The tab's history as the desk sees it, played rather than recorded: one run of entries, a push
// dropping every Forward, and a `go` that moves the bar only when the test lets it arrive, as a
// `popstate`, so what happens between the asking and the arriving can be played too.

/** One entry: the address it names and the state written with it. */
export interface Entry {
  readonly url: string;
  readonly state: unknown;
}

/**
 * A bar standing on `pathname`, its first entry unmarked as a page load leaves it. `arrive` hears
 * every traversal once the bar has moved, as `window.onpopstate` would.
 */
export function tabHistory(pathname: string, arrive: (event: { state: unknown }) => void) {
  const entries: Entry[] = [{ url: pathname, state: null }];
  let at = 0;
  const location = { pathname, search: "" };
  const land = (index: number, entry: Entry) => {
    entries[index] = entry;
    location.pathname = entry.url;
  };
  const traversals: number[] = [];
  const went: number[] = [];
  const history = {
    get state() {
      return entries[at]?.state;
    },
    pushState(state: unknown, _unused: string, url: string) {
      entries.splice(at + 1);
      at += 1;
      land(at, { url, state });
    },
    replaceState(state: unknown, _unused: string, url: string) {
      land(at, { url, state });
    },
    go(delta: number) {
      went.push(delta);
      traversals.push(delta);
    },
  };
  /** The oldest traversal asked for, arrived; one the run has no entry for goes nowhere. */
  const arriveOne = () => {
    const delta = traversals.shift() ?? 0;
    const entry = entries[at + delta];
    if (entry === undefined) return;
    at += delta;
    location.pathname = entry.url;
    arrive({ state: entry.state });
  };
  /** Each traversal asked for, the ones asked for while arriving included, in order. */
  const arrived = async () => {
    await Promise.resolve();
    while (traversals.length > 0) arriveOne();
  };
  return {
    location,
    history,
    /** Every entry's address, in order, and which one the bar is on. */
    entries: () => entries.map(({ url }) => url),
    at: () => at,
    /** The state the entry the bar is on carries. */
    state: () => entries[at]?.state as Record<string, unknown> | null,
    /** Every traversal asked for so far, arrived. */
    arrived,
    /** The traversals asked for and not yet arrived. */
    pending: () => [...traversals],
    /** Every `go` asked for, in order: a `go(0)` is a reload in a browser. */
    went: () => [...went],
    arriveOne,
    /** The person pressing Back or Forward. */
    travel(delta: number) {
      history.go(delta);
      return arrived();
    },
  };
}
