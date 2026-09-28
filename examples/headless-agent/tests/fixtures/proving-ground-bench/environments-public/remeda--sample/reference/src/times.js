import { purry } from "./purry.js";
export function times(...args) {
    return purry(timesImplementation, args);
}
function timesImplementation(count, fn) {
    if (count < 1) {
        // We prefer to return trivial results on trivial inputs vs throwing errors.
        return [];
    }
    // Non-integer numbers would cause `new Array` to throw, but it makes more
    // sense to simply round them down to the nearest integer instead; but
    // rounding has some performance implications so we only do it when we have
    // to
    const length = Number.isSafeInteger(count) ? count : Math.floor(count);
    // eslint-disable-next-line unicorn/no-new-array -- This is the most efficient way to create the array, check out the benchmarks in the PR that added this comment.
    const res = new Array(length);
    for (let i = 0; i < length; i++) {
        res[i] = fn(i);
    }
    return res;
}
