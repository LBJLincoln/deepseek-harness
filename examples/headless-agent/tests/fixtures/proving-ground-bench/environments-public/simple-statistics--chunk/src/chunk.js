/**
 * Split an array into chunks of a specified size. This function
 * has the same behavior as [PHP's array_chunk](http://php.net/manual/en/function.array-chunk.php)
 * function, and thus will insert smaller-sized chunks at the end if
 * the input size is not divisible by the chunk size.
 *
 * `x` is expected to be an array, and `chunkSize` a number.
 * The `x` array can contain any kind of data.
 *
 * @param {Array} x a sample
 * @param {number} chunkSize size of each output array. must be a positive integer
 * @returns {Array<Array>} a chunked array
 * @throws {Error} if chunk size is less than 1 or not an integer
 * @example
 * chunk([1, 2, 3, 4, 5, 6], 2);
 * // => [[1, 2], [3, 4], [5, 6]]
 */
function chunk(x, chunkSize) {
    throw new Error('not implemented');
}
export default chunk;
