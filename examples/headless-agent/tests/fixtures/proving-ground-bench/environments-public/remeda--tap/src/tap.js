import { purry } from "./purry.js";
export function tap(...args) {
    throw new Error('not implemented');
}
function tapImplementation(value, fn) {
    fn(value);
    return value;
}
