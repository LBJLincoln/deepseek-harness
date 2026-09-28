/* eslint-disable @typescript-eslint/no-explicit-any --
 * function inference is stricter and doesn't work well when the arguments
 * aren't typed as `any` in the generic type declaration.
 */
export function when(...args) {
    return args.length === 2
        ? (data, ...extraArgs) =>
        // @ts-expect-error [ts2556] -- This is OK, we trust our typing of the overloaded functions
        whenImplementation(data, ...args, ...extraArgs)
        : // @ts-expect-error [ts2556] -- This is OK, we trust our typing of the overloaded functions
            whenImplementation(...args);
}
const whenImplementation = (data, predicate, onTrueOrBranches, ...extraArgs) => predicate(data, ...extraArgs)
    ? typeof onTrueOrBranches === "function"
        ? onTrueOrBranches(data, ...extraArgs)
        : onTrueOrBranches.onTrue(data, ...extraArgs)
    : typeof onTrueOrBranches === "function"
        ? data
        : onTrueOrBranches.onFalse(data, ...extraArgs);
