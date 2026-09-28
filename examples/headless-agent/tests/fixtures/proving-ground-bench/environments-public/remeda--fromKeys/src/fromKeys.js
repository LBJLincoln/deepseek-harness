import { purry } from "./purry.js";
export function fromKeys(...args) {
    throw new Error('not implemented');
}
function fromKeysImplementation(data, mapper) {
    const result = {};
    for (const [index, key] of data.entries()) {
        // @ts-expect-error [ts7053] - There's no easy way to make Typescript aware that the items in T would be keys in the output object because it's type is built recursively and the "being an item of an array" property of a type is not "carried over" in the recursive type definition.
        result[key] = mapper(key, index, data);
    }
    return result;
}
