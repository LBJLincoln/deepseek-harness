import { typeOf } from "../../internal/internals.js";
/**
 * This function is used to transform the keys of an object deeply.
 * It will only be transformed at runtime, so it's not type safe.
 * @param obj the object to transform.
 * @param transform the function to transform the keys from string to string.
 * @returns the transformed object.
 * @example deepTransformKeys({ 'foo-bar': { 'fizz-buzz': true } }, camelCase)
 * // { fooBar: { fizzBuzz: true } }
 */
export function deepTransformKeys(obj, transform) {
    throw new Error('not implemented');
}
