import { purryFromLazy } from "./internal/purryFromLazy.js";
import { SKIP_ITEM, lazyIdentityEvaluator } from "./internal/utilityEvaluators.js";
export function difference(...args) {
    throw new Error('not implemented');
}
function lazyImplementation(other) {
    if (other.length === 0) {
        return lazyIdentityEvaluator;
    }
    // We need to build a more efficient data structure that would allow us to
    // keep track of the number of times we've seen a value in the other array.
    const remaining = new Map();
    for (const value of other) {
        remaining.set(value, (remaining.get(value) ?? 0) + 1);
    }
    return (value) => {
        const copies = remaining.get(value);
        if (copies === undefined || copies === 0) {
            // The item is either not part of the other array or we've dropped enough
            // copies of it so we return it.
            return { done: false, hasNext: true, next: value };
        }
        // The item is equal to an item in the other array and there are still
        // copies of it to "account" for so we skip this one and remove it from our
        // ongoing tally.
        remaining.set(value, copies - 1);
        return SKIP_ITEM;
    };
}
