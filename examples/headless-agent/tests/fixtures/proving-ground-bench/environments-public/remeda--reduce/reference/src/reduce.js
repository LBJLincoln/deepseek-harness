import { purry } from "./purry.js";
export function reduce(...args) {
    return purry(reduceImplementation, args);
}
const reduceImplementation = (data, callbackfn, initialValue) =>
// eslint-disable-next-line unicorn/no-array-reduce -- Our function wraps the built-in reduce.
data.reduce(callbackfn, initialValue);
