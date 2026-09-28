/**
 * Creates a new array filled with the specified value from the start position up to, but not including, the end position.
 * This function does not mutate the original array.
 *
 * @template T - The type of elements in the original array.
 * @template U - The type of the value to fill the new array with.
 * @param arr - The array to base the new array on.
 * @param value - The value to fill the new array with.
 * @param [start=0] - The start position. Defaults to 0.
 * @param [end=arr.length] - The end position. Defaults to the array's length.
 * @returns The new array with the filled values.
 */
export function toFilled(arr, value, start = 0, end = arr.length) {
    throw new Error('not implemented');
}
