import { purry } from "./purry.js";
export function map(...args) {
    throw new Error('not implemented');
}
const mapImplementation = (data, callbackfn) => data.map(callbackfn);
const lazyImplementation = (callbackfn) => (value, index, data) => ({
    done: false,
    hasNext: true,
    next: callbackfn(value, index, data),
});
