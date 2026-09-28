import { pipe } from "../pipe.js";
/**
 * A version of `purry` for cases where the only meaningful implementation is a
 * lazy one. This is useful for functions that don't have a built-in
 * implementation already, and that can't be optimized to take advantage of
 * having the complete array upfront.
 *
 * Under the hood the function uses `pipe` to utilize it's built-in lazy logic
 * and wraps the pipe with the required invocations to allow using the function
 * outside of pipes too.
 *
 * @param lazy - The main lazy implementation, it assumes that data is an
 * iterable (array-like).
 * @param args - The arguments passed to the overloaded invocation.
 * @see purry
 * @see pipe
 */
export function purryFromLazy(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
lazy, args) {
    throw new Error('not implemented');
}
