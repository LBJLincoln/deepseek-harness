/**
 * Creates a function that calls `func` with `partial` put before the arguments
 * it receives.
 *
 * Can be thought of as "freezing" some portion of a function's arguments,
 * resulting in a new function with a simplified signature.
 *
 * @param func - The function to wrap.
 * @param partial - The arguments to put before.
 * @returns A partially bound function.
 * @signature
 *    partialBind(func, ...partial);
 * @example
 *    const fn = (x: number, y: number, z: number) => x * 100 + y * 10 + z;
 *    const partialFn = partialBind(fn, 1, 2);
 *    partialFn(3); //=> 123
 *
 *    const logWithPrefix = partialBind(console.log, "[prefix]");
 *    logWithPrefix("hello"); //=> "[prefix] hello"
 * @dataFirst
 * @category Function
 * @see partialLastBind
 */
export function partialBind(func, ...partial) {
    // @ts-expect-error [ts2345, ts2322] -- TypeScript infers the generic sub-
    // types too eagerly, making itself blind to the fact that the types match
    // here.
    return (...rest) => func(...partial, ...rest);
}
