import { purry } from "./purry.js";
export function invert(...args) {
    return purry(invertImplementation, args);
}
function invertImplementation(data) {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        result[value] = key;
    }
    return result;
}
