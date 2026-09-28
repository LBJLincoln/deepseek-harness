import { toSingle } from "./internal/toSingle.js";
import { SKIP_ITEM } from "./internal/utilityEvaluators.js";
import { purry } from "./purry.js";
export function find(...args) {
    return purry(findImplementation, args, toSingle(lazyImplementation));
}
const findImplementation = (data, predicate) => data.find(predicate);
const lazyImplementation = (predicate) => (value, index, data) => predicate(value, index, data)
    ? { done: true, hasNext: true, next: value }
    : SKIP_ITEM;
