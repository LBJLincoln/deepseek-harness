import { purryOrderRules } from "./internal/purryOrderRules.js";
export function sortBy(...args) {
    throw new Error('not implemented');
}
const sortByImplementation = (data, compareFn) =>
// TODO [>2]: When node 18 reaches end-of-life bump target lib to ES2023+ and use `Array.prototype.toSorted` here.
[...data].sort(compareFn);
