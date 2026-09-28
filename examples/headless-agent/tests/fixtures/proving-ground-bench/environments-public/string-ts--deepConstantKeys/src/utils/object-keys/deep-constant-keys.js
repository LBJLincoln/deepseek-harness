import { constantCase } from "../word-case/constant-case.js";
import { deepTransformKeys } from "./deep-transform-keys.js";
/**
 * A strongly typed function that recursively transforms the keys of an object to CONSTANT_CASE. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @returns the transformed object.
 * @example deepConstantKeys({ 'foo-bar': { 'fizz-buzz': true } }) // { FOO_BAR: { FIZZ_BUZZ: true } }
 */
export function deepConstantKeys(obj) {
    throw new Error('not implemented');
}
