import { purry } from "./purry.js";
export function hasProp(...args) {
    return purry(hasPropImplementation, args);
}
function hasPropImplementation(data, key) {
    return Object.hasOwn(data, key);
}
