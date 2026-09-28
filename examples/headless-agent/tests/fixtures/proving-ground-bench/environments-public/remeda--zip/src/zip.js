import { lazyEmptyEvaluator } from "./internal/utilityEvaluators.js";
import { purry } from "./purry.js";
export function zip(...args) {
    throw new Error('not implemented');
}
const zipImplementation = (first, second) => (first.length < second.length
    ? first.map((item, index) => [item, second[index]])
    : second.map((item, index) => [first[index], item]));
const lazyImplementation = (second) => second.length === 0
    ? lazyEmptyEvaluator
    : (value, index) => ({
        hasNext: true,
        next: [value, second[index]],
        done: index >= second.length - 1,
    });
