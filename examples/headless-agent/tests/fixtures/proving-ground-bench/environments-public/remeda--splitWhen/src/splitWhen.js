import { purry } from "./purry.js";
export function splitWhen(...args) {
    throw new Error('not implemented');
}
function splitWhenImplementation(data, predicate) {
    const index = data.findIndex(predicate);
    return index === -1
        ? [[...data], []]
        : [data.slice(0, index), data.slice(index)];
}
