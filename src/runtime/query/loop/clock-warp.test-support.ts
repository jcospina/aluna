// A harness that makes every clock this process can reach jump forward on demand.
//
// It exists so "no wall-clock deadline" can be pinned by behaviour rather than by grepping for
// the names a deadline might be spelled with. A deadline has to read a clock, whichever clock
// it reads and whichever file it lives in, so moving every clock forward by years and watching
// the work finish anyway is the pin a string sweep cannot be. This module is not run as a test
// by bun.

/**
 * Make every reachable clock jump forward on demand, so a deadline built from any of them fires.
 * The non-configurable `Bun.nanoseconds` is left to the source sweep; `warped` names what moved.
 */
export function warpClocks() {
  const RealDate = globalThis.Date;
  const realNow = RealDate.now;
  const realPerformanceNow = performance.now.bind(performance);
  const realHrtime = process.hrtime;
  const start = realNow();
  let warp = 0;
  const at = () => start + warp;

  class WarpedDate extends RealDate {
    constructor(...args: readonly unknown[]) {
      // A bare `new Date()` is the reading a deadline takes; every other form is left alone,
      // so anything parsing or formatting a stored timestamp still behaves normally.
      if (args.length === 0) super(at());
      else super(...(args as [number]));
    }
    static override now(): number {
      return at();
    }
  }

  globalThis.Date = WarpedDate as unknown as DateConstructor;
  RealDate.now = at;
  performance.now = () => warp;
  const warped = ["new Date()", "Date.now", "performance.now"];
  let restoreHrtime: (() => void) | undefined;
  try {
    Object.defineProperty(process, "hrtime", {
      value: Object.assign(() => [Math.floor(warp / 1000), 0] as [number, number], {
        bigint: () => BigInt(warp) * 1_000_000n,
      }),
      configurable: true,
    });
    warped.push("process.hrtime");
    restoreHrtime = () => {
      Object.defineProperty(process, "hrtime", { value: realHrtime, configurable: true });
    };
  } catch {
    restoreHrtime = undefined;
  }

  return {
    /** A year per read, so ten reads land a decade past any deadline anyone would write. */
    YEAR_MS: 365 * 24 * 60 * 60 * 1000,
    warped,
    advance: (ms: number) => {
      warp += ms;
    },
    elapsed: () => {
      // Read through the constructor rather than `Date.now`, because the constructor is the
      // half a deadline usually reaches for and the half a harness is likeliest to forget.
      const constructed = new Date();
      return constructed.valueOf() - start;
    },
    restore: () => {
      globalThis.Date = RealDate;
      RealDate.now = realNow;
      performance.now = realPerformanceNow;
      restoreHrtime?.();
    },
  };
}
