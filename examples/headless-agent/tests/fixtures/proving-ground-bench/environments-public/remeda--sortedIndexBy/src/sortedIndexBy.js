import { purry } from "./purry.js";
import { binarySearchCutoffIndex } from "./internal/binarySearchCutoffIndex.js";
export function sortedIndexBy(...args) {
    throw new Error('not implemented');
}
function sortedIndexByImplementation(data, item, valueFunction) {
    const value = valueFunction(item, undefined /* index */, data);
    return binarySearchCutoffIndex(data, (pivot, index) => valueFunction(pivot, index, data) < value);
}
