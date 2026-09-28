import { serializeValue } from "./serialize.js";
/**
 * Compares two values for sorting `Set` values and `Map` keys.
 *
 * Numbers are compared numerically and strings by code unit. Any other
 * combination is compared by the code unit order of the serialized values.
 *
 * @param a - The first value to compare.
 * @param b - The second value to compare.
 * @param refs - The circular reference context shared with the surrounding serialization.
 * @returns A negative number if `a` sorts before `b`, a positive number if
 *   `a` sorts after `b`, and `0` if they are equal.
 */
export function compareValues(a, b, refs) {
    throw new Error('not implemented');
}
