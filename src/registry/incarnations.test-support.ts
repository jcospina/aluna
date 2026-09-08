// The fixture incarnation ids, written down once.
//
// Every suite that stands a capability up needs one, and a few need several that must differ.
// They were retyped in thirty-one files, digit for digit, under a validator that rejects a
// malformed one — so the shape lives here and the tests name the one they want.

export const FIRST_INCARNATION_ID = "11111111-1111-4111-8111-111111111111";
export const SECOND_INCARNATION_ID = "22222222-2222-4222-8222-222222222222";
export const THIRD_INCARNATION_ID = "33333333-3333-4333-8333-333333333333";
export const FOURTH_INCARNATION_ID = "44444444-4444-4444-8444-444444444444";
export const FIFTH_INCARNATION_ID = "55555555-5555-4555-8555-555555555555";
export const SIXTH_INCARNATION_ID = "66666666-6666-4666-8666-666666666666";
export const SEVENTH_INCARNATION_ID = "77777777-7777-4777-8777-777777777777";
export const EIGHTH_INCARNATION_ID = "88888888-8888-4888-8888-888888888888";

/** The one nothing was ever built for: an address that resolves to no incarnation at all. */
export const UNKNOWN_INCARNATION_ID = "99999999-9999-4999-8999-999999999999";
