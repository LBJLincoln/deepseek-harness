import { SKIP_ITEM, lazyIdentityEvaluator } from "./internal/utilityEvaluators.js";
import { purry } from "./purry.js";
export function drop(...args) {
    throw new Error('not implemented');
}
const dropImplementation = (array, n) => (n < 0 ? [...array] : array.slice(n));
function lazyImplementation(n) {
    if (n <= 0) {
        return lazyIdentityEvaluator;
    }
    let left = n;
    return (value) => {
        if (left > 0) {
            left -= 1;
            return SKIP_ITEM;
        }
        return { done: false, hasNext: true, next: value };
    };
}
