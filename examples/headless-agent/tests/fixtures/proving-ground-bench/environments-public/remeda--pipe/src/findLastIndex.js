import { purry } from "./purry.js";
export function findLastIndex(...args) {
    return purry(findLastIndexImplementation, args);
}
const findLastIndexImplementation = (data, predicate) => {
    // TODO [>2]: When node 18 reaches end-of-life bump target lib to ES2023+ and use `Array.prototype.findLastIndex` here.
    for (let i = data.length - 1; i >= 0; i--) {
        if (predicate(data[i], i, data)) {
            return i;
        }
    }
    return -1;
};
