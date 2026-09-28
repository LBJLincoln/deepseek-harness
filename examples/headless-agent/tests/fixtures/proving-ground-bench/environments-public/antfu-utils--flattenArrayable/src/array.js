import { clamp } from "./math.js";
/**
 * Convert `Arrayable<T>` to `Array<T>`
 *
 * @category Array
 */
export function toArray(array) {
    array = array ?? [];
    return Array.isArray(array) ? array : [array];
}
/**
 * Convert `Arrayable<T>` to `Array<T>` and flatten it
 *
 * @category Array
 */
export function flattenArrayable(array) {
    throw new Error('not implemented');
}
/**
 * Use rest arguments to merge arrays
 *
 * @category Array
 */
export function mergeArrayable(...args) {
    return args.flatMap(i => toArray(i));
}
export function partition(array, ...filters) {
    const result = Array.from({ length: filters.length + 1 }).fill(null).map(() => []);
    array.forEach((e, idx, arr) => {
        let i = 0;
        for (const filter of filters) {
            if (filter(e, idx, arr)) {
                result[i].push(e);
                return;
            }
            i += 1;
        }
        result[i].push(e);
    });
    return result;
}
/**
 * Unique an Array
 *
 * @category Array
 */
export function uniq(array) {
    return Array.from(new Set(array));
}
/**
 * Unique an Array by a custom equality function
 *
 * @category Array
 */
export function uniqueBy(array, equalFn) {
    return array.reduce((acc, cur) => {
        const index = acc.findIndex((item) => equalFn(cur, item));
        if (index === -1)
            acc.push(cur);
        return acc;
    }, []);
}
export function last(array) {
    return at(array, -1);
}
/**
 * Remove an item from Array
 *
 * @category Array
 */
export function remove(array, value) {
    if (!array)
        return false;
    const index = array.indexOf(value);
    if (index >= 0) {
        array.splice(index, 1);
        return true;
    }
    return false;
}
export function at(array, index) {
    const len = array.length;
    if (!len)
        return undefined;
    if (index < 0)
        index += len;
    return array[index];
}
export function range(...args) {
    let start, stop, step;
    if (args.length === 1) {
        start = 0;
        step = 1;
        ([stop] = args);
    }
    else {
        ([start, stop, step = 1] = args);
    }
    const arr = [];
    let current = start;
    while (current < stop) {
        arr.push(current);
        current += step || 1;
    }
    return arr;
}
/**
 * Move element in an Array
 *
 * @category Array
 * @param arr
 * @param from
 * @param to
 */
export function move(arr, from, to) {
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    return arr;
}
/**
 * Clamp a number to the index range of an array
 *
 * @category Array
 */
export function clampArrayRange(n, arr) {
    return clamp(n, 0, arr.length - 1);
}
/**
 * Get random item(s) from an array
 *
 * @param arr
 * @param quantity - quantity of random items which will be returned
 */
export function sample(arr, quantity) {
    return Array.from({ length: quantity }, _ => arr[Math.round(Math.random() * (arr.length - 1))]);
}
/**
 * Shuffle an array. This function mutates the array.
 *
 * @category Array
 */
export function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
// https://jsbenchmark.com/#eyJjYXNlcyI6W3siaWQiOiJXR01CMEJLVXgwbUJDYVc3NmFHSVciLCJjb2RlIjoibGV0IGEgPSBEQVRBXG5hID0gZmlsdGVyKGEsIGkgPT4gaSAlIDUwID09PSAwKVxuYSA9IGZpbHRlcihhLCBpID0-IGkgJSAxMCA9PT0gMClcbmEgPSBmaWx0ZXIoYSwgaSA9PiBpICUgMiA9PT0gMCkiLCJuYW1lIjoiZmlsdGVyIiwiZGVwZW5kZW5jaWVzIjpbXX0seyJpZCI6Ik9VSnozNU1QTkdhWVZ2eVo3S3A1UiIsImNvZGUiOiJsZXQgYSA9IERBVEFcbmEgPSBmaWx0ZXJJblBsYWNlKGEsIGkgPT4gaSAlIDUwID09PSAwKVxuYSA9IGZpbHRlckluUGxhY2UoYSwgaSA9PiBpICUgMTAgPT09IDApXG5hID0gZmlsdGVySW5QbGFjZShhLCBpID0-IGkgJSAyID09PSAwKSIsIm5hbWUiOiJmaWx0ZXJJblBsYWNlIiwiZGVwZW5kZW5jaWVzIjpbXX1dLCJjb25maWciOnsibmFtZSI6IkJhc2ljIGV4YW1wbGUiLCJwYXJhbGxlbCI6dHJ1ZSwiZ2xvYmFsVGVzdENvbmZpZyI6eyJkZXBlbmRlbmNpZXMiOltdfSwiZGF0YUNvZGUiOiJnbG9iYWxUaGlzLmZpbHRlciA9IGZ1bmN0aW9uIGZpbHRlcihkYXRhLCBwcmVkaWNhdGUpIHtcbiAgcmV0dXJuIGRhdGEuZmlsdGVyKHByZWRpY2F0ZSlcbn1cblxuZ2xvYmFsVGhpcy5maWx0ZXJJblBsYWNlID0gZnVuY3Rpb24gZmlsdGVySW5QbGFjZShkYXRhLCBwcmVkaWNhdGUpIHtcbiAgZm9yIChsZXQgaSA9IGRhdGEubGVuZ3RoOyBpLS07IGk-PTApIHtcbiAgICBpZiAoIXByZWRpY2F0ZShkYXRhW2ldLCBpLCBkYXRhKSlcbiAgICAgIGRhdGEuc3BsaWNlKGksIDEpXG4gIH1cbiAgcmV0dXJuIGRhdGFcbn1cblxucmV0dXJuIFsuLi5BcnJheSgxMDAwKS5rZXlzKCksLi4uQXJyYXkoMTAwMCkua2V5cygpLC4uLkFycmF5KDEwMDApLmtleXMoKV0ifX0
/**
 * Filter out items from an array in place.
 * This function mutates the array.
 * `predicate` get through the array from the end to the start for performance.
 *
 * Expect this function to be faster than using `Array.prototype.filter` on large arrays.
 *
 * @category Array
 */
export function filterInPlace(array, predicate) {
    for (let i = array.length; i--; i >= 0) {
        if (!predicate(array[i], i, array))
            array.splice(i, 1);
    }
    return array;
}
