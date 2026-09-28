import { notNullish } from "./guards.js";
import { isObject, isPrimitive } from "./is.js";
import { randomStr } from "./string.js";
/**
 * Map key/value pairs for an object, and construct a new one
 *
 *
 * @category Object
 *
 * Transform:
 * @example
 * ```
 * objectMap({ a: 1, b: 2 }, (k, v) => [k.toString().toUpperCase(), v.toString()])
 * // { A: '1', B: '2' }
 * ```
 *
 * Swap key/value:
 * @example
 * ```
 * objectMap({ a: 1, b: 2 }, (k, v) => [v, k])
 * // { 1: 'a', 2: 'b' }
 * ```
 *
 * Filter keys:
 * @example
 * ```
 * objectMap({ a: 1, b: 2 }, (k, v) => k === 'a' ? undefined : [k, v])
 * // { b: 2 }
 * ```
 */
export function objectMap(obj, fn) {
    return Object.fromEntries(Object.entries(obj)
        .map(([k, v]) => fn(k, v))
        .filter(notNullish));
}
/**
 * Type guard for any key, `k`.
 * Marks `k` as a key of `T` if `k` is in `obj`.
 *
 * @category Object
 * @param obj object to query for key `k`
 * @param k key to check existence in `obj`
 */
export function isKeyOf(obj, k) {
    return k in obj;
}
/**
 * Strict typed `Object.keys`
 *
 * @category Object
 */
export function objectKeys(obj) {
    throw new Error('not implemented');
}
/**
 * Strict typed `Object.entries`
 *
 * @category Object
 */
export function objectEntries(obj) {
    return Object.entries(obj);
}
/**
 * Deep merge
 *
 * The first argument is the target object, the rest are the sources.
 * The target object will be mutated and returned.
 *
 * @category Object
 */
export function deepMerge(target, ...sources) {
    if (!sources.length)
        return target;
    const source = sources.shift();
    if (source === undefined)
        return target;
    if (isMergableObject(target) && isMergableObject(source)) {
        objectKeys(source).forEach((key) => {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype')
                return;
            // @ts-expect-error
            if (isMergableObject(source[key])) {
                // @ts-expect-error
                if (!target[key])
                    // @ts-expect-error
                    target[key] = {};
                // @ts-expect-error
                if (isMergableObject(target[key])) {
                    deepMerge(target[key], source[key]);
                }
                else {
                    // @ts-expect-error
                    target[key] = source[key];
                }
            }
            else {
                // @ts-expect-error
                target[key] = source[key];
            }
        });
    }
    return deepMerge(target, ...sources);
}
/**
 * Deep merge
 *
 * Differs from `deepMerge` in that it merges arrays instead of overriding them.
 *
 * The first argument is the target object, the rest are the sources.
 * The target object will be mutated and returned.
 *
 * @category Object
 */
export function deepMergeWithArray(target, ...sources) {
    if (!sources.length)
        return target;
    const source = sources.shift();
    if (source === undefined)
        return target;
    if (Array.isArray(target) && Array.isArray(source))
        target.push(...source);
    if (isMergableObject(target) && isMergableObject(source)) {
        objectKeys(source).forEach((key) => {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype')
                return;
            // @ts-expect-error
            if (Array.isArray(source[key])) {
                // @ts-expect-error
                if (!target[key])
                    // @ts-expect-error
                    target[key] = [];
                // @ts-expect-error
                deepMergeWithArray(target[key], source[key]);
            }
            // @ts-expect-error
            else if (isMergableObject(source[key])) {
                // @ts-expect-error
                if (!target[key])
                    // @ts-expect-error
                    target[key] = {};
                // @ts-expect-error
                deepMergeWithArray(target[key], source[key]);
            }
            else {
                // @ts-expect-error
                target[key] = source[key];
            }
        });
    }
    return deepMergeWithArray(target, ...sources);
}
function isMergableObject(item) {
    return isObject(item) && !Array.isArray(item);
}
/**
 * Create a new subset object by giving keys
 *
 * @category Object
 */
export function objectPick(obj, keys, omitUndefined = false) {
    return keys.reduce((n, k) => {
        if (k in obj) {
            if (!omitUndefined || obj[k] !== undefined)
                n[k] = obj[k];
        }
        return n;
    }, {});
}
/**
 * Create a new subset object by omit giving keys
 *
 * @category Object
 */
export function objectOmit(obj, keys, omitUndefined = false) {
    return Object.fromEntries(Object.entries(obj).filter(([key, value]) => {
        return (!omitUndefined || value !== undefined) && !keys.includes(key);
    }));
}
/**
 * Clear undefined fields from an object. It mutates the object
 *
 * @category Object
 */
export function clearUndefined(obj) {
    // @ts-expect-error
    Object.keys(obj).forEach((key) => (obj[key] === undefined ? delete obj[key] : {}));
    return obj;
}
/**
 * Determines whether an object has a property with the specified name
 *
 * @see https://eslint.org/docs/rules/no-prototype-builtins
 * @category Object
 */
export function hasOwnProperty(obj, v) {
    if (obj == null)
        return false;
    return Object.prototype.hasOwnProperty.call(obj, v);
}
const _objectIdMap = /* @__PURE__ */ new WeakMap();
/**
 * Get an object's unique identifier
 *
 * Same object will always return the same id
 *
 * Expect argument to be a non-primitive object/array. Primitive values will be returned as is.
 *
 * @category Object
 */
export function objectId(obj) {
    if (isPrimitive(obj))
        return obj;
    if (!_objectIdMap.has(obj)) {
        _objectIdMap.set(obj, randomStr());
    }
    return _objectIdMap.get(obj);
}
