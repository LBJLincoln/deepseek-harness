import { typeOf } from "../../internal/internals.js";
/**
 * This function is used to shallowly transform the keys of an object.
 * It will only be transformed at runtime, so it's not type safe.
 * @param obj the object to transform.
 * @param transform the function to transform the keys from string to string.
 * @returns the transformed object.
 * @example transformKeys({ 'foo-bar': { 'fizz-buzz': true } }, camelCase)
 * // { fooBar: { 'fizz-buzz': true } }
 */
export function transformKeys(obj, transform) {
    throw new Error('not implemented');
}
