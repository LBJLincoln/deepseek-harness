import { delimiterCase, } from "../word-case/delimiter-case.js";
import { deepTransformKeys } from "./deep-transform-keys.js";
/**
 * A strongly typed function that recursively transforms the keys of an object to a custom delimiter case. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @param delimiter the delimiter to use.
 * @returns the transformed object.
 * @example deepDelimiterKeys({ 'foo-bar': { 'fizz-buzz': true } }, '.') // { 'foo.bar': { 'fizz.buzz': true } }
 */
export function deepDelimiterKeys(obj, delimiter) {
    return deepTransformKeys(obj, (str) => delimiterCase(str, delimiter));
}
