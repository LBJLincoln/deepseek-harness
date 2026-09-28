import { purry } from "./purry.js";
export function hasProp(...args) {
    throw new Error('not implemented');
}
function hasPropImplementation(data, key) {
    return Object.hasOwn(data, key);
}
