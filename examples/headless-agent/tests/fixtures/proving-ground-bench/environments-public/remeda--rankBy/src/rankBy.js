import { purryOrderRulesWithArgument, } from "./internal/purryOrderRules.js";
export function rankBy(...args) {
    throw new Error('not implemented');
}
function rankByImplementation(data, compareFn, targetItem) {
    let rank = 0;
    for (const item of data) {
        if (compareFn(targetItem, item) > 0) {
            // The rank of the item is equivalent to the number of items that would
            // come before it if the array was sorted. We assume that the
            rank += 1;
        }
    }
    return rank;
}
