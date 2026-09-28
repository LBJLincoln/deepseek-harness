import { lazyDataLastImpl } from "./internal/lazyDataLastImpl.js";
import { lazyEmptyEvaluator } from "./internal/utilityEvaluators.js";
export function zipWith(arg0, arg1, arg2) {
    throw new Error('not implemented');
}
function zipWithImplementation(first, second, fn) {
    const datum = [first, second];
    return first.length < second.length
        ? first.map((item, index) => fn(item, second[index], index, datum))
        : second.map((item, index) => fn(first[index], item, index, datum));
}
const lazyImplementation = (second, fn) => second.length === 0
    ? lazyEmptyEvaluator
    : (value, index, data) => ({
        next: fn(value, second[index], index, [data, second]),
        hasNext: true,
        done: index >= second.length - 1,
    });
