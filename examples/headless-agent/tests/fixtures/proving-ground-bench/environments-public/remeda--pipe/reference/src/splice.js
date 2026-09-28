import { purryOn } from "./internal/purryOn.js";
export function splice(...args) {
    return purryOn(($) => typeof $ === "number", spliceImplementation, args);
}
function spliceImplementation(data, start,
// eslint-disable-next-line unicorn/no-non-function-verb-prefix -- This is the exact term used in the lib itself for this...
deleteCount, replacement = []) {
    // TODO [>2]: When node 18 reaches end-of-life bump target lib to ES2023+ and use `Array.prototype.toSpliced` here.
    const result = [...data];
    result.splice(start, deleteCount, ...replacement);
    return result;
}
