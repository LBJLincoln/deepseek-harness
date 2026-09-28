import { purryOrderRulesWithArgument, } from "./internal/purryOrderRules.js";
import { quickSelect } from "./internal/quickSelect.js";
export function nthBy(...args) {
    return purryOrderRulesWithArgument(nthByImplementation, args);
}
const nthByImplementation = (data, compareFn, index) => quickSelect(data,
// Allow negative indices gracefully
index >= 0 ? index : data.length + index, compareFn);
