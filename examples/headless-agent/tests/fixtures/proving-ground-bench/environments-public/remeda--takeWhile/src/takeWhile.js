import { purry } from "./purry.js";
export function takeWhile(...args) {
    throw new Error('not implemented');
}
function takeWhileImplementation(data, predicate) {
    const ret = [];
    for (const [index, item] of data.entries()) {
        if (!predicate(item, index, data)) {
            break;
        }
        ret.push(item);
    }
    return ret;
}
