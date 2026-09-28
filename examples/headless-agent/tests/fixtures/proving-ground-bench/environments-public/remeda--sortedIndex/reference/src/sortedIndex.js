import { purry } from "./purry.js";
import { binarySearchCutoffIndex } from "./internal/binarySearchCutoffIndex.js";
export function sortedIndex(...args) {
    return purry(sortedIndexImplementation, args);
}
const sortedIndexImplementation = (array, item) => binarySearchCutoffIndex(array, (pivot) => pivot < item);
