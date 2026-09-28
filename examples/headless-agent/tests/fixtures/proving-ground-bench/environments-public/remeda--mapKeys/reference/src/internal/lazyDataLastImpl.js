/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Use this helper function to build the data last implementation together with
 * a lazy implementation. Use this when you need to build your own purrying
 * logic when you want to decide between dataFirst and dataLast on something
 * that isn't the number of arguments provided. This is useful for implementing
 * functions with optional or variadic arguments.
 */
export function lazyDataLastImpl(fn, args, lazy) {
    // @ts-expect-error [ts2345] -- This error is accurate because we don't know
    // anything about `fn` so can't ensure that we are passing the correct
    // arguments to it, we just have to trust that the caller knows what they are
    // doing.
    const dataLast = (data) => fn(data, ...args);
    return lazy === undefined
        ? dataLast
        : Object.assign(dataLast, { lazy, lazyArgs: args });
}
