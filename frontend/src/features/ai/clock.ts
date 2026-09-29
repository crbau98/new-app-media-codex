/** Indirection over the wall clock so hooks can read "now" inside memoised computations. */
export const clock = { now: (): number => Date.now() }
