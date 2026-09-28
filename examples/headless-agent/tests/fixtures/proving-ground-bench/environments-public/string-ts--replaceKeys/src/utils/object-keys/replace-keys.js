import { replace } from "../../native/replace.js";
import { transformKeys } from "./transform-keys.js";
/**
 * A strongly typed function that shallowly transforms the keys of an object by running the `replace` method in every key. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @param lookup the lookup string to be replaced.
 * @param replacement the replacement string.
 * @returns the transformed object.
 * @example replaceKeys({ 'foo-bar': { 'fizz-buzz': true } }, 'f', 'b') // { booBar: { 'fizz-buz': true } }
 */
export function replaceKeys(obj, lookup, replacement = '') {
    throw new Error('not implemented');
}
