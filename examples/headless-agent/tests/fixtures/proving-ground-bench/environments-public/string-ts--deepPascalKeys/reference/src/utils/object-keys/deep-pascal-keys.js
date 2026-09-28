import { pascalCase } from "../word-case/pascal-case.js";
import { deepTransformKeys } from "./deep-transform-keys.js";
/**
 * A strongly typed function that recursively transforms the keys of an object to pascal case. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @returns the transformed object.
 * @example deepPascalKeys({ 'foo-bar': { 'fizz-buzz': true } }) // { FooBar: { FizzBuzz: true } }
 */
export function deepPascalKeys(obj) {
    return deepTransformKeys(obj, pascalCase);
}
