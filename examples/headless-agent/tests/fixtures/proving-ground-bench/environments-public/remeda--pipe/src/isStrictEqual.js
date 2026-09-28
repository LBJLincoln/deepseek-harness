import { purry } from "./purry.js";
export function isStrictEqual(...args) {
    return purry(isStrictlyEqualImplementation, args);
}
const isStrictlyEqualImplementation = (data, other) => data === other || Object.is(data, other);
