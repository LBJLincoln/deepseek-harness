import { isPlainObject } from "./isPlainObject.js";
import { purry } from "./purry.js";
export function mergeDeep(...args) {
    return purry(mergeDeepImplementation, args);
}
function mergeDeepImplementation(destination, source) {
    // At this point the output is already merged, simply not deeply merged.
    const output = { ...destination, ...source };
    // now just scan the output and look for values that should have been deep-
    // merged
    for (const key in source) {
        if (!Object.hasOwn(destination, key)) {
            // They don't share this key.
            continue;
        }
        if (!isPlainObject(
        // @ts-expect-error [ts2536] -- TypeScript isn't narrowing `key` although we checked that it exists in both objects, so it can't see this access is valid.
        destination[key])) {
            // The value in destination is not a mergeable object so the value from
            // source (which was already copied in the shallow merge) would be used
            // as-is.
            continue;
        }
        if (!isPlainObject(source[key])) {
            // The value in source is not a mergeable object either, so it will
            // override the object in destination.
            continue;
        }
        // Both destination and source have a mergeable object for this key, so we
        // recursively merge them.
        output[key] = mergeDeepImplementation(
        // @ts-expect-error [ts2536] - We build the output object iteratively, I don't think it's possible to improve the types here so that typescript infers this correctly.
        destination[key], source[key]);
    }
    // @ts-expect-error [ts2322] - We build the output object iteratively, I don't think it's possible to improve the types here so that typescript infers this correctly.
    return output;
}
