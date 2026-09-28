import { kebabCase } from "../word-case/kebab-case.js";
import { transformKeys } from "./transform-keys.js";
/**
 * A strongly typed function that shallowly transforms the keys of an object to kebab-case. The transformation is done both at runtime and type level.
 * @param obj the object to transform.
 * @returns the transformed object.
 * @example kebabKeys({ fooBar: { fizzBuzz: true } }) // { 'foo-bar': { fizzBuzz: true } }
 */
export function kebabKeys(obj) {
    throw new Error('not implemented');
}
