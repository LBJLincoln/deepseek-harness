import { purry } from "./purry.js";
export function dropLastWhile(...args) {
    throw new Error('not implemented');
}
function dropLastWhileImplementation(data, predicate) {
    for (let i = data.length - 1; i >= 0; i--) {
        if (!predicate(data[i], i, data)) {
            return data.slice(0, i + 1);
        }
    }
    return [];
}
