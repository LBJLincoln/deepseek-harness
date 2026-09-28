import sign from "./sign.js";
/**
 * [Bisection method](https://en.wikipedia.org/wiki/Bisection_method) is a root-finding
 * method that repeatedly bisects an interval to find the root.
 *
 * This function returns a numerical approximation to the exact value.
 *
 * @param {Function} func input function
 * @param {number} start - start of interval
 * @param {number} end - end of interval
 * @param {number} maxIterations - the maximum number of iterations
 * @param {number} errorTolerance - the error tolerance
 * @returns {number} estimated root value
 * @throws {TypeError} Argument func must be a function
 *
 * @example
 * bisect(Math.cos,0,4,100,0.003); // => 1.572265625
 */
function bisect(func, start, end, maxIterations, errorTolerance) {
    throw new Error('not implemented');
}
export default bisect;
