import { purry } from "./purry.js";
import { sum } from "./sum.js";
export function mean(...args) {
    return purry(meanImplementation, args);
}
function meanImplementation(data) {
    if (data.length === 0) {
        return undefined;
    }
    return sum(data) / data.length;
}
