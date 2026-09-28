import { purry } from "./purry.js";
import { binarySearchCutoffIndex } from "./internal/binarySearchCutoffIndex.js";
export function sortedLastIndex(...args) {
    throw new Error('not implemented');
}
const sortedLastIndexImplementation = (array, item) => binarySearchCutoffIndex(array,
// The only difference between the regular implementation and the "last"
// variation is that we consider the pivot with equality too, so that we
// skip all equal values in addition to the lower ones.
(pivot) => pivot <= item);
