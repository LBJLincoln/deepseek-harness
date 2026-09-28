import { purry } from "./purry.js";
import { binarySearchCutoffIndex } from "./internal/binarySearchCutoffIndex.js";
export function sortedIndex(...args) {
    throw new Error('not implemented');
}
const sortedIndexImplementation = (array, item) => binarySearchCutoffIndex(array, (pivot) => pivot < item);
