import { camelCase } from "../word-case/camel-case.js";
import { deepTransformKeys } from "./deep-transform-keys.js";
/**
 * A strongly typed function that recursively transforms the keys of an object to camelCase. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @returns the transformed object.
 * @example deepCamelKeys({ 'foo-bar': { 'fizz-buzz': true } }) // { fooBar: { fizzBuzz: true } }
 */
export function deepCamelKeys(obj) {
    return deepTransformKeys(obj, camelCase);
}
