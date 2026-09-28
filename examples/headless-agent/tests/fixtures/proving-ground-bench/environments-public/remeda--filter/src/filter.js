import { SKIP_ITEM } from "./internal/utilityEvaluators.js";
import { purry } from "./purry.js";
export function filter(...args) {
    throw new Error('not implemented');
}
const filterImplementation = (data, predicate) => data.filter(predicate);
const lazyImplementation = (predicate) => (value, index, data) => predicate(value, index, data)
    ? { done: false, hasNext: true, next: value }
    : SKIP_ITEM;
