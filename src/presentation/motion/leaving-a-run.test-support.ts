import {
  LEAVING_BACK_SELECTOR,
  LEAVING_WARNING_SELECTOR,
  RUN_IN_THE_WINDOW_SELECTOR,
} from "#shell/leaving-a-run.js";

// The desk a leaving question is asked on, written as plain objects: the two suites that ask
// about leaving a run need the same window, and a second copy is a second thing to keep true.

/** One control or answer, as much of one as the rules under test actually touch. */
export function node(name: string, focused: string[]) {
  return { name, hidden: false, focus: () => focused.push(name) };
}

/**
 * A window holding one run: its subscriber, the run's own control, the question that
 * ships hidden beside it, and its two answers.
 */
export function windowWithRun(
  focused: string[],
  { ending = false, question = true, committed = false, givenBack = false } = {},
) {
  const back = node("keep going", focused);
  const warning = {
    ...node("question", focused),
    hidden: true,
    querySelector: (selector: string) => (selector === LEAVING_BACK_SELECTOR ? back : null),
  };
  const control = node("cancel", focused);
  const inside: Record<string, (ReturnType<typeof node> & { childNodes?: unknown[] }) | null> = {
    "[data-build-ending]": ending ? node("ending", focused) : null,
    ".build-stream__commit": { ...node("commit", focused), childNodes: committed ? [{}] : [] },
    ".build-stream__cancel": control,
    [LEAVING_WARNING_SELECTOR]: question ? warning : null,
  };
  const run = {
    getAttribute: () => "build-7",
    querySelector: (selector: string) => inside[selector] ?? null,
  };
  return {
    el: {
      // `givenBack` stands in for the selector's own `:not([data-preserve-active-view])`: a run
      // that handed the window back is not found by it, which a plain object cannot express.
      querySelector: (selector: string) =>
        selector === RUN_IN_THE_WINDOW_SELECTOR && !givenBack ? run : null,
    },
    run,
    control,
    warning,
    back,
  };
}
