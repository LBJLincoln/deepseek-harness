import { pascalCase } from "../word-case/pascal-case.js";
import { transformKeys } from "./transform-keys.js";
/**
 * A strongly typed function that shallowly transforms the keys of an object to pascal case. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @returns the transformed object.
 * @example pascalKeys({ 'foo-bar': { 'fizz-buzz': true } }) // { FooBar: { 'fizz-buzz': true } }
 */
export function pascalKeys(obj) {
    return transformKeys(obj, pascalCase);
}
