import { purryFromLazy } from "./internal/purryFromLazy.js";
import { SKIP_ITEM, lazyEmptyEvaluator } from "./internal/utilityEvaluators.js";
export function intersection(...args) {
    return purryFromLazy(lazyImplementation, args);
}
function lazyImplementation(other) {
    if (other.length === 0) {
        return lazyEmptyEvaluator;
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
            // The item is either not part of the other array or we've "used" enough
            // copies of it so we skip the remaining values.
            return SKIP_ITEM;
        }
        // The item is equal to an item in the other array and there are still
        // copies of it to "account" for so we return this one and remove it from
        // our ongoing tally.
        if (copies === 1) {
            remaining.delete(value);
        }
        else {
            remaining.set(value, copies - 1);
        }
        return {
            hasNext: true,
            // We can safely cast here because if value was in the `remaining` map, it
            // has to be of type S (that's just how we built it).
            next: value,
            // We can stop the iteration if the remaining map is empty.
            done: remaining.size === 0,
        };
    };
}
