import { purryOrderRulesWithArgument, } from "./internal/purryOrderRules.js";
import { quickSelect } from "./internal/quickSelect.js";
export function nthBy(...args) {
    throw new Error('not implemented');
}
const nthByImplementation = (data, compareFn, index) => quickSelect(data,
// Allow negative indices gracefully
index >= 0 ? index : data.length + index, compareFn);
