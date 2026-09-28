import { identity } from "../../function/identity.js";
import { range } from "../../math/range.js";
import { isArrayLike } from "../predicate/isArrayLike.js";
import { iteratee as iterateeToolkit } from "../util/iteratee.js";
export function map(collection, _iteratee = identity) {
    if (!collection) {
        return [];
    }
    const keys = isArrayLike(collection) ? range(0, collection.length) : Object.keys(collection);
    const iteratee = iterateeToolkit(_iteratee);
    const result = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = collection[key];
        result[i] = iteratee(value, key, collection);
    }
    return result;
}
