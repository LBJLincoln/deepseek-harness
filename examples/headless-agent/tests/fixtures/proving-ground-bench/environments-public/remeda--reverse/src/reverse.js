import { purry } from "./purry.js";
export function reverse(...args) {
    throw new Error('not implemented');
}
function reverseImplementation(array) {
    // TODO [>2]: When node 18 reaches end-of-life bump target lib to ES2023+ and use `Array.prototype.toReversed` here.
    // eslint-disable-next-line unicorn/no-array-reverse -- See TODO above.
    return [...array].reverse();
}
