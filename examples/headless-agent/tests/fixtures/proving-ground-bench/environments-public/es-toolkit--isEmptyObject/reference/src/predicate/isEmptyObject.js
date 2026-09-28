import { isPlainObject } from "./isPlainObject.js";
/**
 * Checks if a value is an empty plain object.
 *
 * @param value - The value to check.
 * @returns True if the value is an empty plain object, otherwise false.
 *
 * @example
 * isEmptyObject({}); // true
 * isEmptyObject({ a: 1 }); // false
 * isEmptyObject([]); // false
 * isEmptyObject(null); // false
 */
export function isEmptyObject(value) {
    return isPlainObject(value) && Object.keys(value).length === 0;
}
