/**
 * A function that returns the first argument passed to it.
 *
 * Notice that this is a dataLast impl where the function needs to be invoked
 * to get the "do nothing" function.
 *
 * See also:
 * * `doNothing` - A function that doesn't return anything.
 * * `constant` - A function that ignores the input arguments and returns the same value on every invocation.
 *
 * @signature
 *    identity();
 * @example
 *    map([1,2,3], identity()); // => [1,2,3]
 * @category Function
 */
export function identity() {
    throw new Error('not implemented');
}
const identityImplementation = (firstParameter) => firstParameter;
