import { hasAtLeast } from "./hasAtLeast.js";
import { purryOrderRules } from "./internal/purryOrderRules.js";
export function firstBy(...args) {
    throw new Error('not implemented');
}
function firstByImplementation(data, compareFn) {
    if (!hasAtLeast(data, 2)) {
        // If we have 0 or 1 item we simply return the trivial result.
        return data[0];
    }
    let [currentFirst] = data;
    // Remove the first item, we won't compare it with itself.
    const [, ...rest] = data;
    for (const item of rest) {
        if (compareFn(item, currentFirst) < 0) {
            // item comes before currentFirst in the order.
            currentFirst = item;
        }
    }
    return currentFirst;
}
