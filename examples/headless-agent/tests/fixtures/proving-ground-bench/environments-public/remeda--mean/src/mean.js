import { purry } from "./purry.js";
import { sum } from "./sum.js";
export function mean(...args) {
    throw new Error('not implemented');
}
function meanImplementation(data) {
    if (data.length === 0) {
        return undefined;
    }
    return sum(data) / data.length;
}
