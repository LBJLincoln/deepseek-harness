import { snakeCase } from "../word-case/snake-case.js";
import { transformKeys } from "./transform-keys.js";
/**
 * A strongly typed function that shallowly the keys of an object to snake_case. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @returns the transformed object.
 * @example snakeKeys({ 'foo-bar': { 'fizz-buzz': true } }) // { 'foo_bar': { 'fizz-buzz': true } }
 */
export function snakeKeys(obj) {
    throw new Error('not implemented');
}
