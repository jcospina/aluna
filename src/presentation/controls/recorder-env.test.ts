// The page's question before leaving, shared by every recorder on it (`design/scripts/recorder-env.js`).

import { afterEach, beforeEach, expect, test } from "bun:test";
import { browserRecorderEnv } from "#design/recorder-env.js";

let bound: string[] = [];
const had = { add: globalThis.addEventListener, remove: globalThis.removeEventListener };

beforeEach(() => {
  bound = [];
  globalThis.addEventListener = ((type: string) => bound.push(`+${type}`)) as never;
  globalThis.removeEventListener = ((type: string) => bound.push(`-${type}`)) as never;
});

afterEach(() => {
  globalThis.addEventListener = had.add;
  globalThis.removeEventListener = had.remove;
});

test("stays asked while any recorder holds audio, and goes once the last lets it go", () => {
  const { guardLeave } = browserRecorderEnv();
  const one = {};
  const other = {};
  guardLeave(one, true);
  guardLeave(other, true);
  guardLeave(other, false);
  guardLeave(other, false);
  expect(bound).toEqual(["+beforeunload"]);
  guardLeave(one, true);
  guardLeave(one, false);
  expect(bound).toEqual(["+beforeunload", "-beforeunload"]);
});
