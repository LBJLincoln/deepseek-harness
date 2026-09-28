import { purry } from "./purry.js";
export function divide(...args) {
    throw new Error('not implemented');
}
// The implementation only uses `number` types, but that's just because it's
// hard to tell typescript that both value and divisor would be of the same
// type.
const divideImplementation = (value, divisor) => value / divisor;
