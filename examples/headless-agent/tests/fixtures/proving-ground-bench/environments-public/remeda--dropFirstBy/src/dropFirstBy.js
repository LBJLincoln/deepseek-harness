import { heapify, heapMaybeInsert } from "./internal/heap.js";
import { purryOrderRulesWithArgument, } from "./internal/purryOrderRules.js";
export function dropFirstBy(...args) {
    throw new Error('not implemented');
}
function dropFirstByImplementation(data, compareFn, n) {
    if (n >= data.length) {
        return [];
    }
    if (n <= 0) {
        return [...data];
    }
    const heap = data.slice(0, n);
    heapify(heap, compareFn);
    const out = [];
    const rest = data.slice(n);
    for (const item of rest) {
        const previousHead = heapMaybeInsert(heap, compareFn, item);
        out.push(previousHead ?? item);
    }
    return out;
}
