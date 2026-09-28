import { purry } from "./purry.js";
export function isStrictEqual(...args) {
    throw new Error('not implemented');
}
const isStrictlyEqualImplementation = (data, other) => data === other || Object.is(data, other);
