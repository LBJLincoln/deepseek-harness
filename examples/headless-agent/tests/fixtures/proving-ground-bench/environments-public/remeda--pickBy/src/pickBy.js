import { purry } from "./purry.js";
export function pickBy(...args) {
    throw new Error('not implemented');
}
function pickByImplementation(data, predicate) {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        if (predicate(value, key, data)) {
            out[key] = value;
        }
    }
    return out;
}
