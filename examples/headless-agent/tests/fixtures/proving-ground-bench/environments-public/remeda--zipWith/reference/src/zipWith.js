import { lazyDataLastImpl } from "./internal/lazyDataLastImpl.js";
import { lazyEmptyEvaluator } from "./internal/utilityEvaluators.js";
export function zipWith(arg0, arg1, arg2) {
    if (typeof arg0 === "function") {
        // Both datum's last
        return (data1, data2) => zipWithImplementation(data1, data2, arg0);
    }
    if (typeof arg1 === "function") {
        // dataLast
        return lazyDataLastImpl(zipWithImplementation, [arg0, arg1], lazyImplementation);
    }
    // dataFirst. Notice that we assert that the arguments are defined to reduce
    // the number of runtime checks that would otherwise be needed to make
    // TypeScript happy here. Because this is an internal implementation and we
    // are protected by the function typing itself this is fine!
    return zipWithImplementation(arg0, arg1, arg2);
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
