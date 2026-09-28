import { purry } from "./purry.js";
export function findLast(...args) {
    throw new Error('not implemented');
}
const findLastImplementation = (data, predicate) => {
    // TODO [>2]: When node 18 reaches end-of-life bump target lib to ES2023+ and use `Array.prototype.findLast` here.
    for (let i = data.length - 1; i >= 0; i--) {
        const item = data[i];
        if (predicate(item, i, data)) {
            return item;
        }
    }
    return undefined;
};
