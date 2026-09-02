import { describe, expect, test } from "bun:test";

import { createRunningLogoClaims } from "./claims.ts";

const NOTES = { capabilityId: "notes", incarnationId: "11111111-1111-4111-8111-111111111111" };
const REBUILT = { capabilityId: "notes", incarnationId: "22222222-2222-4222-8222-222222222222" };
const RECIPES = { capabilityId: "recipes", incarnationId: NOTES.incarnationId };

describe("what recovery asks", () => {
  test("nothing is running until an attempt begins, and nothing after it ends", () => {
    const claims = createRunningLogoClaims();
    expect(claims.isAttempting(NOTES)).toBe(false);

    const ticket = claims.begin(NOTES);
    expect(claims.isAttempting(NOTES)).toBe(true);

    ticket.end();
    expect(claims.isAttempting(NOTES)).toBe(false);
  });

  // The question is asked before the claim is won, because the window between winning one
  // and registering it is exactly where a concurrent recovery would release a paid call's
  // row. An attempt still asking therefore counts.
  test("an attempt that has not won its claim yet still counts as running", () => {
    const claims = createRunningLogoClaims();
    claims.begin(NOTES);

    expect(claims.isAttempting(NOTES)).toBe(true);
  });

  test("is bound to the exact incarnation, not the capability id", () => {
    const claims = createRunningLogoClaims();
    claims.begin(NOTES);

    // A delete-and-rebuild is a different lifetime owing its own artwork, and a different
    // capability that happens to share an incarnation string is not this one either.
    expect(claims.isAttempting(REBUILT)).toBe(false);
    expect(claims.isAttempting(RECIPES)).toBe(false);
  });

  test("two attempts on one incarnation both have to end before it is quiet", () => {
    const claims = createRunningLogoClaims();
    const winner = claims.begin(NOTES);
    const loser = claims.begin(NOTES);

    loser.end();
    expect(claims.isAttempting(NOTES)).toBe(true);

    winner.end();
    expect(claims.isAttempting(NOTES)).toBe(false);
  });
});

describe("what a claim loser waits on", () => {
  test("the winner's own completion, resolved the moment it finishes", async () => {
    const claims = createRunningLogoClaims();
    const winner = claims.begin(NOTES);
    winner.claimed();

    const observing = claims.awaitWinner(NOTES, 5_000);
    winner.end();

    expect(await observing).toBe(true);
  });

  test("nothing at all when no attempt won the claim", async () => {
    const claims = createRunningLogoClaims();
    // Present, abandoned, deleted, no key: every other reason an attempt goes unclaimed
    // has no winner to watch, and the tile must answer at once.
    expect(await claims.awaitWinner(NOTES, 60_000)).toBe(false);

    // An attempt still asking for its claim is not a winner either.
    claims.begin(NOTES);
    expect(await claims.awaitWinner(NOTES, 60_000)).toBe(false);
  });

  test("gives up at the bound rather than following the winner however long it runs", async () => {
    const claims = createRunningLogoClaims();
    const winner = claims.begin(NOTES);
    winner.claimed();

    expect(await claims.awaitWinner(NOTES, 5)).toBe(false);

    winner.end();
  });

  test("waits for the winner, never for a loser that has already given up", async () => {
    const claims = createRunningLogoClaims();
    const winner = claims.begin(NOTES);
    winner.claimed();
    const loser = claims.begin(NOTES);
    loser.end();

    const observing = claims.awaitWinner(NOTES, 5_000);
    winner.end();

    expect(await observing).toBe(true);
  });
});

describe("a reader who went away", () => {
  test("stops the observation rather than holding a minute-and-a-half timer for nobody", async () => {
    const claims = createRunningLogoClaims();
    const winner = claims.begin(NOTES);
    winner.claimed();
    const gone = new AbortController();

    const observing = claims.awaitWinner(NOTES, 95_000, gone.signal);
    gone.abort();

    expect(await observing).toBe(false);
    winner.end();
  });

  test("a client already gone is never waited for at all", async () => {
    const claims = createRunningLogoClaims();
    const winner = claims.begin(NOTES);
    winner.claimed();

    expect(await claims.awaitWinner(NOTES, 95_000, AbortSignal.abort())).toBe(false);
    winner.end();
  });
});
