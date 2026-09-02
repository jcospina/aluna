// How much of a search the platform admits, stated once for both sides of it.
//
// The generated search shape is mandated (`builder/units/unit-prompts.ts`): split `q` on
// whitespace into one CTE row per term, then call the FFI `platform_search_normalize` on
// every (row × term × field) combination. `bun:sqlite` runs that synchronously, so the work
// happens *on the event loop* — the 10s handler deadline cannot fire, because its timer
// callback cannot run while the query is on the stack. Measured at 500 rows: 100 terms took
// 2.7s, 1,000 took 55.5s, 5,000 took 256.5s. The whole server is stopped for that long, and
// cost is linear in rows and in field text length, which `max_length` allows up to 10,000.
//
// The *key* of a search parameter was validated and its value never was. These are the
// value's bounds: the wire protocol refuses past them, and the search control carries the
// same length as a `maxlength` so a person is stopped where they can see why. Both sit far
// above anything typed into a search field and far below anything that costs measurable
// time.

export const MAX_SEARCH_QUERY_LENGTH = 512;
export const MAX_SEARCH_TERMS = 16;
