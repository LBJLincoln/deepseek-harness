import { purry } from "./purry.js";
import { binarySearchCutoffIndex } from "./internal/binarySearchCutoffIndex.js";
export function sortedLastIndexBy(...args) {
    throw new Error('not implemented');
}
function sortedLastIndexByImplementation(array, item, valueFunction) {
    const value = valueFunction(item, undefined /* index */, array);
    return binarySearchCutoffIndex(array,
    // The only difference between the regular implementation and the "last"
    // variation is that we consider the pivot with equality too, so that we
    // skip all equal values in addition to the lower ones.
    (pivot, index) => valueFunction(pivot, index, array) <= value);
}
