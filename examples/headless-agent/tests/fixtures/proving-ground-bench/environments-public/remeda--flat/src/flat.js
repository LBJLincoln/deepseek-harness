import { lazyDataLastImpl } from "./internal/lazyDataLastImpl.js";
import { lazyIdentityEvaluator } from "./internal/utilityEvaluators.js";
export function flat(dataOrDepth, depth) {
    throw new Error('not implemented');
}
const flatImplementation = (data, depth) => (depth === undefined ? data.flat() : data.flat(depth));
const lazyImplementation = (depth) => depth === undefined || depth === 1
    ? lazyShallow
    : depth <= 0
        ? lazyIdentityEvaluator
        : (value) => Array.isArray(value)
            ? {
                next: value.flat(depth - 1),
                hasNext: true,
                hasMany: true,
                done: false,
            }
            : { next: value, hasNext: true, done: false };
// This function is pulled out so that we don't generate a new arrow function
// each time. Because it doesn't need to run with recursion it could be pulled
// out from the lazyImplementation and be reused for all invocations.
const lazyShallow = (value) => Array.isArray(value)
    ? { next: value, hasNext: true, hasMany: true, done: false }
    : { next: value, hasNext: true, done: false };
