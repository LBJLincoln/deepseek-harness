import { camelCase } from "../word-case/camel-case.js";
import { transformKeys } from "./transform-keys.js";
/**
 * A strongly typed function that shallowly transforms the keys of an object to camelCase. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @returns the transformed object.
 * @example camelKeys({ 'foo-bar': { 'fizz-buzz': true } }) // { fooBar: { 'fizz-buz': true } }
 */
export function camelKeys(obj) {
    throw new Error('not implemented');
}
