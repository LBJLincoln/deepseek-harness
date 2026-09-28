/* eslint-disable @typescript-eslint/no-explicit-any --
 * function inference is stricter and doesn't work well when the arguments
 * aren't typed as `any` in the generic type declaration.
 */
export function when(...args) {
    throw new Error('not implemented');
}
const whenImplementation = (data, predicate, onTrueOrBranches, ...extraArgs) => predicate(data, ...extraArgs)
    ? typeof onTrueOrBranches === "function"
        ? onTrueOrBranches(data, ...extraArgs)
        : onTrueOrBranches.onTrue(data, ...extraArgs)
    : typeof onTrueOrBranches === "function"
        ? data
        : onTrueOrBranches.onFalse(data, ...extraArgs);
