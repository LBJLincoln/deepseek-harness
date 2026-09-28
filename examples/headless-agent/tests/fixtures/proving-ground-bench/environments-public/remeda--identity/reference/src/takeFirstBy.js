import { heapify, heapMaybeInsert } from "./internal/heap.js";
import { purryOrderRulesWithArgument, } from "./internal/purryOrderRules.js";
export function takeFirstBy(...args) {
    return purryOrderRulesWithArgument(takeFirstByImplementation, args);
}
function takeFirstByImplementation(data, compareFn, n) {
    if (n <= 0) {
        return [];
    }
    if (n >= data.length) {
        return [...data];
    }
    const heap = data.slice(0, n);
    heapify(heap, compareFn);
    const rest = data.slice(n);
    for (const item of rest) {
        heapMaybeInsert(heap, compareFn, item);
    }
    return heap;
}
