/**
 * Creates a function that calls `func` with `partial` put after the arguments
 * it receives. Note that this doesn't support functions with both optional
 * and rest parameters.
 *
 * Can be thought of as "freezing" some portion of a function's arguments,
 * resulting in a new function with a simplified signature.
 *
 * Useful for converting a data-first function to a data-last one.
 *
 * @param func - The function to wrap.
 * @param partial - The arguments to put after.
 * @returns A partially bound function.
 * @signature
 *    partialLastBind(func, ...partial);
 * @example
 *    const fn = (x: number, y: number, z: number) => x * 100 + y * 10 + z;
 *    const partialFn = partialLastBind(fn, 2, 3);
 *    partialFn(1); //=> 123
 *
 *    const parseBinary = partialLastBind(parseInt, "2");
 *    parseBinary("101"); //=> 5
 *
 *    pipe(
 *      { a: 1 },
 *      // instead of (arg) => JSON.stringify(arg, null, 2)
 *      partialLastBind(JSON.stringify, null, 2),
 *    ); //=> '{\n  "a": 1\n}'
 * @dataFirst
 * @category Function
 * @see partialBind
 */
export function partialLastBind(func, ...partial) {
    throw new Error('not implemented');
}
