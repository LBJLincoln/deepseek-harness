import { purry } from "./purry.js";
export function add(...args) {
    throw new Error('not implemented');
}
// The implementation only uses `number` types, but that's just because it's
// hard to tell typescript that both value and addend would be of the same type.
const addImplementation = (value, addend) => value + addend;
