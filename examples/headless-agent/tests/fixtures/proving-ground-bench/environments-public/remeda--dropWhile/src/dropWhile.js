import { purry } from "./purry.js";
export function dropWhile(...args) {
    throw new Error('not implemented');
}
function dropWhileImplementation(data, predicate) {
    for (const [index, item] of data.entries()) {
        if (!predicate(item, index, data)) {
            return data.slice(index);
        }
    }
    return [];
}
