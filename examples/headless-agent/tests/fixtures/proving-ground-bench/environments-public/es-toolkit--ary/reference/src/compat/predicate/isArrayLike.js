import { isLength } from "../../predicate/isLength.js";
/**
 * Checks if `value` is array-like.
 *
 * @param value The value to check.
 * @returns Returns `true` if `value` is array-like, else `false`.
 *
 * @example
 * isArrayLike([1, 2, 3]); // true
 * isArrayLike('abc'); // true
 * isArrayLike({ 0: 'a', length: 1 }); // true
 * isArrayLike({}); // false
 * isArrayLike(null); // false
 * isArrayLike(undefined); // false
 */
export function isArrayLike(value) {
    return value != null && typeof value !== 'function' && isLength(value.length);
}
