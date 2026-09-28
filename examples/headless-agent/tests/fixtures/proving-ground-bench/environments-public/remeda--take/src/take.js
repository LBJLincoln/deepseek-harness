import { lazyEmptyEvaluator } from "./internal/utilityEvaluators.js";
import { purry } from "./purry.js";
export function take(...args) {
    throw new Error('not implemented');
}
const takeImplementation = (array, n) => (n < 0 ? [] : array.slice(0, n));
function lazyImplementation(n) {
    if (n <= 0) {
        return lazyEmptyEvaluator;
    }
    let remaining = n;
    return (value) => {
        remaining -= 1;
        return { done: remaining <= 0, hasNext: true, next: value };
    };
}
