import { purry } from "./purry.js";
export function subtract(...args) {
    throw new Error('not implemented');
}
// The implementation only uses `number` types, but that's just because it's
// hard to tell typescript that both value and subtrahend would be of the same
// type.
const subtractImplementation = (value, subtrahend) => value - subtrahend;
