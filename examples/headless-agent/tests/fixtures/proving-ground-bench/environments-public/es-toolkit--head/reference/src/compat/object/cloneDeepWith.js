import { cloneDeepWith as cloneDeepWithToolkit } from "../../object/cloneDeepWith.js";
import { copyProperties } from "../../object/cloneDeepWith.js";
import { getTag } from "../_internal/getTag.js";
import { argumentsTag, booleanTag, numberTag, objectTag, stringTag } from "../_internal/tags.js";
/**
 * Creates a deep clone of the given object using a customizer function.
 *
 * @template T - The type of the object.
 * @param obj - The object to clone.
 * @param [cloneValue] - A function to customize the cloning process.
 * @returns A deep clone of the given object.
 *
 * @example
 * // Clone a primitive value
 * const num = 29;
 * const clonedNum = cloneDeepWith(num);
 * console.log(clonedNum); // 29
 * console.log(clonedNum === num); // true
 *
 * @example
 * // Clone an object with a customizer
 * const obj = { a: 1, b: 2 };
 * const clonedObj = cloneDeepWith(obj, (value) => {
 *   if (typeof value === 'number') {
 *     return value * 2; // Double the number
 *   }
 * });
 * console.log(clonedObj); // { a: 2, b: 4 }
 * console.log(clonedObj === obj); // false
 *
 * @example
 * // Clone an array with a customizer
 * const arr = [1, 2, 3];
 * const clonedArr = cloneDeepWith(arr, (value) => {
 *   if (typeof value === 'number') {
 *     return value + 1; // Increment each number
 *   }
 * });
 * console.log(clonedArr); // [2, 3, 4]
 * console.log(clonedArr === arr); // false
 */
export function cloneDeepWith(obj, customizer) {
    return cloneDeepWithToolkit(obj, (value, key, object, stack) => {
        const cloned = customizer?.(value, key, object, stack);
        if (cloned !== undefined) {
            return cloned;
        }
        if (typeof obj !== 'object') {
            return undefined;
        }
        // eslint-disable-next-line
        // @ts-ignore
        if (getTag(obj) === objectTag && typeof obj.constructor !== 'function') {
            const result = {};
            stack.set(obj, result);
            copyProperties(result, obj, object, stack);
            return result;
        }
        switch (Object.prototype.toString.call(obj)) {
            case numberTag:
            case stringTag:
            case booleanTag: {
                // eslint-disable-next-line
                // @ts-ignore
                const result = new obj.constructor(obj?.valueOf());
                copyProperties(result, obj);
                return result;
            }
            case argumentsTag: {
                const result = {};
                copyProperties(result, obj);
                // eslint-disable-next-line
                // @ts-ignore
                result.length = obj.length;
                // eslint-disable-next-line
                // @ts-ignore
                result[Symbol.iterator] = obj[Symbol.iterator];
                return result;
            }
            default: {
                return undefined;
            }
        }
    });
}
