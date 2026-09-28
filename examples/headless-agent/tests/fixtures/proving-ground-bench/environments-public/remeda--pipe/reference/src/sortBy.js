import { purryOrderRules } from "./internal/purryOrderRules.js";
export function sortBy(...args) {
    return purryOrderRules(sortByImplementation, args);
}
const sortByImplementation = (data, compareFn) =>
// TODO [>2]: When node 18 reaches end-of-life bump target lib to ES2023+ and use `Array.prototype.toSorted` here.
[...data].sort(compareFn);
