import { delimiterCase, } from "../word-case/delimiter-case.js";
import { transformKeys } from "./transform-keys.js";
/**
 * A strongly typed function that shallowly transforms the keys of an object to a custom delimiter case. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @param delimiter the delimiter to use.
 * @returns the transformed object.
 * @example delimiterKeys({ 'foo-bar': { 'fizz-buzz': true } }, '.') // { 'foo.bar': { 'fizz.buzz': true } }
 */
export function delimiterKeys(obj, delimiter) {
    return transformKeys(obj, (str) => delimiterCase(str, delimiter));
}
