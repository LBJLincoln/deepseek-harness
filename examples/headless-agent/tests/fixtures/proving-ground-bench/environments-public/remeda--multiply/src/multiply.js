import { purry } from "./purry.js";
export function multiply(...args) {
    throw new Error('not implemented');
}
// The implementation only uses `number` types, but that's just because it's
// hard to tell typescript that both value and multiplicand would be of the same
// type.
const multiplyImplementation = (value, multiplicand) => value * multiplicand;
