import { serializeValue } from "./serialize.js";
import { serializeString } from "./serializeString.js";
/**
 * Serializes the own enumerable string-keyed properties of an object
 * into a `{'key':value}` string.
 *
 * Keys are sorted by code unit so that the output does not depend on
 * property insertion order, and always quoted so that a key containing
 * `:` or `,` cannot be confused with the surrounding structure. Symbol
 * keys and non-enumerable properties are ignored.
 *
 * @param object - The object to serialize.
 * @param refs - The circular reference context shared with the surrounding serialization.
 * @returns The serialized string.
 *
 * @example
 * serializePlainObject({ b: 2, a: 1 }, new Map()); // "{'a':1,'b':2}"
 */
export function serializePlainObject(object, refs) {
    throw new Error('not implemented');
}
