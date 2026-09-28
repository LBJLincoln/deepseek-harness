import { purry } from "./purry.js";
export function mapToObj(...args) {
    throw new Error('not implemented');
}
function mapToObjImplementation(array, fn) {
    const out = {};
    for (const [index, element] of array.entries()) {
        const [key, value] = fn(element, index, array);
        out[key] = value;
    }
    return out;
}
