import { toString } from "./base.js";
export const isDef = (val) => typeof val !== 'undefined';
export const isBoolean = (val) => typeof val === 'boolean';
// eslint-disable-next-line ts/no-unsafe-function-type
export const isFunction = (val) => typeof val === 'function';
export const isNumber = (val) => typeof val === 'number';
export const isString = (val) => typeof val === 'string';
export const isObject = (val) => toString(val) === '[object Object]';
export const isUndefined = (val) => toString(val) === '[object Undefined]';
export const isNull = (val) => toString(val) === '[object Null]';
export const isRegExp = (val) => toString(val) === '[object RegExp]';
export const isDate = (val) => toString(val) === '[object Date]';
/**
 * Check if a value is primitive
 */
export function isPrimitive(val) {
    throw new Error('not implemented');
}
// @ts-expect-error
export const isWindow = (val) => typeof window !== 'undefined' && toString(val) === '[object Window]';
// @ts-expect-error
export const isBrowser = typeof window !== 'undefined';
