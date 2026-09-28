import { constantCase } from "../word-case/constant-case.js";
import { transformKeys } from "./transform-keys.js";
/**
 * A strongly typed function that shallowly transforms the keys of an object to CONSTANT_CASE. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @returns the transformed object.
 * @example constantKeys({ 'foo-bar': { 'fizz-buzz': true } }) // { FOO_BAR: { 'fizz-buzz': true } }
 */
export function constantKeys(obj) {
    return transformKeys(obj, constantCase);
}
