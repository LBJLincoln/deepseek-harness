import { purry } from "./purry.js";
export function takeLastWhile(...args) {
    throw new Error('not implemented');
}
function takeLastWhileImplementation(data, predicate) {
    for (let i = data.length - 1; i >= 0; i--) {
        if (!predicate(data[i], i, data)) {
            return data.slice(i + 1);
        }
    }
    return [...data];
}
