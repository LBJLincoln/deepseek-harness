import { snakeCase } from "../word-case/snake-case.js";
import { deepTransformKeys } from "./deep-transform-keys.js";
/**
 * A strongly typed function that recursively transforms the keys of an object to snake_case. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @returns the transformed object.
 * @example deepSnakeKeys({ 'foo-bar': { 'fizz-buzz': true } }) // { 'foo_bar': { 'fizz_buzz': true } }
 */
export function deepSnakeKeys(obj) {
    return deepTransformKeys(obj, snakeCase);
}
