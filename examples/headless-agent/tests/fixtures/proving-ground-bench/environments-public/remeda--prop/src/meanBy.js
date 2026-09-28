import { purry } from "./purry.js";
export function meanBy(...args) {
    return purry(meanByImplementation, args);
}
const meanByImplementation = (array, fn) => {
    if (array.length === 0) {
        return NaN;
    }
    let sum = 0;
    for (const [index, item] of array.entries()) {
        sum += fn(item, index, array);
    }
    return sum / array.length;
};
