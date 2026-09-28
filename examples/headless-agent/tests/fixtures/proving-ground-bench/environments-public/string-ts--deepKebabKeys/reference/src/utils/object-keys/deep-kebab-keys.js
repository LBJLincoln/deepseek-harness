import { kebabCase } from "../word-case/kebab-case.js";
import { deepTransformKeys } from "./deep-transform-keys.js";
/**
 * A strongly typed function that recursively transforms the keys of an object to kebab-case. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @returns the transformed object.
 * @example deepKebabKeys({ 'foo-bar': { 'fizz-buzz': true } }) // { 'foo-bar': { 'fizz-buzz': true } }
 */
export function deepKebabKeys(obj) {
    return deepTransformKeys(obj, kebabCase);
}
