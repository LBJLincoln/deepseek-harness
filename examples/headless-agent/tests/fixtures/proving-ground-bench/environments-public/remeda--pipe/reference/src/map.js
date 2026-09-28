import { purry } from "./purry.js";
export function map(...args) {
    return purry(mapImplementation, args, lazyImplementation);
}
const mapImplementation = (data, callbackfn) => data.map(callbackfn);
const lazyImplementation = (callbackfn) => (value, index, data) => ({
    done: false,
    hasNext: true,
    next: callbackfn(value, index, data),
});
