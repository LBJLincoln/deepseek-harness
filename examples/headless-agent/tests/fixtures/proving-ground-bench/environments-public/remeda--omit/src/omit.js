import { hasAtLeast } from "./hasAtLeast.js";
import { purry } from "./purry.js";
export function omit(...args) {
    throw new Error('not implemented');
}
function omitImplementation(data, keys) {
    if (!hasAtLeast(keys, 1)) {
        // No props to omit at all!
        // @ts-expect-error [ts2322] - TypeScript can't connect the fact that the
        // keys array is empty and infer the expected output, and then infer that we
        // return it correctly here.
        return { ...data };
    }
    if (!hasAtLeast(keys, 2)) {
        // Only one prop to omit so we can let the runtime engine deal with
        // removing it efficiently.
        const { [keys[0]]: _omitted, ...remaining } = data;
        // @ts-expect-error [ts2322] - TypeScript can't compute the expected output
        // correctly and then infer that we return it correctly here.
        return remaining;
    }
    // Multiple props to omit so we have to use a loop to omit all of them.
    const out = { ...data };
    for (const key of keys) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- This is intentional! It is the most effective way to allow the runtime engine to optimize the object without creating excessive copies for every omitted key.
        delete out[key];
    }
    // @ts-expect-error [ts2322] - The type is too complex and TypeScript can't
    // "follow" the iterative algorithm to ensure the output makes sense.
    return out;
}
