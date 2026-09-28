import { purry } from "./purry.js";
import { binarySearchCutoffIndex } from "./internal/binarySearchCutoffIndex.js";
export function sortedIndexWith(...args) {
    return purry(binarySearchCutoffIndex, args);
}
