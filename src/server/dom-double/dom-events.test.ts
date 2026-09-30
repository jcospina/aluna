import { describe, expect, test } from "bun:test";
import { Listeners } from "./dom-events.test-support.ts";

describe("a listener added with a signal", () => {
  const run = () => {};

  test("is not added once the signal has aborted, and goes when it aborts", () => {
    const listeners = new Listeners();
    listeners.add("click", run, { signal: AbortSignal.abort() });
    expect(listeners.count("click")).toBe(0);
    const stop = new AbortController();
    listeners.add("click", run, { signal: stop.signal });
    stop.abort();
    expect(listeners.count("click")).toBe(0);
  });

  test("takes only its own registration with it, not one added again after its removal", () => {
    const listeners = new Listeners();
    const stop = new AbortController();
    listeners.add("click", run, { signal: stop.signal });
    listeners.remove("click", run);
    listeners.add("click", run);
    stop.abort();
    expect(listeners.count("click")).toBe(1);
  });
});
